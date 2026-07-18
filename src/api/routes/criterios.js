import { Router } from 'express'
import { Criterio } from '../../models/Criterio.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

router.get(
  '/',
  manejar(async (_req, res) => {
    const criterios = await Criterio.find().sort({ creadoEl: 1 }).lean()
    res.json({ total: criterios.length, criterios })
  }),
)

router.post(
  '/',
  manejar(async (req, res) => {
    const texto = String(req.body?.texto ?? '').trim()
    if (texto.length < 5) return res.status(400).json({ error: 'texto requerido (mín 5 caracteres)' })
    if (texto.length > 300) return res.status(400).json({ error: 'texto demasiado largo (máx 300)' })
    const criterio = await Criterio.create({ texto })
    res.status(201).json({ criterio })
  }),
)

router.patch(
  '/:id',
  manejar(async (req, res) => {
    const cambios = {}
    const { texto, activo } = req.body ?? {}
    if (texto !== undefined) {
      const limpio = String(texto).trim()
      if (limpio.length < 5 || limpio.length > 300) {
        return res.status(400).json({ error: 'texto debe tener entre 5 y 300 caracteres' })
      }
      cambios.texto = limpio
    }
    if (activo !== undefined) cambios.activo = Boolean(activo)
    if (!Object.keys(cambios).length) return res.status(400).json({ error: 'nada que cambiar' })
    const criterio = await Criterio.findByIdAndUpdate(req.params.id, cambios, { new: true })
    if (!criterio) return res.status(404).json({ error: 'criterio no encontrado' })
    res.json({ criterio })
  }),
)

router.delete(
  '/:id',
  manejar(async (req, res) => {
    const criterio = await Criterio.findByIdAndDelete(req.params.id)
    if (!criterio) return res.status(404).json({ error: 'criterio no encontrado' })
    res.json({ eliminado: true })
  }),
)

export default router
