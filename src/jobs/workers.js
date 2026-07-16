import { Worker } from 'bullmq'
import { config } from '../config/env.js'
import { Nicho } from '../models/Nicho.js'
import { Reporte } from '../models/Reporte.js'
import { buscarNivel1, ejecutarActorAsync } from '../services/apify.js'
import { normalizarScan } from '../services/normalizador.js'
import { indexarDetallesPorSku } from '../services/normalizadorDetalle.js'
import { guardarScan, aplicarDetalleScan } from '../services/persistencia.js'
import { generarReporteNicho } from '../services/metricas.js'
import {
  COLA_SCAN_NICHO,
  COLA_SCAN_DETALLE,
  COLA_CALCULAR_METRICAS,
  crearConexionRedis,
  obtenerColas,
} from './queues.js'

export async function procesarScanNicho(job) {
  const nicho = await Nicho.findById(job.data.nichoId)
  if (!nicho) throw new Error(`Nicho ${job.data.nichoId} no existe`)
  if (nicho.estado !== 'activo') return { omitido: true, motivo: `nicho en estado "${nicho.estado}"` }

  const fecha = new Date()
  const crudos = await buscarNivel1(nicho.keyword, { domainCode: nicho.domainCode })
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
    const top = items
      .sort((a, b) => (a.snapshot.posicion ?? Infinity) - (b.snapshot.posicion ?? Infinity))
      .slice(0, config.detalleTopN)
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
    const batch = objetivos.slice(i, i + config.detalleBatch)
    let crudos
    try {
      crudos = await ejecutarActorAsync(
        config.actorDetails,
        {
          urls: batch.map((o) => o.url),
          max_retries_per_url: 2,
          ignore_url_failures: true,
          proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
        },
        { pollMs: 10_000, timeoutMs: 12 * 60_000 },
      )
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

  if (!aplicados) {
    throw new Error(
      `Nivel 2 no aplicó ningún detalle (${objetivos.length} objetivos, ${fallidos} fallidos, ${sinMatch} sin match de SKU)`,
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
  return { reporteId: String(doc._id), score: reporte.metricas.scoreOportunidad }
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
    concurrency: 1,
    limiter: { max: 2, duration: 60_000 },
  })
  const workerMetricas = new Worker(COLA_CALCULAR_METRICAS, procesarCalcularMetricas, {
    connection: crearConexionRedis(),
    concurrency: 1,
  })

  for (const worker of [workerScan, workerDetalle, workerMetricas]) {
    worker.on('failed', (job, err) => {
      console.error(`[${worker.name}] job ${job?.id} (intento ${job?.attemptsMade}) falló: ${err.message}`)
    })
    worker.on('completed', (job, resultado) => {
      console.log(`[${worker.name}] job ${job.id} completado:`, JSON.stringify(resultado))
    })
    worker.on('error', (err) => console.error(`[${worker.name}] error de worker:`, err.message))
  }

  return [workerScan, workerDetalle, workerMetricas]
}
