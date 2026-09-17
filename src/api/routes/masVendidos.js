import { Router } from 'express'
import { obtenerColas } from '../../jobs/queues.js'
import { rankingsConMovimiento, entradasAlTop } from '../../services/rankingMasVendidos.js'

const router = Router()
// El ranking oficial de más vendidos por categoría, con lo que se movió.
// ?nicho=keyword acota a la categoría de ese nicho.
router.get('/', async (req, res) => {
  const nicho = typeof req.query.nicho === 'string' && req.query.nicho.trim() ? req.query.nicho.trim().toLowerCase() : null
  res.json({ categorias: await rankingsConMovimiento({ nicho }), entradas: nicho ? undefined : await entradasAlTop() })
})
router.post('/capturar', async (_req, res) => {
  const job = await obtenerColas().tendencias.add('ranking-mas-vendidos', {}, { jobId: `ranking-manual-${Math.floor(Date.now() / 3600000)}` })
  res.status(202).json({ jobId: job.id })
})
export default router
