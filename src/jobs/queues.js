import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { config } from '../config/env.js'

export const COLA_SCAN_NICHO = 'scan-nicho'
export const COLA_SCAN_DETALLE = 'scan-detalle'
export const COLA_CALCULAR_METRICAS = 'calcular-metricas'

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
      connection,
    }
  }
  return colas
}

export async function encolarScanNicho(nichoId, { motivo = 'manual' } = {}) {
  return obtenerColas().scanNicho.add('scan', { nichoId: String(nichoId), motivo })
}

export async function cerrarColas() {
  if (!colas) return
  // si Redis nunca conectó, close() puede no resolver: acotar con timeout
  await Promise.race([
    Promise.allSettled([colas.scanNicho.close(), colas.scanDetalle.close(), colas.calcularMetricas.close()]),
    new Promise((resolver) => setTimeout(resolver, 3000)),
  ])
  colas.connection.disconnect()
  colas = null
}
