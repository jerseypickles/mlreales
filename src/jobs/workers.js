import { Worker } from 'bullmq'
import { config } from '../config/env.js'
import { Nicho } from '../models/Nicho.js'
import { Reporte } from '../models/Reporte.js'
import { Snapshot } from '../models/Snapshot.js'
import { Producto } from '../models/Producto.js'
import { buscarNivel1, ejecutarActorAsync, construirInputDetalle } from '../services/apify.js'
import { normalizarScan } from '../services/normalizador.js'
import { indexarDetallesPorSku } from '../services/normalizadorDetalle.js'
import { guardarScan, aplicarDetalleScan } from '../services/persistencia.js'
import { reviewsOficialesSeguro, fullOficialSeguro } from '../services/meli.js'
import { generarReporteNicho } from '../services/metricas.js'
import { scoring } from '../config/scoring.js'
import { analizarNicho } from '../services/analista.js'
import { sugerirNichos, palabrasSaturadas } from '../services/sugeridor.js'
import { keywordReal, palabrasClave } from '../services/busquedasReales.js'
import { registrarGasto, gastoDelMes } from '../services/gastos.js'
import { escanearPropios, importarMisItems } from '../services/propios.js'
import { saldoApify } from '../services/apify.js'
import { elegirObjetivosDetalle } from '../services/seleccionDetalle.js'
import { capturarTendencias, movimientosRecientes, lineasEnAlza } from '../services/tendencias.js'
import { generarRfqPendientes } from '../services/rfq.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { llmDisponible } from '../services/llm.js'
import {
  COLA_SCAN_NICHO,
  COLA_SCAN_DETALLE,
  COLA_CALCULAR_METRICAS,
  COLA_ANALISIS,
  COLA_RADAR,
  COLA_PROGRAMADOR,
  COLA_PROPIOS,
  COLA_TENDENCIAS,
  COLA_RFQ,
  COLA_ESTRATEGA,
  crearConexionRedis,
  obtenerColas,
  encolarScanNicho,
  encolarRfq,
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
    // mantenimiento semanal ('programado') con detalle recortado: la serie de un
    // graduado no necesita 30 reseñas — maduración y manuales mantienen el full
    const topN =
      nicho.fase === 'screening'
        ? config.detalleScreeningN
        : job?.data?.motivo === 'programado'
          ? config.detalleTopNMantenimiento
          : config.detalleTopN
    // cuándo se midió por última vez cada sku (para la rotación de la selección)
    const ultimasMediciones = await Snapshot.aggregate([
      { $match: { sku: { $in: items.map((i) => i.producto.sku) }, numReviews: { $ne: null } } },
      { $group: { _id: '$sku', fecha: { $max: '$fecha' } } },
    ])
    const medidoEl = new Map(ultimasMediciones.map((m) => [m._id, new Date(m.fecha).getTime()]))
    // los que formaron la canasta comparable del scan anterior: mantenerlos
    // adentro es lo que hace que el delta siga siendo comparable
    const previo = await Snapshot.findOne({ keyword: nicho.keyword, fecha: { $lt: fecha }, numReviews: { $ne: null } })
      .sort({ fecha: -1 })
      .select('fecha')
      .lean()
    const enSerie = new Set(
      previo
        ? (
            await Snapshot.find({ keyword: nicho.keyword, fecha: previo.fecha, numReviews: { $ne: null } })
              .select('sku')
              .lean()
          ).map((s) => s.sku)
        : [],
    )
    const top = elegirObjetivosDetalle(
      items.map((i) => ({
        sku: i.producto.sku,
        url: i.producto.url,
        posicion: i.snapshot.posicion,
        precio: i.snapshot.precio,
      })),
      { topN, medidoEl, enSerie },
    ).map((i) => ({ sku: i.sku, url: i.url }))
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

// Rescate por la API oficial para páginas de catálogo que el actor no puede
// medir. Secuencial a propósito: meliGet refresca el token solo y el refresh
// de ML es single-use — dos refresh en paralelo invalidarían uno al otro.
async function rescatarConApiOficial(skus, fecha) {
  const porSku = new Map()
  for (const sku of skus) {
    const r = await reviewsOficialesSeguro(sku)
    if (r) porSku.set(sku, { numReviews: r.numReviews, rating: r.rating, precio: null })
  }
  if (!porSku.size) return 0
  const res = await aplicarDetalleScan({ porSku, fecha })
  return res.reviewsAplicadas
}

// Nivel 2 en batches con el modo async de Apify (sin el límite de 300s del sync).
export async function procesarScanDetalle(job) {
  const { nichoId, fechaScan, objetivos } = job.data
  const fecha = new Date(fechaScan)
  if (!objetivos?.length) return { omitido: true, motivo: 'sin objetivos' }

  // los reintentos pendientes no deben gastar en nichos que ya no interesan
  // ni aplicar datos a un scan superado por otro más nuevo (quedarían huérfanos)
  const nicho = await Nicho.findById(nichoId).select('estado ultimoScanEl keyword domainCode').lean()
  if (!nicho) return { omitido: true, motivo: 'nicho eliminado' }
  if (nicho.estado !== 'activo') return { omitido: true, motivo: `nicho en estado "${nicho.estado}"` }
  if (nicho.ultimoScanEl && new Date(nicho.ultimoScanEl) - fecha > 30 * 60_000) {
    return { omitido: true, motivo: 'scan superado por uno más nuevo' }
  }

  // no re-pagar proxy por URLs que una pasada anterior ya midió en este scan:
  // el reintento pide solo las faltantes
  const yaMedidos = new Set(
    (
      await Snapshot.find({ sku: { $in: objetivos.map((o) => o.sku) }, fecha, numReviews: { $ne: null } })
        .select('sku')
        .lean()
    ).map((s) => s.sku),
  )
  const pendientes = objetivos.filter((o) => !yaMedidos.has(o.sku))
  if (!pendientes.length) return { omitido: true, motivo: 'detalle ya aplicado para este scan' }

  const skusPedidos = pendientes.map((o) => o.sku)
  let aplicados = 0
  let sinMatch = 0
  let fallidos = 0
  let sinReviews = 0

  for (let i = 0; i < pendientes.length; i += config.detalleBatch) {
    // pausa entre batches: menos agresivo con ML = menos páginas vacías por bloqueo
    if (i > 0) await new Promise((resolver) => setTimeout(resolver, 20_000))
    const batch = pendientes.slice(i, i + config.detalleBatch)
    let crudos
    try {
      const r = await ejecutarActorAsync(
        config.actorDetails,
        construirInputDetalle(config.actorDetails, batch.map((o) => o.url), { domainCode: nicho.domainCode }),
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
    const { porSku, sinMatch: sm } = indexarDetallesPorSku(crudos, pendientes)
    sinMatch += sm
    // diagnóstico de match bajo (nichos de catálogo tipo gua sha / rodillo
    // facial): dejar en el log los campos identificatorios de un crudo sin
    // aplicar para poder ver POR QUÉ no calza contra los SKUs pedidos
    if (sm > batch.length / 2 && crudos?.length) {
      const c = crudos.find((x) => x) ?? {}
      console.warn(
        `[scan-detalle] match bajo (${sm}/${batch.length} sin match) — muestra: ${JSON.stringify({
          id: c.id ?? null,
          productId: c.productId ?? null,
          catalogProductId: c.catalogProductId ?? null,
          sku: c.sku ?? null,
          variations: Array.isArray(c.variations) ? c.variations.slice(0, 3).map((v) => v?.id ?? v) : null,
          ratingCount: c.ratingCount ?? null,
          reviewCount: c.reviewCount ?? null,
          url: String(c.url ?? c.productUrl ?? '').slice(0, 110),
          pedidos: skusPedidos.slice(0, 3),
        })}`,
      )
    }
    const res = await aplicarDetalleScan({ porSku, fecha })
    // medido = con conteo de reseñas escrito, no con match de SKU: el caso
    // rodillo facial (2026-07-20) matcheó 8/10 pero casi ninguno traía
    // ratingCount y el scan pasó como éxito dejando el score en null sin reintento
    aplicados += res.reviewsAplicadas
    // páginas de catálogo (/up/, /p/) sin conteo de reseñas por ninguna vía del
    // actor (el rescate por modo reviews se retiró el 22-jul: 0 filas siempre):
    // la API oficial de ML sí entrega el agregado de catálogo, gratis. Lo que
    // ni ella mida sigue hacia la extensión bajo el top.
    const skusCojos = [...porSku].filter(([, d]) => d.numReviews === null).map(([sku]) => sku)
    if (skusCojos.length) {
      const rescatados = await rescatarConApiOficial(skusCojos, fecha)
      if (rescatados) {
        console.log(`[scan-detalle] API oficial midió reseñas de ${rescatados}/${skusCojos.length} de catálogo`)
      }
      aplicados += rescatados
      sinReviews += skusCojos.length - rescatados
      if (rescatados < skusCojos.length) {
        console.warn(
          `[scan-detalle] ${skusCojos.length - rescatados} con match pero sin conteo de reseñas: ${skusCojos.slice(0, 5).join(', ')}`,
        )
      }
    }
    await job.updateProgress(Math.round(((i + batch.length) / pendientes.length) * 100))
  }

  // medir casi nada equivale a no medir — y medir MENOS de lo que el score
  // exige (minItemsDemanda) deja al nicho en un limbo silencioso: score null,
  // sin análisis, invisible en Oportunidades hasta el próximo scan (caso gua
  // sha / rodillo facial: 4/10 con match pasaba como "éxito"). El piso es lo
  // necesario para puntuar; bajo eso se reintentan solo las URLs faltantes.
  let totalConDetalle = yaMedidos.size + aplicados
  const minimoParaPuntuar = Math.min(objetivos.length, scoring.umbrales.minItemsDemanda)

  // EXTENSIÓN por páginas de catálogo (gua sha / rodillo facial, 21-jul): si
  // el top-N está dominado por páginas /up/ que no entregan conteo de reseñas
  // por NINGUNA vía del actor (modo product, inline y modo reviews probados),
  // reintentar las mismas URLs jamás va a juntar el mínimo. Se mide más abajo
  // del MISMO scan (posiciones siguientes, páginas normales) hasta poder
  // puntuar — el score se calcula sobre el top-50 igual.
  if (totalConDetalle < minimoParaPuntuar && sinReviews > 0) {
    const skusVistos = new Set([...objetivos.map((o) => o.sku), ...yaMedidos])
    const snaps = await Snapshot.find({ keyword: nicho.keyword, fecha })
      .sort({ posicion: 1 })
      .select('sku')
      .lean()
    const candidatos = snaps.map((s) => s.sku).filter((sku) => !skusVistos.has(sku))
    for (let tanda = 0; tanda < 2 && totalConDetalle < minimoParaPuntuar && candidatos.length; tanda++) {
      // pedir el doble de lo que falta: parte de la extensión también puede
      // ser catálogo sin reseñas
      const skusTanda = candidatos.splice(0, Math.min(config.detalleBatch, Math.max((minimoParaPuntuar - totalConDetalle) * 2, 6)))
      const productos = await Producto.find({ sku: { $in: skusTanda } })
        .select('sku url')
        .lean()
      const extra = productos.filter((p) => p.url).map((p) => ({ sku: p.sku, url: p.url }))
      if (!extra.length) break
      try {
        const r = await ejecutarActorAsync(
          config.actorDetails,
          construirInputDetalle(config.actorDetails, extra.map((o) => o.url), { domainCode: nicho.domainCode }),
          { pollMs: 10_000, timeoutMs: 12 * 60_000, conMeta: true },
        )
        await registrarGasto(nichoId, r.costoUsd)
        const { porSku } = indexarDetallesPorSku(r.items, extra)
        const res = await aplicarDetalleScan({ porSku, fecha })
        aplicados += res.reviewsAplicadas
        totalConDetalle += res.reviewsAplicadas
        console.log(
          `[scan-detalle] extensión bajo el top por catálogo sin reseñas: ${res.reviewsAplicadas}/${extra.length} medidos (total ${totalConDetalle}/${minimoParaPuntuar} para puntuar)`,
        )
      } catch (err) {
        console.error(`[scan-detalle] extensión falló: ${err.message}`)
        break
      }
    }
  }

  const minimoAplicados = Math.max(1, Math.ceil(objetivos.length * 0.2), minimoParaPuntuar)
  if (totalConDetalle < minimoAplicados) {
    throw new Error(
      `Nivel 2 quedó corto (${totalConDetalle}/${objetivos.length} con reseñas medidas, mínimo ${minimoAplicados} para poder puntuar; esta pasada midió ${aplicados} de ${pendientes.length}; ${fallidos} fallidos, ${sinMatch} sin match de SKU, ${sinReviews} con match pero sin reseñas): probable bloqueo de ML o exceso de páginas de catálogo`,
    )
  }

  // COBERTURA GRATIS BAJO EL TOP PAGADO ($0, API oficial): el top-N del actor
  // es un límite de COSTO, no de relevancia — los productos caros del nicho
  // suelen vivir bajo la posición 30 y quedaban "sin medir", lo que el
  // analista leía como "ese segmento no vende" (caso saca puntos 7-ago: las
  // máquinas estaban en 32-51 y el veredicto las enterró). /reviews/item da
  // el conteo exacto de los items de CATÁLOGO sin gastar un peso.
  try {
    const sinMedir = await Snapshot.find({ keyword: nicho.keyword, fecha, numReviews: null })
      .select('sku posicion')
      .sort({ posicion: 1 })
      .limit(40)
      .lean()
    if (sinMedir.length) {
      const deCatalogo = await Producto.find({
        sku: { $in: sinMedir.map((s) => s.sku) },
        tipoListing: 'catalogo',
      })
        .select('sku')
        .lean()
      if (deCatalogo.length) {
        const medidos = await rescatarConApiOficial(deCatalogo.map((p) => p.sku), fecha)
        if (medidos) {
          console.log(
            `[scan-detalle] cobertura gratis bajo el top pagado: ${medidos}/${deCatalogo.length} items de catálogo medidos por API oficial ($0)`,
          )
        }
      }
    }
  } catch (err) {
    console.warn(`[scan-detalle] cobertura gratis omitida: ${err.message}`)
  }

  // Full EXACTO de los items de catálogo por API oficial ($0): el ícono
  // {full_icon} del listado se pierde seguido y envenenaba el %Full del nicho
  // (caso Beauty Creations 6-ago). /products/:id/items da logistic_type real.
  try {
    const deCatalogo = await Producto.find({ sku: { $in: skusPedidos }, tipoListing: 'catalogo' })
      .select('sku esFull')
      .lean()
    let corregidos = 0
    for (const p of deCatalogo) {
      const r = await fullOficialSeguro(p.sku)
      if (!r) continue
      if (p.esFull !== r.esFull) corregidos++
      await Producto.updateOne({ sku: p.sku }, { $set: { esFull: r.esFull, logisticaMl: r.logistica } })
    }
    if (corregidos) console.log(`[scan-detalle] Full corregido por API oficial en ${corregidos} item(s) de catálogo`)
  } catch (err) {
    console.warn(`[scan-detalle] enriquecimiento Full omitido: ${err.message}`)
  }

  // recalcular el reporte ahora que hay reviews/seller/Full del nivel 2
  await obtenerColas().calcularMetricas.add('reporte', { nichoId })

  return { objetivos: objetivos.length, aplicados, yaMedidos: yaMedidos.size, sinMatch, sinReviews, fallidos }
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

  // análisis IA automático: primer reporte con score, score que se movió ≥10
  // puntos, o GRADUACIÓN de maduración — al juntar los scans que confirman,
  // Fable debe re-dictar el veredicto con la serie completa (un nicho que
  // madura con el análisis del scan #1 vigente no le sirve a nadie)
  let analisisEncolado = false
  let motivoAnalisis = null
  if (config.analisisAuto && llmDisponible() && reporte.metricas.scoreOportunidad != null && !doc.analisis) {
    const ultimoAnalizado = await Reporte.findOne({ nichoId: nicho._id, analisis: { $ne: null } })
      .sort({ fecha: -1 })
      .lean()
    const filtroDemanda = { nichoId: nicho._id, 'metricas.demanda.ventasEstimadasPorDia': { $ne: null } }
    const demandaAhora = await Reporte.countDocuments(filtroDemanda)
    const demandaAlAnalizar = ultimoAnalizado
      ? await Reporte.countDocuments({ ...filtroDemanda, fecha: { $lte: ultimoAnalizado.fecha } })
      : 0
    const gradua = demandaAhora >= config.maduracionScans && demandaAlAnalizar < config.maduracionScans
    const debeAnalizar =
      !ultimoAnalizado ||
      gradua ||
      Math.abs((ultimoAnalizado.metricas?.scoreOportunidad ?? 0) - reporte.metricas.scoreOportunidad) >= 10
    if (debeAnalizar) {
      motivoAnalisis = !ultimoAnalizado ? 'primer-analisis' : gradua ? 'graduacion' : 'score-movido'
      if (gradua) console.log(`[metricas] "${nicho.keyword}" graduó la maduración (${demandaAhora} scans con demanda): veredicto fresco con la serie completa`)
      // jobId por reporte: dos recálculos seguidos del mismo scan (extensión
      // plan C, reintentos) no deben pagar el LLM dos veces (caso sabanillas
      // perro 22-jul: análisis duplicado con 42s de diferencia)
      await obtenerColas()
        .analisis.add('analizar', { nichoId: String(nicho._id) }, { jobId: `analisis-${doc._id}` })
        .catch(() => null)
      analisisEncolado = true
    } else {
      // el análisis anterior sigue vigente: heredarlo para que el reporte nuevo no quede huérfano
      doc.analisis = ultimoAnalizado.analisis
      doc.markModified('analisis')
      await doc.save()
    }
  }

  return { reporteId: String(doc._id), score: reporte.metricas.scoreOportunidad, analisisEncolado, motivoAnalisis }
}

export async function procesarAnalisisNicho(job) {
  if (!llmDisponible()) return { omitido: true, motivo: 'sin ANTHROPIC_API_KEY' }
  const nicho = await Nicho.findById(job.data.nichoId)
  if (!nicho) throw new Error(`Nicho ${job.data.nichoId} no existe`)
  // no gastar LLM en nichos que se pausaron mientras el job esperaba en la cola
  if (nicho.estado !== 'activo') return { omitido: true, motivo: `nicho en estado "${nicho.estado}"` }

  const analisis = await analizarNicho(nicho)

  // los descubrimientos del radar que no dan se pausan solos: dejan de gastar scans
  let pausado = false
  if (nicho.origen === 'radar' && analisis.veredicto === 'no_entrar' && nicho.estado === 'activo') {
    nicho.estado = 'pausado'
    await nicho.save()
    pausado = true
  }

  // veredicto de entrada → acotar campos del proveedor solo (agrupa por ventana)
  if (analisis.veredicto !== 'no_entrar') await encolarRfq()

  return { veredicto: analisis.veredicto, pausado }
}

// Acotado RFQ: campos del proveedor en inglés para la planilla, sin regenerar
// análisis. El servicio decide si hay pendientes; si no, no gasta.
export async function procesarRfq() {
  if (!llmDisponible()) return { omitido: true, motivo: 'sin ANTHROPIC_API_KEY' }
  const gastado = await gastoDelMes()
  if (gastado >= config.presupuestoUsdMes) {
    return { omitido: true, motivo: `presupuesto mensual agotado (US$ ${gastado.toFixed(2)} de ${config.presupuestoUsdMes})` }
  }
  return generarRfqPendientes()
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

  // techo de nichos EN EVALUACIÓN: los que avanzaron en el embudo de compra
  // (cotizando/pedido/vendiendo) ya son negocio y no ocupan cupo de
  // exploración — avanzar o descartar libera espacio para descubrir
  const enEvaluacion = await Nicho.countDocuments({
    estado: 'activo',
    $or: [{ etapaCompra: null }, { etapaCompra: 'evaluando' }],
  })
  const cupo = Math.min(config.radarMaxNichos, Math.max(0, config.radarMaxActivos - enEvaluacion))
  if (cupo === 0) return { omitido: true, motivo: `tope de ${config.radarMaxActivos} nichos en evaluación alcanzado` }

  // búsquedas en alza según el autocompletado (tracker de tendencias): el
  // sugeridor prioriza demanda que ya se ve subiendo en vez de idear desde cero
  let tendencias = []
  try {
    tendencias = lineasEnAlza(await movimientosRecientes())
  } catch (err) {
    console.error(`[radar] tendencias no disponibles: ${err.message}`)
  }

  const { sugerencias } = await sugerirNichos({ tendencias })
  const todos = await Nicho.find().select('keyword estado').lean()
  const existentes = new Set(todos.map((n) => n.keyword))

  // regla dura de diversificación: si una raíz domina el tablero activo
  // (3+ nichos, ej. "solar"), no se abren más nichos que la contengan —
  // el radar explora categorías nuevas en vez de profundizar el embudo
  const saturadas = palabrasSaturadas(todos.filter((n) => n.estado === 'activo').map((n) => n.keyword))

  const creados = []
  let sinValidar = 0
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
    let keyword
    try {
      const real = await keywordReal(ideada)
      if (!real) {
        console.log(`[radar] "${ideada}" descartada: sin búsqueda real parecida en el autocompletado de ML`)
        continue
      }
      keyword = real.keyword
      if (keyword !== ideada) console.log(`[radar] "${ideada}" → búsqueda real "${keyword}"`)
    } catch (err) {
      // ANTES se creaba el nicho con la keyword inventada: de ahí salieron
      // "cascada solar jardin fuente", "lampara solar jardin estaca" y compañía,
      // que pagaron scans y análisis para medir un listado que nadie ve. Sin
      // validación no se crea: el radar vuelve a proponerla mañana.
      console.error(`[radar] "${ideada}" NO se crea: el autocompletado no pudo validarla (${err.message})`)
      sinValidar++
      continue
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

  if (sinValidar) {
    console.warn(`[radar] ${sinValidar} keyword(s) quedaron sin crear porque el autocompletado no respondió`)
  }
  return { sugeridos: sugerencias.length, creados: creados.length, keywords: creados, sinValidar }
}

// Programador: encola scans de nichos activos cuyo último scan ya venció
// (diario ≈ 20 h, semanal ≈ 6.5 días). jobId por ventana de 3 h evita duplicados.
export async function procesarProgramadorScans() {
  const ahora = Date.now()
  const umbrales = { diario: 20 * 3600e3, semanal: 6.5 * 86400e3 }

  // los productos propios se miden por la API oficial ($0), así que corren en
  // DOS ciclos: uno FRECUENTE solo-oficial (una venta se ve en minutos, no al
  // día siguiente) y la pasada COMPLETA diaria (actor para lo que la API no
  // cubre). Ninguno se congela con el techo de presupuesto.
  const propioVencidoFull = await ProductoPropio.exists({
    estado: 'activo',
    $or: [{ ultimoScanEl: null }, { ultimoScanEl: { $lt: new Date(ahora - umbrales.diario) } }],
  })
  const propioVencidoPre =
    propioVencidoFull ||
    Boolean(
      await ProductoPropio.exists({
        estado: 'activo',
        ultimoScanEl: { $lt: new Date(ahora - config.propiosFrecuenciaMin * 60_000) },
      }),
    )
  if (propioVencidoPre) {
    await obtenerColas().propios.add(
      'medir',
      { soloOficial: !propioVencidoFull },
      { jobId: `propios-${Math.floor(ahora / (30 * 60_000))}` },
    )
  }

  const gastado = await gastoDelMes()
  if (gastado >= config.presupuestoUsdMes) {
    return {
      omitido: true,
      motivo: `presupuesto mensual agotado (US$ ${gastado.toFixed(2)} de ${config.presupuestoUsdMes})`,
      propiosEncolados: Boolean(propioVencidoPre),
    }
  }

  // guardián del muro: saldo REAL de Apify (su ciclo va del 16 al 15, no es el
  // mes calendario del contador interno) — frenar al 90% en vez de chocar con
  // 3 reintentos quemados por job como el 2-ago
  try {
    const saldo = await saldoApify()
    if (saldo.topeUsd && saldo.gastadoUsd >= saldo.topeUsd * 0.9) {
      return {
        omitido: true,
        motivo: `Apify al ${Math.round((saldo.gastadoUsd / saldo.topeUsd) * 100)}% del tope real (US$ ${saldo.gastadoUsd.toFixed(0)} de ${saldo.topeUsd})`,
        propiosEncolados: Boolean(propioVencidoPre),
      }
    }
  } catch (err) {
    console.warn(`[programador] saldo Apify no disponible: ${err.message}`)
  }
  const nichos = await Nicho.find({ estado: 'activo' }).lean()

  // un nicho cuyo último reporte quedó SIN score no tiene nada que "refrescar":
  // esperarle la semana lo deja invisible 7 días (caso gua sha / rodillo facial
  // 2026-07-21: nivel 2 sin reseñas → sin score, y el semanal los citaba para
  // el 27). Mientras no haya score, corre con el umbral diario.
  const scores = await Reporte.aggregate([
    { $match: { nichoId: { $in: nichos.map((n) => n._id) } } },
    { $sort: { fecha: -1 } },
    { $group: { _id: '$nichoId', score: { $first: '$scoreOportunidad' } } },
  ])
  const ultimoScore = new Map(scores.map((r) => [String(r._id), r.score ?? null]))

  // MADURACIÓN DE CARTERA: un "entrar" con 1-2 scans es una foto, no evidencia
  // para girar plata. Mientras el nicho tenga veredicto de entrada y menos de
  // maduracionScans reportes con demanda medida, corre con umbral DIARIO —
  // sin tocar frecuenciaScan (el modo lupa sigue siendo decisión manual):
  // al confirmar, vuelve solo a su cadencia propia.
  const veredictos = await Reporte.aggregate([
    { $match: { nichoId: { $in: nichos.map((n) => n._id) }, analisis: { $ne: null } } },
    { $sort: { fecha: -1 } },
    { $group: { _id: '$nichoId', veredicto: { $first: '$analisis.veredicto' } } },
  ])
  const veredictoPorNicho = new Map(veredictos.map((r) => [String(r._id), r.veredicto]))
  const conDemanda = await Reporte.aggregate([
    { $match: { nichoId: { $in: nichos.map((n) => n._id) }, 'metricas.demanda.ventasEstimadasPorDia': { $ne: null } } },
    { $group: { _id: '$nichoId', n: { $sum: 1 } } },
  ])
  const demandaPorNicho = new Map(conDemanda.map((r) => [String(r._id), r.n]))

  const candidatosMaduracion = nichos.filter((n) => {
    const id = String(n._id)
    return (
      ['entrar', 'entrar_con_condiciones'].includes(veredictoPorNicho.get(id)) &&
      (demandaPorNicho.get(id) ?? 0) < config.maduracionScans &&
      !['descartado', 'en-espera', 'vendiendo'].includes(n.etapaCompra ?? 'evaluando')
    )
  })
  // la CARTERA (cotizando/pedido: ya hay intención de compra) madura a diario
  // SIN cupo — regla del usuario 30-jul: un nicho donde se está por girar plata
  // no espera fila. El cupo maduracionMax solo acota la EXPLORACIÓN (evaluando),
  // donde los de mayor score entran primero y el resto espera lugar.
  const esCarteraMadurando = (n) => ['cotizando', 'pedido'].includes(n.etapaCompra ?? 'evaluando')
  const exploracionEnCupo = candidatosMaduracion
    .filter((n) => !esCarteraMadurando(n))
    .sort((a, b) => (ultimoScore.get(String(b._id)) ?? 0) - (ultimoScore.get(String(a._id)) ?? 0))
    .slice(0, config.maduracionMax)
  const enMaduracion = new Set(
    [...candidatosMaduracion.filter(esCarteraMadurando), ...exploracionEnCupo].map((n) => String(n._id)),
  )

  let encolados = 0
  let sinScore = 0
  for (const nicho of nichos) {
    const id = String(nicho._id)
    const ultimo = nicho.ultimoScanEl ? new Date(nicho.ultimoScanEl).getTime() : 0
    const nuncaPuntuo = (ultimoScore.get(id) ?? null) == null
    const madurando = enMaduracion.has(id)
    // la cadencia es AUTOMÁTICA desde el 29-jul: diario mientras el nicho está
    // puntuando o madurando en cartera; semanal el resto. frecuenciaScan quedó
    // como campo legado y ya no la decide nadie a mano.
    const umbral = nuncaPuntuo || madurando ? umbrales.diario : umbrales.semanal
    if (ahora - ultimo < umbral) continue
    if (nuncaPuntuo) sinScore++
    await encolarScanNicho(nicho._id, {
      motivo: madurando ? 'maduracion' : 'programado',
      jobId: `prog-${nicho._id}-${Math.floor(ahora / (3 * 3600e3))}`,
    })
    encolados++
  }
  const madurandoTotal = enMaduracion.size

  // descartados estacionales cuya ventana llegó: vuelven solos a evaluación
  // (la cadencia la decide la maduración de cartera desde ahí en adelante)
  const porVolver = await Nicho.find({ estado: 'pausado', revisarEl: { $lte: new Date() } })
  let vueltasTemporada = 0
  for (const volvedor of porVolver) {
    volvedor.estado = 'activo'
    volvedor.etapaCompra = 'evaluando'
    volvedor.frecuenciaScan = 'semanal'
    volvedor.revisarEl = null
    volvedor.vueltaTemporadaEl = new Date()
    await volvedor.save()
    await encolarScanNicho(volvedor._id, { motivo: 'temporada' })
    console.log(`[programador] "${volvedor.keyword}" vuelve por temporada: re-escaneando para la próxima ventana`)
    vueltasTemporada++
  }

  return { activos: nichos.length, encolados, sinScore, madurando: madurandoTotal, vueltasTemporada, propiosEncolados: Boolean(propioVencidoPre) }
}

export async function procesarScanPropios(job) {
  const gastado = await gastoDelMes()
  // con el techo alcanzado se mide igual, pero SOLO por la API oficial ($0):
  // el actor de respaldo (pagado) espera al presupuesto del próximo mes
  const soloOficial = job?.data?.soloOficial === true || gastado >= config.presupuestoUsdMes
  // la pasada completa diaria además reconoce sola publicaciones nuevas del
  // vendedor (el botón Importar queda solo para forzarlo a mano)
  if (!soloOficial) {
    try {
      const imp = await importarMisItems()
      if (imp.importados) console.log(`[scan-propios] auto-import: ${imp.importados} publicación(es) nueva(s)`)
    } catch (err) {
      console.warn(`[scan-propios] auto-import omitido: ${err.message}`)
    }
  }
  return escanearPropios({ soloOficial })
}

// Optimizador semanal de Mis productos: cablea nichos faltantes, re-audita lo
// vencido o lo que cambió de título, y revisa fichas nuevas. Sin apretar nada.
export async function procesarOptimizadorPropios(job) {
  const { optimizarPropios, revisarFichasPendientes } = await import('../services/optimizador.js')
  const r = await optimizarPropios({
    motivo: job?.data?.motivo ?? 'programado',
    encolarAuditoria: (propio) =>
      obtenerColas().propios.add(
        'auditar',
        { propioId: String(propio._id) },
        { jobId: `auditar-${propio._id}-${Date.now()}` },
      ),
  })
  if (r.omitido) return r
  const fichas = await revisarFichasPendientes().catch((err) => ({ error: err.message }))
  return { ...r, fichas }
}

// Auditoría de listing de un producto propio vs los ganadores de su nicho.
// El error queda escrito en el documento: el dashboard lo muestra sin tener
// que mirar la cola.
export async function procesarAuditoriaPropio(job) {
  const propio = await ProductoPropio.findById(job.data.propioId)
  if (!propio) return { omitido: true, motivo: 'producto propio eliminado' }
  const { auditarPropio } = await import('../services/auditor.js')
  try {
    const auditoria = await auditarPropio(propio)
    return {
      generadoEl: auditoria.generadoEl,
      competidores: auditoria.competidores.length,
      fotosAnalizadas: auditoria.fotosAnalizadas,
      costoUsd: auditoria.costoUsd,
      modelo: auditoria.modelo,
    }
  } catch (err) {
    propio.auditoria = { estado: 'error', error: err.message, generadoEl: new Date() }
    propio.markModified('auditoria')
    await propio.save()
    throw err
  }
}

// Tendencias: snapshot diario del ranking del autocompletado de ML.
// No gasta Apify ni LLM, así que no pasa por el techo de presupuesto.
export async function procesarTendencias() {
  return capturarTendencias()
}

// ¿Alguien busca la keyword del nicho? Misma fuente que tendencias (gratis):
// marca los nichos cuya búsqueda no existe, que son los que el radar inventa.
export async function procesarNivelBusqueda(job) {
  const { medirNichosPendientes } = await import('../services/nivelBusqueda.js')
  return medirNichosPendientes({
    dias: config.nivelBusquedaDias,
    max: config.nivelBusquedaMax,
    forzar: job?.data?.forzar === true,
  })
}

// Estratega semanal: una llamada LLM sobre el tablero completo con acciones
// priorizadas. Respeta el techo de presupuesto como todo gasto de IA.
export async function procesarEstratega() {
  if (!llmDisponible()) return { omitido: true, motivo: 'IA no configurada (falta ANTHROPIC_API_KEY)' }
  const gastado = await gastoDelMes()
  if (gastado >= config.presupuestoUsdMes) {
    return { omitido: true, motivo: `presupuesto mensual agotado (US$ ${gastado.toFixed(2)} de ${config.presupuestoUsdMes})` }
  }
  const { generarInformeEstratega } = await import('../services/estratega.js')
  const doc = await generarInformeEstratega()
  return { generadoEl: doc.generadoEl, modelo: doc.modelo, costoUsd: doc.costoUsd, acciones: doc.informe.acciones?.length ?? 0 }
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
  // la cola de propios lleva dos trabajos: la medición diaria y la auditoría
  // de listing (job "auditar"), que comparte concurrencia 1 a propósito
  const workerPropios = new Worker(
    COLA_PROPIOS,
    (job) => {
      if (job.name === 'auditar') return procesarAuditoriaPropio(job)
      if (job.name === 'optimizar') return procesarOptimizadorPropios(job)
      return procesarScanPropios(job)
    },
    {
      connection: crearConexionRedis(),
      concurrency: 1,
      maxStalledCount: 3,
    },
  )
  // la cola de tendencias lleva los dos trabajos del autocompletado: la captura
  // del ranking diario y la medición del nivel de búsqueda de cada nicho
  const workerTendencias = new Worker(
    COLA_TENDENCIAS,
    (job) => (job.name === 'nivel-busqueda' ? procesarNivelBusqueda(job) : procesarTendencias(job)),
    {
      connection: crearConexionRedis(),
      concurrency: 1,
      maxStalledCount: 3, // la pasada dura ~1 min; un deploy en medio no debe botarla
    },
  )
  const workerRfq = new Worker(COLA_RFQ, procesarRfq, {
    connection: crearConexionRedis(),
    concurrency: 1,
    maxStalledCount: 3,
  })
  const workerEstratega = new Worker(COLA_ESTRATEGA, procesarEstratega, {
    connection: crearConexionRedis(),
    concurrency: 1,
    maxStalledCount: 3, // una llamada LLM larga; un deploy en medio no debe botarla
  })

  for (const worker of [workerScan, workerDetalle, workerMetricas, workerAnalisis, workerRadar, workerProgramador, workerPropios, workerTendencias, workerRfq, workerEstratega]) {
    worker.on('failed', (job, err) => {
      console.error(`[${worker.name}] job ${job?.id} (intento ${job?.attemptsMade}) falló: ${err.message}`)
    })
    worker.on('completed', (job, resultado) => {
      console.log(`[${worker.name}] job ${job.id} completado:`, JSON.stringify(resultado))
    })
    worker.on('error', (err) => console.error(`[${worker.name}] error de worker:`, err.message))
  }

  return [workerScan, workerDetalle, workerMetricas, workerAnalisis, workerRadar, workerProgramador, workerPropios, workerTendencias, workerRfq, workerEstratega]
}
