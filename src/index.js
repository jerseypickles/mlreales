import { validarEnv, config } from './config/env.js'
import { conectarMongo, desconectarMongo } from './db/mongo.js'
import { crearApp } from './api/app.js'
import { iniciarWorkers } from './jobs/workers.js'
import { obtenerColas, cerrarColas, registrarProgramados } from './jobs/queues.js'
import { diaChile } from './services/tendencias.js'
import { TendenciaBusqueda } from './models/TendenciaBusqueda.js'

validarEnv()

await conectarMongo(config.mongoUri)
console.log('[mongo] conectado')

obtenerColas()
await registrarProgramados()
// captura de tendencias al arrancar si el día aún no tiene snapshots: el
// baseline del autocompletado se asegura desde hoy, y un día que quedó en cero
// (ML bloqueando) se reintenta en el próximo deploy. jobId por hora evita que
// las dos instancias de un deploy zero-downtime encolen doble.
if (config.tendenciasActivo) {
  try {
    const dia = diaChile()
    const hayHoy = await TendenciaBusqueda.exists({ dia })
    if (!hayHoy) {
      await obtenerColas().tendencias.add(
        'capturar',
        { motivo: 'arranque' },
        { jobId: `tendencias-arranque-${dia}-${new Date().getUTCHours()}` },
      )
    }
  } catch (err) {
    console.error('[tendencias] no se pudo encolar la captura de arranque:', err.message)
  }
}
const workers = iniciarWorkers()
console.log('[bullmq] workers: scan-nicho, scan-detalle, calcular-metricas, analisis, radar, programador, scan-propios, tendencias-busqueda')

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
