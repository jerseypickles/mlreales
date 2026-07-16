import { Router } from 'express'
import { config } from '../../config/env.js'
import { ejecutarActorSync, obtenerLogRun } from '../../services/apify.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function autorizado(req, res, next) {
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
    const { items, runId } = await ejecutarActorSync(actorId, input, {
      timeoutMs: 280_000,
      conMeta: true,
    })
    res.json({ cantidad: items.length, runId, actorId, items })
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
