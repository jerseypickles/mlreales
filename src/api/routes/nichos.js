import { Router } from 'express'
import { Nicho } from '../../models/Nicho.js'
import { Reporte } from '../../models/Reporte.js'
import { encolarScanNicho, obtenerColas } from '../../jobs/queues.js'
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
                ventasEstimadasPorDia: '$metricas.demanda.ventasEstimadasPorDia',
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
      {
        // el veredicto sale del último reporte CON análisis (los scans nuevos nacen sin él)
        $lookup: {
          from: 'reportes',
          let: { nid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$nichoId', '$$nid'] }, analisis: { $ne: null } } },
            { $sort: { fecha: -1 } },
            { $limit: 1 },
            { $project: { _id: 0, veredicto: '$analisis.veredicto' } },
          ],
          as: 'ultimoAnalisis',
        },
      },
      {
        $addFields: {
          ultimoReporte: { $ifNull: [{ $first: '$ultimoReporte' }, null] },
          veredicto: { $first: '$ultimoAnalisis.veredicto' },
        },
      },
      { $project: { ultimoAnalisis: 0 } },
    ])

    // etapa en proceso por nicho, leída de las colas reales (para el spinner del dashboard)
    const etapas = new Map()
    try {
      const colas = obtenerColas()
      const enEspera = ['waiting', 'delayed', 'prioritized']
      // con Redis caído getJobs no resuelve nunca: acotar con timeout
      const [analisisAct, detallesAct, scansAct, analisisEsp, detallesEsp, scansEsp] = await Promise.race([
        Promise.all([
          colas.analisis.getJobs(['active']),
          colas.scanDetalle.getJobs(['active']),
          colas.scanNicho.getJobs(['active']),
          colas.analisis.getJobs(enEspera),
          colas.scanDetalle.getJobs(enEspera),
          colas.scanNicho.getJobs(enEspera),
        ]),
        new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('timeout')), 1500)),
      ])
      // primero lo que espera turno; lo activo pisa con su etapa real
      for (const j of [...analisisEsp, ...detallesEsp, ...scansEsp])
        if (j?.data?.nichoId) etapas.set(j.data.nichoId, 'cola')
      for (const j of analisisAct) if (j?.data?.nichoId) etapas.set(j.data.nichoId, 'analizando')
      for (const j of detallesAct) if (j?.data?.nichoId) etapas.set(j.data.nichoId, 'detalle')
      for (const j of scansAct) if (j?.data?.nichoId) etapas.set(j.data.nichoId, 'escaneando')
    } catch {
      // sin Redis no hay etapas; la lista funciona igual
    }

    res.json({
      nichos: nichos.map((n) => ({ ...n, enProceso: etapas.get(String(n._id)) ?? null })),
    })
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

    // un scan nuevo crea un reporte sin análisis: entregar el último análisis
    // disponible del nicho mientras no exista uno más fresco
    if (!reporte.analisis) {
      const conAnalisis = await Reporte.findOne({ nichoId: nicho._id, analisis: { $ne: null } })
        .sort({ fecha: -1 })
        .lean()
      if (conAnalisis) reporte.analisis = conAnalisis.analisis
    }

    res.json({
      nicho: {
        id: nicho._id,
        keyword: nicho.keyword,
        domainCode: nicho.domainCode,
        estado: nicho.estado,
        ultimoScanEl: nicho.ultimoScanEl,
        costoUsd: Math.round((nicho.costoUsd ?? 0) * 100) / 100,
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
      // misma regla que el pipeline: descubrimiento del radar que no da, se pausa y deja de gastar
      if (nicho.origen === 'radar' && analisis.veredicto === 'no_entrar' && nicho.estado === 'activo') {
        nicho.estado = 'pausado'
        await nicho.save()
      }
      res.json({ analisis })
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message })
      throw err
    }
  }),
)

// Forzar una pasada del radar autónomo ahora (normalmente corre solo, ver RADAR_CRON)
router.post(
  '/radar',
  manejar(async (_req, res) => {
    if (!llmDisponible()) {
      return res.status(503).json({ error: 'radar no configurado: falta ANTHROPIC_API_KEY en el entorno' })
    }
    const job = await obtenerColas().radar.add('radar', { motivo: 'manual' })
    res.status(202).json({
      radarJobId: job.id,
      mensaje: 'radar encolado: los nichos descubiertos aparecerán solos en la lista en unos minutos',
    })
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

// Evolución del nicho a través de los scans (para los gráficos de tendencia)
router.get(
  '/:id/tendencia',
  manejar(async (req, res) => {
    const nicho = await Nicho.findById(req.params.id)
    if (!nicho) return res.status(404).json({ error: 'nicho no encontrado' })

    const reportes = await Reporte.find({ nichoId: nicho._id }).sort({ fecha: 1 }).lean()
    const puntos = reportes.map((r) => ({
      fecha: r.fecha,
      score: r.scoreOportunidad ?? null,
      mediana: r.metricas?.precio?.mediana ?? null,
      reviewsTotal: r.metricas?.demanda?.reviews?.total ?? null,
      ventasDia: r.metricas?.demanda?.ventasEstimadasPorDia ?? null,
      pctFull: r.metricas?.competencia?.pctFull ?? null,
      sellersUnicos: r.metricas?.competencia?.sellersUnicos ?? null,
    }))

    // señal de aceleración de demanda: compara los dos últimos deltas de reseñas
    let aceleracion = null
    const conReviews = puntos.filter((p) => Number.isFinite(p.reviewsTotal))
    if (conReviews.length >= 3) {
      const [a, b, c] = conReviews.slice(-3)
      const d1 = b.reviewsTotal - a.reviewsTotal
      const d2 = c.reviewsTotal - b.reviewsTotal
      if (d1 > 0 || d2 > 0) {
        aceleracion = d2 > d1 * 1.15 ? 'acelerando' : d2 < d1 * 0.85 ? 'frenando' : 'estable'
      }
    }

    res.json({ puntos, aceleracion })
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
