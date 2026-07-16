import { Router } from 'express'
import { config } from '../../config/env.js'
import { ejecutarActorSync } from '../../services/apify.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Sonda para validar el output real del actor nivel 2 antes de mapear campos
// (el brief prohíbe asumir su schema). Gastas créditos de Apify: protegida con DEBUG_KEY.
router.post(
  '/nivel2',
  manejar(async (req, res) => {
    if (!process.env.DEBUG_KEY || req.get('x-debug-key') !== process.env.DEBUG_KEY) {
      return res.status(401).json({ error: 'no autorizado' })
    }
    const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, 5) : []
    if (!urls.length) return res.status(400).json({ error: 'urls requeridas (máximo 5)' })

    const items = await ejecutarActorSync(
      config.actorDetails,
      { urls, max_retries_per_url: 2, ignore_url_failures: true, proxy: { useApifyProxy: true } },
      { timeoutMs: 280_000 },
    )
    res.json({ cantidad: items.length, items })
  }),
)

export default router
