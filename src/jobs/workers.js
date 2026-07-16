import { Worker } from 'bullmq'
import { config } from '../config/env.js'
import { Nicho } from '../models/Nicho.js'
import { Reporte } from '../models/Reporte.js'
import { buscarNivel1, ejecutarActorAsync } from '../services/apify.js'
import { normalizarScan } from '../services/normalizador.js'
import { indexarDetallesPorSku } from '../services/normalizadorDetalle.js'
import { guardarScan, aplicarDetalleScan } from '../services/persistencia.js'
import { generarReporteNicho } from '../services/metricas.js'
import { analizarNicho } from '../services/analista.js'
import { sugerirNichos, palabrasSaturadas } from '../services/sugeridor.js'
import { keywordReal, palabrasClave } from '../services/busquedasReales.js'
import { registrarGasto, gastoDelMes } from '../services/gastos.js'
import { llmDisponible } from '../services/llm.js'
import {
  COLA_SCAN_NICHO,
  COLA_SCAN_DETALLE,
  COLA_CALCULAR_METRICAS,
  COLA_ANALISIS,
  COLA_RADAR,
  COLA_PROGRAMADOR,
  crearConexionRedis,
  obtenerColas,
  encolarScanNicho,
} from './queues.js'

export async function procesarScanNicho(job) {
  const nicho = await Nicho.findById(job.data.nichoId)
  if (!nicho) throw new Error(`Nicho ${job.data.nichoId} no existe`)
  if (nicho.estado !== 'activo') return { omitido: true, motivo: `nicho en estado "${nicho.estado}"` }

  const fecha = new Date()
  const { items: crudos, costoUsd } = await buscarNivel1(nicho.keyword, { domainCode: nicho.domainCode })
  await registrarGasto(nicho._id, costoUsd)
  if (!crudos.length) {
    throw new Error(
      `Apify devolvió 0 items para "${nicho.keyword}": posible bloqueo del actor o keyword sin resultados`,
    )
  }

  const { items, descartados, totalResultados } = normalizarScan(crudos, {
    fecha,
    keyword: nicho.keyword,
  })
  if (!items.length) {
    throw new Error(
      `Ningún item normalizable para "${nicho.keyword}" (${crudos.length} crudos, ${descartados} sin SKU): revisar mapeo de campos del actor`,
    )
  }

  const resultado = await guardarScan({ items, fecha })

  nicho.ultimoScanEl = fecha
  nicho.ultimoTotalResultados = totalResultados
  await nicho.save()

  const colas = obtenerColas()
  // reporte rápido con lo del nivel 1; el nivel 2 lo recalcula al terminar
  await colas.calcularMetricas.add('reporte', { nichoId: String(nicho._id) })

  if (config.nivel2Activo) {
    // screening: detalle barato para que los candidatos del radar prueben que
    // merecen el detalle completo antes de gastar como un nicho consolidado
    const topN = nicho.fase === 'screening' ? config.detalleScreeningN : config.detalleTopN
    const top = items
      .sort((a, b) => (a.snapshot.posicion ?? Infinity) - (b.snapshot.posicion ?? Infinity))
      .slice(0, topN)
      .filter((i) => i.producto.url)
      .map((i) => ({ sku: i.producto.sku, url: i.producto.url }))
    await colas.scanDetalle.add('detalle', {
      nichoId: String(nicho._id),
      fechaScan: fecha.toISOString(),
      objetivos: top,
    })
  }

  return {
    ...resultado,
    itemsCrudos: crudos.length,
    descartados,
    totalResultados: totalResultados?.total ?? null,
    nivel2Encolado: config.nivel2Activo,
  }
}

