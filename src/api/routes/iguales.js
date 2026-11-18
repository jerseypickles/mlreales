import { Router } from 'express'
import { ProductoPropio } from '../../models/ProductoPropio.js'

// QUIÉN VENDE LO MISMO (services/iguales.js). Va en su propia ruta y no bajo
// /api/propios a propósito: las respuestas guardadas de Mis productos y del
// plan de campañas se invalidan con cualquier escritura en /api/propios, y
// marcar una publicación como «es el mismo» no cambia ninguna de las dos. El
// dueño marca veinte seguidas; cada una habría mandado a rearmar todo.
const router = Router()
// los errores con `status` (dato inválido, presupuesto agotado) responden con su código; el resto, al manejador general
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => (e?.status ? res.status(e.status).json({ error: e.message }) : next(e)))
const propioDe = async (req, res) => {
  const propio = await ProductoPropio.findById(req.params.id).lean().catch(() => null)
  if (!propio) res.status(404).json({ error: 'producto propio no encontrado' })
  return propio
}

// el precio de cada publicación propia contra los que venden lo mismo, en una línea por producto (lo usa
// Publicidad). Va antes de `/:id`: si no, «resumen» se leería como el id de un producto
router.get(
  '/resumen',
  manejar(async (_req, res) => {
    const { posicionesDePrecio } = await import('../../services/iguales.js')
    res.json({ productos: await posicionesDePrecio() })
  }),
)

// la vista: los confirmados con su precio por unidad, lo que falta revisar y lo descartado
router.get(
  '/:id',
  manejar(async (req, res) => {
    const propio = await propioDe(req, res)
    if (!propio) return
    const { vistaIguales } = await import('../../services/iguales.js')
    res.json(await vistaIguales(propio))
  }),
)

// { sku, relacion: 'igual' | 'otra-medida' | 'distinto' | null, unidades } marca una publicación ajena;
// { lote: 'igual' | 'otra-medida' } confirma de una vez todo lo que la lectura propone con esa relación;
// { unidadesPropias } dice cuántas unidades trae la publicación propia
router.patch(
  '/:id',
  manejar(async (req, res) => {
    const propio = await propioDe(req, res)
    if (!propio) return
    const { vistaIguales, marcarIgual, marcarLote, fijarUnidadesPropias } = await import('../../services/iguales.js')
    const b = req.body ?? {}
    if (b.unidadesPropias != null) await fijarUnidadesPropias(propio, Number(b.unidadesPropias))
    if (b.lote) await marcarLote(propio, b.lote)
    if (b.sku) await marcarIgual(propio, { sku: b.sku, relacion: b.relacion ?? null, unidades: b.unidades != null ? Number(b.unidades) : null })
    res.json(await vistaIguales(await ProductoPropio.findById(req.params.id).lean()))
  }),
)

// mira las fotos de lo que falta revisar y deja sugerencias (no marca nada)
router.post(
  '/:id/sugerir',
  manejar(async (req, res) => {
    const propio = await propioDe(req, res)
    if (!propio) return
    const { vistaIguales, sugerirIguales } = await import('../../services/iguales.js')
    const lectura = await sugerirIguales(propio)
    res.json({ ...(await vistaIguales(propio)), lectura })
  }),
)

export default router
