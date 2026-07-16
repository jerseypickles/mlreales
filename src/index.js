import { validarEnv, config } from './config/env.js'
import { conectarMongo, desconectarMongo } from './db/mongo.js'
import { crearApp } from './api/app.js'
import { iniciarWorkers } from './jobs/workers.js'
import { obtenerColas, cerrarColas, registrarProgramados } from './jobs/queues.js'

validarEnv()

await conectarMongo(config.mongoUri)
console.log('[mongo] conectado')

obtenerColas()
await registrarProgramados()
const workers = iniciarWorkers()
console.log('[bullmq] workers: scan-nicho, scan-detalle, calcular-metricas, analisis, radar, programador')

const servidor = crearApp().listen(config.port, () => {
  console.log(`[api] MELI Intel escuchando en http://localhost:${config.port}`)
})

async function apagar(senal) {
  console.log(`\n[${senal}] cerrando...`)
  servidor.close()
  await Promise.allSettled(workers.map((worker) => worker.close()))
  await cerrarColas()
  await desconectarMongo()
  process.exit(0)
}

process.on('SIGINT', () => apagar('SIGINT'))
process.on('SIGTERM', () => apagar('SIGTERM'))