// Nivel 2 en batches con el modo async de Apify (sin el límite de 300s del sync).
export async function procesarScanDetalle(job) {
  const { nichoId, fechaScan, objetivos } = job.data
  const fecha = new Date(fechaScan)
  if (!objetivos?.length) return { omitido: true, motivo: 'sin objetivos' }

  const skusPedidos = objetivos.map((o) => o.sku)
  let aplicados = 0
  let sinMatch = 0
  let fallidos = 0

  for (let i = 0; i < objetivos.length; i += config.detalleBatch) {
    // pausa entre batches: menos agresivo con ML = menos páginas vacías por bloqueo
    if (i > 0) await new Promise((resolver) => setTimeout(resolver, 20_000))
    const batch = objetivos.slice(i, i + config.detalleBatch)
    let crudos
    try {
      const r = await ejecutarActorAsync(
        config.actorDetails,
        {
          urls: batch.map((o) => o.url),
          max_retries_per_url: 2,
          ignore_url_failures: true,
          proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
        },
        { pollMs: 10_000, timeoutMs: 12 * 60_000, conMeta: true },
      )
      crudos = r.items
      await registrarGasto(nichoId, r.costoUsd)
    } catch (err) {
      // un batch caído no bota el scan completo; queda registrado en el resultado
      console.error(`[scan-detalle] batch ${i / config.detalleBatch + 1} falló: ${err.message}`)
      fallidos += batch.length
      continue
    }
    const { porSku, sinMatch: sm } = indexarDetallesPorSku(crudos, skusPedidos)
    sinMatch += sm
    const res = await aplicarDetalleScan({ porSku, fecha })
    aplicados += porSku.size
    await job.updateProgress(Math.round(((i + batch.length) / objetivos.length) * 100))
    void res
  }

  // aplicar casi nada equivale a no medir: mejor reintentar (el bloqueo de ML
  // es temporal) que dar por bueno un scan cuya demanda saldría de 1-2 productos
  const minimoAplicados = Math.max(1, Math.ceil(objetivos.length * 0.2))
  if (aplicados < minimoAplicados) {
    throw new Error(
      `Nivel 2 aplicó muy poco (${aplicados}/${objetivos.length}, mínimo ${minimoAplicados}; ${fallidos} fallidos, ${sinMatch} sin match de SKU): probable bloqueo de ML`,
    )
  }

  // recalcular el reporte ahora que hay reviews/seller/Full del nivel 2
  await obtenerColas().calcularMetricas.add('reporte', { nichoId })

  return { objetivos: objetivos.length, aplicados, sinMatch, fallidos }
}

export async function procesarCalcularMetricas(job) {
  const nicho = await Nicho.findById(job.data.nichoId)
  if (!nicho) throw new Error(`Nicho ${job.data.nichoId} no existe`)

  const reporte = await generarReporteNicho(nicho)
  if (!reporte) throw new Error(`No hay snapshots para "${nicho.keyword}": el scan no guardó datos`)

  // un reporte por scan: el recálculo post-nivel-2 actualiza el mismo documento
  const doc = await Reporte.findOneAndUpdate(
    { nichoId: nicho._id, fecha: reporte.fechaScan },
    {
      $set: {
        keyword: nicho.keyword,
        metricas: reporte.metricas,
        topProductos: reporte.topProductos,
        topSellers: reporte.topSellers,
        scoreOportunidad: reporte.metricas.scoreOportunidad,
      },
      $setOnInsert: { creadoEl: new Date() },
    },
    { upsert: true, new: true },
  )

  // embudo del radar: en screening el score decide — bajo el umbral se pausa sin
  // gastar LLM; sobre el umbral se gradúa a detalle completo y sigue al análisis
  if (nicho.fase === 'screening' && reporte.metricas.scoreOportunidad != null) {
    if (reporte.metricas.scoreOportunidad < config.screeningScoreMin) {
      if (nicho.origen === 'radar' && nicho.estado === 'activo') {
        nicho.estado = 'pausado'
        await nicho.save()
      }
      return { reporteId: String(doc._id), score: reporte.metricas.scoreOportunidad, screening: 'descartado' }
    }
    nicho.fase = 'completo'
    await nicho.save()
  }

  // análisis IA automático: primer reporte con score, o score que se movió ≥10 puntos
  let analisisEncolado = false
  if (config.analisisAuto && llmDisponible() && reporte.metricas.scoreOportunidad != null && !doc.analisis) {
    const ultimoAnalizado = await Reporte.findOne({ nichoId: nicho._id, analisis: { $ne: null } })
      .sort({ fecha: -1 })
      .lean()
    const debeAnalizar =
      !ultimoAnalizado ||
      Math.abs((ultimoAnalizado.metricas?.scoreOportunidad ?? 0) - reporte.metricas.scoreOportunidad) >= 10
    if (debeAnalizar) {
      await obtenerColas().analisis.add('analizar', { nichoId: String(nicho._id) })
      analisisEncolado = true
    } else {
      // el análisis anterior sigue vigente: heredarlo para que el reporte nuevo no quede huérfano
      doc.analisis = ultimoAnalizado.analisis
      doc.markModified('analisis')
      await doc.save()
    }
  }

  return { reporteId: String(doc._id), score: reporte.metricas.scoreOportunidad, analisisEncolado }
}

