import { Router } from 'express'
import { obtenerColas } from '../../jobs/queues.js'
import { movimientosRecientes, prefijosSemilla } from '../../services/tendencias.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Búsquedas en alza según el autocompletado de ML: último snapshot de cada
// prefijo vs el de ~`dias` atrás (default 7)
router.get(
  '/',
  manejar(async (req, res) => {
    const dias = Math.min(Math.max(Number(req.query.dias) || 7, 1), 30)
    const movimientos = await movimientosRecientes({ dias })
    res.json({ dias, total: movimientos.length, movimientos })
  }),
)

// Forzar una captura ahora (normalmente corre sola, ver TENDENCIAS_CRON)
router.post(
  '/capturar',
  manejar(async (_req, res) => {
    const prefijos = await prefijosSemilla()
    const job = await obtenerColas().tendencias.add('capturar', { motivo: 'manual' })
    res.status(202).json({
      jobId: job.id,
      prefijos,
      mensaje: 'captura encolada: ~2s por prefijo, ver movimientos en GET /api/tendencias',
    })
  }),
)

export default router
