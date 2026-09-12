import { Worker } from 'node:worker_threads'
import { OBJETIVO_CONTEXTO } from './contexto.js'

// CPU fuera del event loop de Express y de los otros workers BullMQ.
export function ejecutarEntrenamiento(objetivo, datos, { timeoutMs = 120000 } = {}) {
  if (!['busquedas-google', 'unidades-por-visita', OBJETIVO_CONTEXTO].includes(objetivo)) return Promise.reject(new Error('objetivo ML desconocido'))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./entrenamiento.worker.js', import.meta.url), {
      workerData: { objetivo, datos }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 },
    })
    const terminar = (error, resultado) => {
      clearTimeout(timer)
      worker.removeAllListeners()
      worker.terminate().catch(() => {})
      if (error) reject(error)
      else resolve(resultado)
    }
    const timer = setTimeout(() => terminar(new Error('entrenamiento ML excedió el tiempo máximo')), timeoutMs)
    worker.once('message', (r) => terminar(null, r))
    worker.once('error', (err) => terminar(err))
    worker.once('exit', (code) => terminar(new Error(`worker ML terminó sin resultado (${code})`)))
  })
}