export async function procesarAnalisisNicho(job) {
  if (!llmDisponible()) return { omitido: true, motivo: 'sin ANTHROPIC_API_KEY' }
  const nicho = await Nicho.findById(job.data.nichoId)
  if (!nicho) throw new Error(`Nicho ${job.data.nichoId} no existe`)

  const analisis = await analizarNicho(nicho)

  // los descubrimientos del radar que no dan se pausan solos: dejan de gastar scans
  let pausado = false
  if (nicho.origen === 'radar' && analisis.veredicto === 'no_entrar' && nicho.estado === 'activo') {
    nicho.estado = 'pausado'
    await nicho.save()
    pausado = true
  }

  return { veredicto: analisis.veredicto, pausado }
}

// Radar autónomo: pide sugerencias por temporada/tendencia, crea los nichos
// nuevos y los manda a escanear. El pipeline hace el resto (scan → detalle →
// métricas → análisis IA → auto-pausa si no vale la pena).
export async function procesarRadar() {
  if (!llmDisponible()) return { omitido: true, motivo: 'sin ANTHROPIC_API_KEY' }

  const gastado = await gastoDelMes()
  if (gastado >= config.presupuestoUsdMes) {
    return { omitido: true, motivo: `presupuesto mensual agotado (US$ ${gastado.toFixed(2)} de ${config.presupuestoUsdMes})` }
  }

  // techo de nichos activos: el dinamismo no puede disparar el gasto de Apify
  const activos = await Nicho.countDocuments({ estado: 'activo' })
  const cupo = Math.min(config.radarMaxNichos, Math.max(0, config.radarMaxActivos - activos))
  if (cupo === 0) return { omitido: true, motivo: `tope de ${config.radarMaxActivos} nichos activos alcanzado` }

  const { sugerencias } = await sugerirNichos()
  const todos = await Nicho.find().select('keyword estado').lean()
  const existentes = new Set(todos.map((n) => n.keyword))

  // regla dura de diversificación: si una raíz domina el tablero activo
  // (3+ nichos, ej. "solar"), no se abren más nichos que la contengan —
  // el radar explora categorías nuevas en vez de profundizar el embudo
  const saturadas = palabrasSaturadas(todos.filter((n) => n.estado === 'activo').map((n) => n.keyword))

  const creados = []
  for (const s of sugerencias) {
    if (creados.length >= cupo) break
    const ideada = String(s.keyword ?? '').trim().toLowerCase()
    if (ideada.length < 2) continue
    const saturada = [...palabrasClave(ideada)].find((p) => saturadas.has(p))
    if (saturada) {
      console.log(`[radar] "${ideada}" descartada: vertical saturada ("${saturada}" ya domina el tablero)`)
      continue
    }

    // la keyword ideada se canoniza a lo que la gente escribe de verdad
    // (autocompletado de ML); si nadie busca nada parecido, el nicho mediría
    // un listado que ningún comprador ve
    let keyword = ideada
    try {
      const real = await keywordReal(ideada)
      if (!real) {
        console.log(`[radar] "${ideada}" descartada: sin búsqueda real parecida en el autocompletado de ML`)
        continue
      }
      keyword = real.keyword
      if (keyword !== ideada) console.log(`[radar] "${ideada}" → búsqueda real "${keyword}"`)
    } catch (err) {
      console.error(`[radar] autosuggest no disponible para "${ideada}": ${err.message} — se usa tal cual`)
    }
    const saturadaReal = [...palabrasClave(keyword)].find((p) => saturadas.has(p))
    if (saturadaReal) {
      console.log(`[radar] "${keyword}" descartada: vertical saturada ("${saturadaReal}" ya domina el tablero)`)
      continue
    }
    if (existentes.has(keyword)) continue

    const nicho = await Nicho.create({
      keyword,
      origen: 'radar',
      frecuenciaScan: 'semanal',
      fase: 'screening',
      radarInfo: {
        razon: s.razon,
        categoria: s.categoria,
        estacionalidad: s.estacionalidad,
        ventanaImportacion: s.ventanaImportacion,
        riesgo: s.riesgo,
        keywordIdeada: keyword !== ideada ? ideada : undefined,
        descubiertoEl: new Date(),
      },
    })
    await encolarScanNicho(nicho._id, { motivo: 'radar' })
    creados.push(keyword)
    existentes.add(keyword)
  }

  return { sugeridos: sugerencias.length, creados: creados.length, keywords: creados }
}

