import { Router } from 'express'
import { Producto } from '../../models/Producto.js'
import { Snapshot } from '../../models/Snapshot.js'
import { Nicho } from '../../models/Nicho.js'
import { obtenerProductosUltimoScan } from '../../services/metricas.js'
import { aCsvExcel, COLUMNAS_PRODUCTO_CSV } from '../../services/csv.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Todos los productos del último scan de cada nicho activo, aplanados para la
// planilla global. Sin `preguntas` (pesadas y no tabulares).
async function productosGlobales() {
  const nichos = await Nicho.find({ estado: 'activo' }).select('keyword').lean()
  const filas = []
  for (const nicho of nichos) {
    const vista = await obtenerProductosUltimoScan(nicho)
    if (!vista) continue
    for (const p of vista.productos) {
      const { preguntas, ...resto } = p
      filas.push({ nicho: nicho.keyword, nichoId: nicho._id, fechaScan: vista.fechaScan, ...resto })
    }
  }
  return filas
}

// Planilla global (JSON)
router.get(
  '/',
  manejar(async (_req, res) => {
    const productos = await productosGlobales()
    res.json({ total: productos.length, productos })
  }),
)

// Planilla global (CSV listo para Excel chileno)
router.get(
  '/export.csv',
  manejar(async (_req, res) => {
    const productos = await productosGlobales()
    const columnas = [{ clave: 'nicho', titulo: 'Nicho' }, ...COLUMNAS_PRODUCTO_CSV]
    res
      .set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="productos-meli-intel.csv"`)
      .send(aCsvExcel(productos, columnas))
  }),
)

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
