import { Router } from 'express'
import { config } from '../../config/env.js'
import { ejecutarActorSync, iniciarRun, estadoRun, obtenerLogRun } from '../../services/apify.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function autorizado(req, res, next) {
  // con API_KEY global activa, el middleware de app.js ya validó la request
  if (process.env.API_KEY) return next()
  if (!process.env.DEBUG_KEY || req.get('x-debug-key') !== process.env.DEBUG_KEY) {
    return res.status(401).json({ error: 'no autorizado' })
  }
  next()
}

// Sonda para validar el output real de actores candidatos (el brief prohíbe asumir
// schemas). Acepta `input` arbitrario y `actorId` opcional para probar alternativas.
router.post(
  '/nivel2',
  autorizado,
  manejar(async (req, res) => {
    const actorId = typeof req.body?.actorId === 'string' ? req.body.actorId : config.actorDetails
    let input = req.body?.input
    if (!input) {
      const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, 5) : []
      if (!urls.length) return res.status(400).json({ error: 'urls o input requeridos' })
      input = { urls, max_retries_per_url: 2, ignore_url_failures: true, proxy: { useApifyProxy: true } }
    }
    // esperar=false: iniciar y devolver el runId al tiro (el proxy de Render
    // corta respuestas de +100s); los items se leen con GET /run/:id/items
    if (req.body?.esperar === false) {
      const { runId } = await iniciarRun(actorId, input)
      return res.status(202).json({ runId, actorId })
    }
    const { items, runId } = await ejecutarActorSync(actorId, input, {
      timeoutMs: 280_000,
      conMeta: true,
    })
    res.json({ cantidad: items.length, runId, actorId, items })
  }),
)

// Sonda de LECTURA de la API oficial de ML con el token de la cuenta conectada
// (diagnóstico de escrituras rechazadas: ver el item crudo, tags, catálogo).
// Solo GET y solo rutas /items|/users|/reviews: jamás escribe.
router.get(
  '/meli',
  autorizado,
  manejar(async (req, res) => {
    const ruta = typeof req.query.ruta === 'string' ? req.query.ruta : ''
    if (!/^\/(items|users|user-products|reviews|categories|sites)\//.test(ruta)) {
      return res
        .status(400)
        .json({ error: 'ruta inválida: solo /items/…, /users/…, /user-products/…, /reviews/…, /categories/…, /sites/…' })
    }
    const { meliGet } = await import('../../services/meli.js')
    res.json(await meliGet(ruta))
  }),
)

// Sonda del autocompletado real de ML (ordenado por volumen): valida qué
// escribe la gente de verdad antes de decidir keywords de título/nicho
router.get(
  '/busquedas',
  autorizado,
  manejar(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (q.length < 2) return res.status(400).json({ error: 'q requerida (mínimo 2 caracteres)' })
    const { sugerenciasReales } = await import('../../services/busquedasReales.js')
    res.json({ q, sugerencias: await sugerenciasReales(q, { limit: Number(req.query.limit) || 8 }) })
  }),
)

// Estado + items de un run lanzado con esperar=false
router.get(
  '/run/:id/items',
  autorizado,
  manejar(async (req, res) => {
    const r = await estadoRun(req.params.id)
    res.json({ estado: r.estado, costoUsd: r.costoUsd, cantidad: r.items?.length ?? null, items: r.items })
  }),
)

// Log del run para diagnosticar corridas vacías
router.get(
  '/run/:id/log',
  autorizado,
  manejar(async (req, res) => {
    const log = await obtenerLogRun(req.params.id)
    res.type('text/plain').send(log.slice(-15_000))
  }),
)

export default router
