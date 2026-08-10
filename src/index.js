import { validarEnv, config } from './config/env.js'
import { conectarMongo, desconectarMongo } from './db/mongo.js'
import { crearApp } from './api/app.js'
import { iniciarWorkers } from './jobs/workers.js'
import { obtenerColas, cerrarColas, registrarProgramados } from './jobs/queues.js'
import { diaChile, prefijosSemilla } from './services/tendencias.js'
import { TendenciaBusqueda } from './models/TendenciaBusqueda.js'
import { limpiarEscapesGuardados } from './services/limpiezaEscapes.js'
import { Nicho } from './models/Nicho.js'

validarEnv()

await conectarMongo(config.mongoUri)
console.log('[mongo] conectado')

obtenerColas()
await registrarProgramados()
// reparar textos guardados con escapes doble-codificados (no bloquea el arranque)
limpiarEscapesGuardados().catch((err) => console.error('[limpieza] falló:', err.message))
// sonda one-shot del endpoint oficial de reseñas (ver services/sondaReviews.js):
// se activa con SONDA_REVIEWS_KEYWORD y se retira la variable tras leer el log
if (process.env.SONDA_REVIEWS_KEYWORD) {
  import('./services/sondaReviews.js')
    .then(({ sondaReviewsTop }) => sondaReviewsTop(process.env.SONDA_REVIEWS_KEYWORD))
    .catch((err) => console.error('[sonda-reviews] falló:', err.message))
}
// inspector de nicho por logs (diagnóstico de "estos productos no corresponden")
if (process.env.SONDA_NICHO_KEYWORD) {
  import('./services/sondaNicho.js')
    .then(({ sondaNicho }) => sondaNicho(process.env.SONDA_NICHO_KEYWORD))
    .catch((err) => console.error('[sonda-nicho] falló:', err.message))
}
// barrido one-shot: pausar nichos por keyword (JSON array en SEED_PAUSAR) —
// para limpiezas dictadas en conversación sin la x-api-key; la env var se
// retira tras verificar el log [barrido]. Pausar es reversible siempre.
if (process.env.SEED_PAUSAR) {
  import('./models/Nicho.js')
    .then(async ({ Nicho }) => {
      for (const keyword of JSON.parse(process.env.SEED_PAUSAR)) {
        const nicho = await Nicho.findOne({ keyword })
        if (!nicho) console.warn(`[barrido] no existe: "${keyword}"`)
        else if (nicho.estado === 'pausado') console.log(`[barrido] ya pausado: "${keyword}"`)
        else {
          nicho.estado = 'pausado'
          nicho.notaEtapa = 'barrido: duplicado de jugada'
          await nicho.save()
          console.log(`[barrido] pausado: "${keyword}"`)
        }
      }
    })
    .catch((err) => console.error('[barrido] falló:', err.message))
}
// siembra one-shot de criterios dictados en conversación (la API exige la
// x-api-key que solo tiene el usuario). JSON array en SEED_CRITERIOS; dedupe
// por texto exacto y la env var se retira tras verificar el log [criterios].
if (process.env.SEED_CRITERIOS) {
  import('./models/Criterio.js')
    .then(async ({ Criterio }) => {
      for (const texto of JSON.parse(process.env.SEED_CRITERIOS)) {
        const ya = await Criterio.findOne({ texto })
        if (ya) console.log(`[criterios] ya existía: ${texto.slice(0, 60)}…`)
        else {
          await Criterio.create({ texto })
          console.log(`[criterios] sembrado: ${texto.slice(0, 60)}…`)
        }
      }
    })
    .catch((err) => console.error('[criterios] siembra falló:', err.message))
}
// migración: la etapa "muestra" se eliminó del embudo (la prueba es el pedido mínimo)
Nicho.updateMany({ etapaCompra: 'muestra' }, { $set: { etapaCompra: 'pedido' } })
  .then((r) => r.modifiedCount && console.log(`[migración] ${r.modifiedCount} nicho(s): muestra → pedido`))
  .catch((err) => console.error('[migración] muestra→pedido falló:', err.message))
// captura de tendencias al arrancar si al día le faltan prefijos (la captura
// upsertea por prefijo, así que re-correrla solo rellena los huecos que dejó el
// WAF de ML). jobId por hora: máximo un reintento por hora aunque haya varios
// deploys, y las dos instancias de un deploy zero-downtime no encolan doble.
if (config.tendenciasActivo) {
  try {
    const dia = diaChile()
    const capturados = await TendenciaBusqueda.countDocuments({ dia })
    const prefijos = await prefijosSemilla()
    if (capturados < prefijos.length) {
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
console.log('[bullmq] workers: scan-nicho, scan-detalle, calcular-metricas, analisis, radar, programador, scan-propios, tendencias-busqueda, estratega')

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
