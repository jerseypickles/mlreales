import { Router } from 'express'
import { Nicho } from '../../models/Nicho.js'
import { Reporte } from '../../models/Reporte.js'
import { encolarScanNicho } from '../../jobs/queues.js'
import { generarReporteNicho, obtenerProductosUltimoScan } from '../../services/metricas.js'
import { analizarNicho } from '../../services/analista.js'
import { sugerirNichos } from '../../services/sugeridor.js'
import { llmDisponible } from '../../services/llm.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Crear nicho y encolar su primer scan
router.post(
  '/',
  manejar(async (req, res) => {
    const keyword = typeof req.body?.keyword === 'string' ? req.body.keyword.trim().toLowerCase() : ''
    if (keyword.length < 2 || keyword.length > 80) {
      return res.status(400).json({ error: 'keyword requerida (2 a 80 caracteres)' })
    }
    const frecuenciaScan = req.body?.frecuenciaScan ?? 'diario'
    if (!['diario', 'semanal'].includes(frecuenciaScan)) {
      return res.status(400).json({ error: 'frecuenciaScan debe ser "diario" o "semanal"' })
    }
    const domainCode = (req.body?.domainCode ?? 'CL').toUpperCase()

    const existente = await Nicho.findOne({ keyword, domainCode })
    if (existente) {
      return res.status(409).json({
        error: 'el nicho ya existe; usar POST /api/nichos/:id/scan para re-escanear',
        nichoId: existente._id,
      })
    }

    const nicho = await Nicho.create({ keyword, domainCode, frecuenciaScan })
    const job = await encolarScanNicho(nicho._id, { motivo: 'creacion' })
    res.status(201).json({ nicho, scanJobId: job.id })
  }),
)

// Listar nichos con resumen de su último reporte
router.get(
  '/',
  manejar(async (_req, res) => {
    const nichos = await Nicho.aggregate([
      { $sort: { creadoEl: -1 } },
      {
        $lookup: {
          from: 'reportes',
          let: { nid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$nichoId', '$$nid'] } } },
            { $sort: { fecha: -1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 0,
                fecha: 1,
                scoreOportunidad: 1,
                precioMediana: '$metricas.precio.mediana',
                sellersUnicos: '$metricas.competencia.sellersUnicos',
                pctFull: '$metricas.competencia.pctFull',
                productosAnalizados: '$metricas.universo.productosAnalizados',
              },
            },
          ],
          as: 'ultimoReporte',
        },
      },
      { $addFields: { ultimoReporte: { $ifNull: [{ $first: '$ultimoReporte' }, null] } } },
    ])
    res.json({ nichos })
  }),
)

// Scorecard completo + top productos + top sellers del último scan
router.get(
  '/:id/reporte',
  manejar(async (req, res) => {
    const nicho = await Nicho.findById(req.params.id)
    if (!nicho) return res.status(404).json({ error: 'nicho no encontrado' })

    let reporte = await Reporte.findOne({ nichoId: nicho._id }).sort({ fecha: -1 }).lean()
    if (!reporte) {
      // hay snapshots pero el job de métricas aún no corrió: calcular al vuelo
      const calculado = await generarReporteNicho(nicho)
      if (!calculado) {
        return res.status(404).json({ error: 'aún no hay scans completados para este nicho' })
      }
      const doc = await Reporte.create({
        nichoId: nicho._id,
        keyword: nicho.keyword,
        fecha: calculado.fechaScan,
        metricas: calculado.metricas,
        topProductos: calculado.topProductos,
        topSellers: calculado.topSellers,
      })
      reporte = doc.toObject()
    }

    res.json({
      nicho: {
        id: nicho._id,
        keyword: nicho.keyword,
        domainCode: nicho.domainCode,
        estado: nicho.estado,
        ultimoScanEl: nicho.ultimoScanEl,
      },
      reporte,
    })
  }),
)

// Todos los productos del último scan (para la tabla del dashboard)
router.get(
  '/:id/productos',
  manejar(async (req, res) => {
    const nicho = await Nicho.findById(req.params.id)
    if (!nicho) return res.status(404).json({ error: 'nicho no encontrado' })

    const vista = await obtenerProductosUltimoScan(nicho)
    if (!vista) return res.status(404).json({ error: 'aún no hay scans completados para este nicho' })

    res.json({ fechaScan: vista.fechaScan, total: vista.productos.length, productos: vista.productos })
  }),
)

// Análisis con IA: veredicto de entrada, segmentos y recomendación de compra
router.post(
  '/:id/analisis',
  manejar(async (req, res) => {
    if (!llmDisponible()) {
      return res.status(503).json({ error: 'análisis IA no configurado: falta ANTHROPIC_API_KEY en el entorno' })
    }
    const nicho = await Nicho.findById(req.params.id)
    if (!nicho) return res.status(404).json({ error: 'nicho no encontrado' })
    try {
      const analisis = await analizarNicho(nicho)
      res.json({ analisis })
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message })
      throw err
    }
  }),
)

// Sugerencias de nichos por temporada/tendencia (calendario chileno + lead time de importación)
router.post(
  '/sugerencias',
  manejar(async (req, res) => {
    if (!llmDisponible()) {
      return res.status(503).json({ error: 'sugerencias IA no configuradas: falta ANTHROPIC_API_KEY en el entorno' })
    }
    try {
      const resultado = await sugerirNichos({ contexto: req.body?.contexto })
      res.json(resultado)
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message })
      throw err
    }
  }),
)

// Forzar scan manual
router.post(
  '/:id/scan',
  manejar(async (req, res) => {
    const nicho = await Nicho.findById(req.params.id)
    if (!nicho) return res.status(404).json({ error: 'nicho no encontrado' })
    const job = await encolarScanNicho(nicho._id, { motivo: 'manual' })
    res.status(202).json({ scanJobId: job.id, keyword: nicho.keyword })
  }),
)

export default router
