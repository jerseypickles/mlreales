import { Router } from 'express'
import { obtenerColas } from '../../jobs/queues.js'
import { resumenSeguimiento } from '../../services/seguimientoStock.js'

const router = Router()
// Vendedores chicos seguidos por stock: quién vende, cuánto como mínimo, y la
// calibración contra las publicaciones propias. ?nicho=keyword acota.
router.get('/', async (req, res) => {
  const keyword = typeof req.query.nicho === 'string' && req.query.nicho.trim() ? req.query.nicho.trim().toLowerCase() : null
  res.json(await resumenSeguimiento({ keyword }))
})
router.post('/pasada', async (_req, res) => {
  const job = await obtenerColas().tendencias.add('seguimiento-stock', {}, { jobId: `seguimiento-manual-${Math.floor(Date.now() / 300000)}` })
  res.status(202).json({ jobId: job.id })
})
export default router
