import { Router } from 'express'
import { ProductoPropio } from '../../models/ProductoPropio.js'
import { extraerSkuDeUrl, posicionesRecientes } from '../../services/propios.js'
import { ventasPorItem } from '../../services/ventasMl.js'
import { obtenerColas } from '../../jobs/queues.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Registrar un producto propio por URL de ML y medirlo al tiro
router.post(
  '/',
  manejar(async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
    const sku = extraerSkuDeUrl(url)
    if (!sku) {
      return res.status(400).json({ error: 'URL de Mercado Libre inválida: no se encontró el ID del producto (MLC…)' })
    }
    const existente = await ProductoPropio.findOne({ sku })
    if (existente) return res.status(409).json({ error: 'ese producto ya está registrado', propio: existente })

    const propio = await ProductoPropio.create({ sku, url })
    const job = await obtenerColas().propios.add('medir', {}, { jobId: `propios-alta-${Date.now()}` })
    res.status(201).json({ propio, scanJobId: job.id })
  }),
)

// Lista con serie de mediciones, posición orgánica y ventas reales 30d (orders)
router.get(
  '/',
  manejar(async (_req, res) => {
    const propios = await ProductoPropio.find().sort({ creadoEl: -1 }).lean()
    const posiciones = await posicionesRecientes(propios.map((p) => p.sku))
    const ventas = await ventasPorItem({ dias: 30 }).catch(() => new Map())
    res.json({
      propios: propios.map((p) => ({
        ...p,
        posicionReciente: posiciones.get(p.sku) ?? null,
        ventas30d: ventas.get(p.itemIdMl ?? p.sku) ?? null,
      })),
    })
  }),
)

// Medir todos ahora
router.post(
  '/scan',
  manejar(async (_req, res) => {
    const job = await obtenerColas().propios.add('medir', {}, { jobId: `propios-manual-${Date.now()}` })
    res.status(202).json({ scanJobId: job.id })
  }),
)

router.delete(
  '/:id',
  manejar(async (req, res) => {
    const borrado = await ProductoPropio.findByIdAndDelete(req.params.id)
    if (!borrado) return res.status(404).json({ error: 'producto propio no encontrado' })
    res.json({ eliminado: borrado.sku })
  }),
)

export default router