// Programador: encola scans de nichos activos cuyo último scan ya venció
// (diario ≈ 20 h, semanal ≈ 6.5 días). jobId por ventana de 3 h evita duplicados.
export async function procesarProgramadorScans() {
  const gastado = await gastoDelMes()
  if (gastado >= config.presupuestoUsdMes) {
    return { omitido: true, motivo: `presupuesto mensual agotado (US$ ${gastado.toFixed(2)} de ${config.presupuestoUsdMes})` }
  }

  const ahora = Date.now()
  const umbrales = { diario: 20 * 3600e3, semanal: 6.5 * 86400e3 }
  const nichos = await Nicho.find({ estado: 'activo' }).lean()

  let encolados = 0
  for (const nicho of nichos) {
    const ultimo = nicho.ultimoScanEl ? new Date(nicho.ultimoScanEl).getTime() : 0
    if (ahora - ultimo < (umbrales[nicho.frecuenciaScan] ?? umbrales.diario)) continue
    await encolarScanNicho(nicho._id, {
      motivo: 'programado',
      jobId: `prog-${nicho._id}-${Math.floor(ahora / (3 * 3600e3))}`,
    })
    encolados++
  }
  return { activos: nichos.length, encolados }
}

export function iniciarWorkers() {
  // concurrencia 1 + rate limit: cada scan quema créditos de Apify
  const workerScan = new Worker(COLA_SCAN_NICHO, procesarScanNicho, {
    connection: crearConexionRedis(),
    concurrency: 1,
    limiter: { max: 2, duration: 60_000 },
  })
  const workerDetalle = new Worker(COLA_SCAN_DETALLE, procesarScanDetalle, {
    connection: crearConexionRedis(),
    concurrency: 2, // dos nichos en detalle a la vez: la cola del radar no se eterniza
    limiter: { max: 4, duration: 60_000 },
    maxStalledCount: 3, // los deploys de Render reinician el proceso; no botar el job por eso
  })
  // El bloqueo de ML al detalle repetido dura horas, no segundos: agotados los
  // intentos rápidos, reintentar en 2/4/8 h para que el nicho no quede sin
  // análisis hasta su próximo scan programado.
  workerDetalle.on('failed', async (job) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return
    const reintentos = job.data.reintentosLargos ?? 0
    if (reintentos >= 3) return
    const delay = 2 * 3600e3 * 2 ** reintentos
    try {
      await obtenerColas().scanDetalle.add(
        'detalle',
        { ...job.data, reintentosLargos: reintentos + 1 },
        { delay },
      )
      console.log(`[scan-detalle] job ${job.id} agotó intentos: reintento largo ${reintentos + 1}/3 en ${delay / 3600e3} h`)
    } catch (err) {
      console.error(`[scan-detalle] no se pudo encolar el reintento largo: ${err.message}`)
    }
  })
  const workerMetricas = new Worker(COLA_CALCULAR_METRICAS, procesarCalcularMetricas, {
    connection: crearConexionRedis(),
    concurrency: 1,
  })
  const workerAnalisis = new Worker(COLA_ANALISIS, procesarAnalisisNicho, {
    connection: crearConexionRedis(),
    concurrency: 1,
    limiter: { max: 4, duration: 60_000 }, // llamadas al LLM
  })
  const workerRadar = new Worker(COLA_RADAR, procesarRadar, {
    connection: crearConexionRedis(),
    concurrency: 1,
  })
  const workerProgramador = new Worker(COLA_PROGRAMADOR, procesarProgramadorScans, {
    connection: crearConexionRedis(),
    concurrency: 1,
  })

  for (const worker of [workerScan, workerDetalle, workerMetricas, workerAnalisis, workerRadar, workerProgramador]) {
    worker.on('failed', (job, err) => {
      console.error(`[${worker.name}] job ${job?.id} (intento ${job?.attemptsMade}) falló: ${err.message}`)
    })
    worker.on('completed', (job, resultado) => {
      console.log(`[${worker.name}] job ${job.id} completado:`, JSON.stringify(resultado))
    })
    worker.on('error', (err) => console.error(`[${worker.name}] error de worker:`, err.message))
  }

  return [workerScan, workerDetalle, workerMetricas, workerAnalisis, workerRadar, workerProgramador]
}
