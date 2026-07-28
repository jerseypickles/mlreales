import { Router } from 'express'
import mongoose from 'mongoose'
import { config } from '../../config/env.js'
import { ProductoPropio } from '../../models/ProductoPropio.js'
import { Nicho } from '../../models/Nicho.js'
import { Snapshot } from '../../models/Snapshot.js'
import { extraerSkuDeUrl, posicionesRecientes } from '../../services/propios.js'
import { ventasPorItem } from '../../services/ventasMl.js'
import { llmDisponible } from '../../services/llm.js'
import { gastoDelMes } from '../../services/gastos.js'
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

// Cableado automático de todos los propios sin nicho: por ranking en listados
// trackeados (gratis) o derivando la búsqueda del título con IA; si el nicho
// no existe, se crea y se encola su primer scan
router.post(
  '/auto-cablear',
  manejar(async (_req, res) => {
    const { cablearPropiosAuto } = await import('../../services/cableador.js')
    res.json(await cablearPropiosAuto())
  }),
)

// Cablear (o descablear con null) el nicho contra el que se audita el producto
router.patch(
  '/:id',
  manejar(async (req, res) => {
    const propio = await ProductoPropio.findById(req.params.id)
    if (!propio) return res.status(404).json({ error: 'producto propio no encontrado' })
    if ('nichoId' in (req.body ?? {})) {
      const nichoId = req.body.nichoId
      if (nichoId === null || nichoId === '') {
        propio.nichoId = null
      } else {
        if (!mongoose.isValidObjectId(nichoId) || !(await Nicho.exists({ _id: nichoId }))) {
          return res.status(400).json({ error: 'nichoId inválido: ese nicho no existe' })
        }
        propio.nichoId = nichoId
      }
      await propio.save()
    }
    res.json({ propio })
  }),
)

// Auditoría de listing: mi título/descripción/fotos vs los ganadores del nicho
router.post(
  '/:id/auditar',
  manejar(async (req, res) => {
    const propio = await ProductoPropio.findById(req.params.id)
    if (!propio) return res.status(404).json({ error: 'producto propio no encontrado' })
    if (!propio.nichoId) {
      return res.status(409).json({ error: 'cablea primero un nicho al producto (selector en la fila)' })
    }
    if (!llmDisponible()) {
      return res.status(503).json({ error: 'IA no configurada (falta ANTHROPIC_API_KEY)' })
    }
    const nicho = await Nicho.findById(propio.nichoId).lean()
    if (!nicho) return res.status(409).json({ error: 'el nicho cableado ya no existe; elige otro' })
    if (!(await Snapshot.exists({ keyword: nicho.keyword }))) {
      return res.status(409).json({ error: `el nicho "${nicho.keyword}" no tiene scans todavía; corre un scan primero` })
    }
    const gastado = await gastoDelMes()
    if (gastado >= config.presupuestoUsdMes) {
      return res.status(409).json({
        error: `presupuesto mensual agotado (US$ ${gastado.toFixed(2)} de ${config.presupuestoUsdMes}): la auditoría gasta actor + IA`,
      })
    }
    // una auditoría "generando" por más de 30 min es un job perdido (deploy en
    // el medio): no debe bloquear el relanzamiento para siempre
    const enCurso =
      propio.auditoria?.estado === 'generando' &&
      propio.auditoria.solicitadaEl &&
      Date.now() - new Date(propio.auditoria.solicitadaEl).getTime() < 30 * 60e3
    if (enCurso) {
      return res.status(409).json({ error: 'ya hay una auditoría en curso para este producto' })
    }
    propio.auditoria = { estado: 'generando', solicitadaEl: new Date() }
    propio.markModified('auditoria')
    await propio.save()
    const job = await obtenerColas().propios.add(
      'auditar',
      { propioId: String(propio._id) },
      { jobId: `auditar-${propio._id}-${Date.now()}` },
    )
    res.status(202).json({ auditoriaJobId: job.id })
  }),
)

// Aplicar en ML (API oficial) los arreglos de la auditoría: título y/o descripción
router.post(
  '/:id/aplicar',
  manejar(async (req, res) => {
    const propio = await ProductoPropio.findById(req.params.id)
    if (!propio) return res.status(404).json({ error: 'producto propio no encontrado' })
    const { titulo, descripcion, atributos } = req.body ?? {}
    if (titulo === undefined && descripcion === undefined && atributos === undefined) {
      return res.status(400).json({ error: 'nada que aplicar: manda titulo, descripcion y/o atributos' })
    }
    const { aplicarCambiosPropio } = await import('../../services/aplicador.js')
    res.json({ resultado: await aplicarCambiosPropio(propio, { titulo, descripcion, atributos }) })
  }),
)

// Revisar la ficha técnica (Características) contra la categoría ML y los
// ganadores: propone correcciones aplicables por API
router.post(
  '/:id/ficha',
  manejar(async (req, res) => {
    const propio = await ProductoPropio.findById(req.params.id)
    if (!propio) return res.status(404).json({ error: 'producto propio no encontrado' })
    if (!llmDisponible()) return res.status(503).json({ error: 'IA no configurada (falta ANTHROPIC_API_KEY)' })
    const { revisarFicha } = await import('../../services/ficha.js')
    res.json({ ficha: await revisarFicha(propio) })
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
