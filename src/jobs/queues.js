import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { config } from '../config/env.js'

export const COLA_SCAN_NICHO = 'scan-nicho'
export const COLA_SCAN_DETALLE = 'scan-detalle'
export const COLA_CALCULAR_METRICAS = 'calcular-metricas'
export const COLA_ANALISIS = 'analisis-nicho'
export const COLA_RADAR = 'radar'
export const COLA_PROGRAMADOR = 'programador-scans'

// Criterio Fase 1: 3 intentos con backoff exponencial (5s, 10s, 20s) y el job
// queda en `failed` con el mensaje legible de ApifyError como failedReason.
export const opcionesJob = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 1000 },
}

export function crearConexionRedis() {
  const conexion = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: (intentos) => Math.min(intentos * 500, 10_000),
  })
  conexion.on('error', (err) => console.error('[redis]', err.message))
  return conexion
}

let colas = null

export function obtenerColas() {
  if (!colas) {
    const connection = crearConexionRedis()
    colas = {
      scanNicho: new Queue(COLA_SCAN_NICHO, { connection, defaultJobOptions: opcionesJob }),
      scanDetalle: new Queue(COLA_SCAN_DETALLE, { connection, defaultJobOptions: opcionesJob }),
      calcularMetricas: new Queue(COLA_CALCULAR_METRICAS, { connection, defaultJobOptions: opcionesJob }),
      analisis: new Queue(COLA_ANALISIS, { connection, defaultJobOptions: opcionesJob }),
      radar: new Queue(COLA_RADAR, { connection, defaultJobOptions: opcionesJob }),
      programador: new Queue(COLA_PROGRAMADOR, { connection, defaultJobOptions: opcionesJob }),
      connection,
    }
  }
  return colas
}

export async function encolarScanNicho(nichoId, { motivo = 'manual', jobId } = {}) {
  return obtenerColas().scanNicho.add('scan', { nichoId: String(nichoId), motivo }, jobId ? { jobId } : undefined)
}

// Cron nativo de BullMQ: el radar (semanal) y el programador de scans (cada 30 min).
// upsert es idempotente: se re-registra en cada arranque sin duplicar.
export async function registrarProgramados() {
  const colas = obtenerColas()
  await colas.programador.upsertJobScheduler(
    'scans-pendientes',
    { pattern: config.programadorCron, tz: 'America/Santiago' },
    { name: 'programar', data: {} },
  )
  if (config.radarActivo) {
    await colas.radar.upsertJobScheduler(
      'radar-periodico',
      { pattern: config.radarCron, tz: 'America/Santiago' },
      { name: 'radar', data: { motivo: 'programado' } },
    )
  } else {
    await colas.radar.removeJobScheduler('radar-periodico').catch(() => {})
  }
}

export async function cerrarColas() {
  if (!colas) return
  // si Redis nunca conectó, close() puede no resolver: acotar con timeout
  await Promise.race([
    Promise.allSettled([
      colas.scanNicho.close(),
      colas.scanDetalle.close(),
      colas.calcularMetricas.close(),
      colas.analisis.close(),
      colas.radar.close(),
      colas.programador.close(),
    ]),
    new Promise((resolver) => setTimeout(resolver, 3000)),
  ])
  colas.connection.disconnect()
  colas = null
}
