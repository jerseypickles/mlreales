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

// Lista con serie de mediciones, posición orgánica, ventas reales (orders),
// conversión visitas→ventas, margen real 30d y calibración del factor
router.get(
  '/',
  manejar(async (_req, res) => {
    const propios = await ProductoPropio.find().sort({ creadoEl: -1 }).lean()
    const posiciones = await posicionesRecientes(propios.map((p) => p.sku))
    const ventas = await ventasPorItem({ dias: 30 }).catch(() => new Map())
    const ventas7 = await ventasPorItem({ dias: 7 }).catch(() => new Map())
    const { evaluarImpacto } = await import('../../services/impacto.js')
    const { comisionMlExacta } = await import('../../services/comisionesMl.js')
    const { calibracionFactor } = await import('../../services/calibracion.js')
    const { VentaMl } = await import('../../models/VentaMl.js')

    const lista = []
    for (const p of propios) {
      const v30 = ventas.get(p.itemIdMl ?? p.sku) ?? null
      const v7 = ventas7.get(p.itemIdMl ?? p.sku) ?? null
      const ultima = (p.mediciones ?? []).at(-1) ?? null
      // ambas ventanas son de 7 días: conversión honesta visitas→ventas
      const visitas7 = Number.isFinite(ultima?.visitas) ? ultima.visitas : null
      const conversion7d =
        v7?.unidades && visitas7 > 0 ? Math.min(100, Math.round((v7.unidades / visitas7) * 1000) / 10) : null

      // margen real 30d: ingresos − comisión ML exacta − costo puesto en bodega
      let margen30d = null
      if (v30?.unidades > 0 && p.costoUnitarioClp != null && p.categoriaMl) {
        const com = await comisionMlExacta({
          precioClp: v30.ingresosClp / v30.unidades,
          categoriaId: p.categoriaMl,
        }).catch(() => null)
        if (Number.isFinite(com?.pct)) {
          const comisionClp = Math.round((com.pct / 100) * v30.ingresosClp + (com.cargoFijoClp ?? 0) * v30.unidades)
          const costoClp = Math.round(p.costoUnitarioClp * v30.unidades)
          margen30d = { margenClp: v30.ingresosClp - comisionClp - costoClp, comisionClp, costoClp }
        }
      }

      lista.push({
        ...p,
        posicionReciente: posiciones.get(p.sku) ?? null,
        ventas30d: v30,
        ventas7d: v7,
        conversion7d,
        margen30d,
        impacto: evaluarImpacto(p),
      })
    }

    const todasLasVentas = await VentaMl.find().lean().catch(() => [])
    res.json({ propios: lista, calibracion: calibracionFactor(propios, todasLasVentas) })
  }),
)

// Resumen para el chip del topbar: ventas de hoy (hora Chile) y de la semana
router.get(
  '/ventas-resumen',
  manejar(async (_req, res) => {
    const { VentaMl } = await import('../../models/VentaMl.js')
    const { diaChile } = await import('../../services/tendencias.js')
    const desde = new Date(Date.now() - 7 * 86400e3)
    const ventas = await VentaMl.find({ fecha: { $gte: desde } }).lean()
    const hoy = diaChile()
    const sumar = (lista) => ({
      unidades: lista.reduce((s, v) => s + (v.items ?? []).reduce((a, i) => a + (i.cantidad ?? 0), 0), 0),
      ingresosClp: lista.reduce((s, v) => s + (v.totalClp ?? 0), 0),
    })
    res.json({ hoy: sumar(ventas.filter((v) => diaChile(v.fecha) === hoy)), semana: sumar(ventas) })
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

// Pasada completa del optimizador ahora (lo mismo que corre solo cada martes)
router.post(
  '/optimizar',
  manejar(async (_req, res) => {
    const job = await obtenerColas().propios.add(
      'optimizar',
      { motivo: 'manual' },
      { jobId: `optimizar-${Date.now()}` },
    )
    res.status(202).json({ jobId: job.id })
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
    if ('costoUnitarioClp' in (req.body ?? {})) {
      const costo = req.body.costoUnitarioClp
      if (costo !== null && (!Number.isFinite(costo) || costo < 0)) {
        return res.status(400).json({ error: 'costoUnitarioClp debe ser un número ≥ 0 (o null para borrarlo)' })
      }
      propio.costoUnitarioClp = costo
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
