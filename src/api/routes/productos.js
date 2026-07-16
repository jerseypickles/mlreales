import { Router } from 'express'
import { Producto } from '../../models/Producto.js'
import { Snapshot } from '../../models/Snapshot.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Serie temporal de un producto: precio, posición (vendidos desde Fase 2)
router.get(
  '/:sku/historia',
  manejar(async (req, res) => {
    const sku = req.params.sku.toUpperCase()
    const producto = await Producto.findOne({ sku }).lean()
    if (!producto) return res.status(404).json({ error: 'producto no encontrado' })

    const limite = Math.min(Number(req.query.limit) || 90, 365)
    const snapshots = await Snapshot.find({ sku }).sort({ fecha: -1 }).limit(limite).lean()

    res.json({ producto, snapshots: snapshots.reverse() })
  }),
)

export default router
