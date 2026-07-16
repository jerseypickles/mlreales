import { Worker } from 'bullmq'
import { Nicho } from '../models/Nicho.js'
import { Reporte } from '../models/Reporte.js'
import { buscarNivel1 } from '../services/apify.js'
import { normalizarScan } from '../services/normalizador.js'
import { guardarScan } from '../services/persistencia.js'
import { generarReporteNicho } from '../services/metricas.js'
import { COLA_SCAN_NICHO, COLA_CALCULAR_METRICAS, crearConexionRedis, obtenerColas } from './queues.js'

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

  await obtenerColas().calcularMetricas.add('reporte', { nichoId: String(nicho._id) })

  return {
    ...resultado,
    itemsCrudos: crudos.length,
    descartados,
    totalResultados: totalResultados?.total ?? null,
  }
}

export async function procesarCalcularMetricas(job) {
  const nicho = await Nicho.findById(job.data.nichoId)
  if (!nicho) throw new Error(`Nicho ${job.data.nichoId} no existe`)

  const reporte = await generarReporteNicho(nicho)
  if (!reporte) throw new Error(`No hay snapshots para "${nicho.keyword}": el scan no guardó datos`)

  const doc = await Reporte.create({
    nichoId: nicho._id,
    keyword: nicho.keyword,
    fecha: reporte.fechaScan,
    metricas: reporte.metricas,
    topProductos: reporte.topProductos,
    topSellers: reporte.topSellers,
    scoreOportunidad: reporte.metricas.scoreOportunidad,
  })
  return { reporteId: String(doc._id) }
}

export function iniciarWorkers() {
  // concurrencia 1 + rate limit: cada scan quema créditos de Apify
  const workerScan = new Worker(COLA_SCAN_NICHO, procesarScanNicho, {
    connection: crearConexionRedis(),
    concurrency: 1,
    limiter: { max: 2, duration: 60_000 },
  })
  const workerMetricas = new Worker(COLA_CALCULAR_METRICAS, procesarCalcularMetricas, {
    connection: crearConexionRedis(),
    concurrency: 1,
  })

  for (const worker of [workerScan, workerMetricas]) {
    worker.on('failed', (job, err) => {
      console.error(`[${worker.name}] job ${job?.id} (intento ${job?.attemptsMade}) falló: ${err.message}`)
    })
    worker.on('completed', (job, resultado) => {
      console.log(`[${worker.name}] job ${job.id} completado:`, JSON.stringify(resultado))
    })
    worker.on('error', (err) => console.error(`[${worker.name}] error de worker:`, err.message))
  }

  return [workerScan, workerMetricas]
}
