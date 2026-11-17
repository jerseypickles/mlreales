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

// { sku, relacion: 'igual' | 'distinto' | null, unidades } marca una publicación ajena;
// { unidadesPropias } dice cuántas unidades trae la publicación propia
router.patch(
  '/:id',
  manejar(async (req, res) => {
    const propio = await propioDe(req, res)
    if (!propio) return
    const { vistaIguales, marcarIgual, fijarUnidadesPropias } = await import('../../services/iguales.js')
    const b = req.body ?? {}
    if (b.unidadesPropias != null) await fijarUnidadesPropias(propio, Number(b.unidadesPropias))
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
