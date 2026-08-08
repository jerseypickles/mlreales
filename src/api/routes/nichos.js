import { Router } from 'express'
import { config } from '../../config/env.js'
import { Nicho } from '../../models/Nicho.js'
import { Reporte } from '../../models/Reporte.js'
import { encolarScanNicho, encolarRfq, obtenerColas } from '../../jobs/queues.js'
import { generarReporteNicho, obtenerProductosUltimoScan } from '../../services/metricas.js'
import { analizarNicho } from '../../services/analista.js'
import { generarListing } from '../../services/listero.js'
import { sugerirNichos } from '../../services/sugeridor.js'
import { llmDisponible } from '../../services/llm.js'
import { aCsvExcel, COLUMNAS_PRODUCTO_CSV } from '../../services/csv.js'
import { cambiosPorEtapa, ETAPAS_COMPRA } from '../../services/oportunidades.js'
import { topSkusPorKeyword, agruparFamilias } from '../../services/familias.js'

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
            { $project: { _id: 0, veredicto: '$analisis.veredicto', ventanaCompra: '$analisis.ventanaCompra' } },
          ],
          as: 'ultimoAnalisis',
        },
      },
      {
        // scans con demanda medida: el sidebar oculta score/veredicto mientras
        // el nicho madura (mismo criterio que la maduración del programador)
        $lookup: {
          from: 'reportes',
          let: { nid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$nichoId', '$$nid'] }, 'metricas.demanda.ventasEstimadasPorDia': { $ne: null } } },
            { $count: 'n' },
          ],
          as: 'conteoDemanda',
        },
      },
      {
        $addFields: {
          ultimoReporte: { $ifNull: [{ $first: '$ultimoReporte' }, null] },
          veredicto: { $first: '$ultimoAnalisis.veredicto' },
          ventanaCompra: { $first: '$ultimoAnalisis.ventanaCompra' },
          scansConDemanda: { $ifNull: [{ $first: '$conteoDemanda.n' }, 0] },
        },
      },
      // el sidebar no necesita los blobs pesados
      { $project: { ultimoAnalisis: 0, listingDraft: 0, rfq: 0, contextoUsuario: 0, conteoDemanda: 0 } },
    ])

    for (const n of nichos) {
      n.madurando =
        n.estado === 'activo' &&
        n.scansConDemanda < config.maduracionScans &&
        ['entrar', 'entrar_con_condiciones'].includes(n.veredicto) &&
        !['descartado', 'en-espera', 'vendiendo'].includes(n.etapaCompra ?? 'evaluando')
    }

    // timer del sidebar: cuándo le toca el próximo scan a cada nicho, con el
    // mismo criterio del programador — la cartera (cotizando/pedido) madura a
    // diario sin cupo; el cupo maduracionMax solo acota la exploración
    // (evaluando), que corre semanal mientras espera lugar
    const UMBRAL_SCAN = { diario: 20 * 3600e3, semanal: 6.5 * 86400e3 }
    const esCarteraMadurando = (n) => ['cotizando', 'pedido'].includes(n.etapaCompra ?? 'evaluando')
    const enCupoMaduracion = new Set(
      [
        ...nichos.filter((n) => n.madurando && esCarteraMadurando(n)),
        ...nichos
          .filter((n) => n.madurando && !esCarteraMadurando(n))
          .sort((a, b) => (b.ultimoReporte?.scoreOportunidad ?? 0) - (a.ultimoReporte?.scoreOportunidad ?? 0))
          .slice(0, config.maduracionMax),
      ].map((n) => String(n._id)),
    )
    for (const n of nichos) {
      if (n.estado !== 'activo' || !n.ultimoScanEl) continue
      const diario = n.ultimoReporte?.scoreOportunidad == null || enCupoMaduracion.has(String(n._id))
      n.cadenciaScan = diario ? 'diario' : 'semanal'
      if (n.madurando) n.enCupoMaduracion = enCupoMaduracion.has(String(n._id))
      n.proximoScanEl = new Date(new Date(n.ultimoScanEl).getTime() + UMBRAL_SCAN[n.cadenciaScan])
    }

    // nichos donde el importador YA VENDE (propios cableados): el sidebar los
    // saca del embudo de oportunidades y los agrupa en "Vendiendo"
    try {
      const { ProductoPropio } = await import('../../models/ProductoPropio.js')
      const { ventasPorItem } = await import('../../services/ventasMl.js')
      const propios = await ProductoPropio.find({ nichoId: { $ne: null } }).lean()
      const v30 = await ventasPorItem({ dias: 30 }).catch(() => new Map())
      const porNicho = new Map()
      for (const p of propios) {
        const clave = String(p.nichoId)
        const acc = porNicho.get(clave) ?? { productos: 0, ventas30d: 0 }
        acc.productos++
        acc.ventas30d += v30.get(p.itemIdMl ?? p.sku)?.unidades ?? 0
        porNicho.set(clave, acc)
      }
      for (const n of nichos) {
        const mio = porNicho.get(String(n._id))
        if (mio) {
          n.misProductos = mio.productos
          n.misVentas30d = mio.ventas30d
        }
      }
    } catch {
      // sin datos de propios el sidebar funciona igual
    }

    // etapa en proceso por nicho, leída de las colas reales (para el spinner del dashboard)
    const etapas = new Map()
    try {
      const colas = obtenerColas()
      const enEspera = ['waiting', 'prioritized']
      // con Redis caído getJobs no resuelve nunca: acotar con timeout
      const [analisisAct, detallesAct, scansAct, analisisEsp, detallesEsp, scansEsp, retrasados] = await Promise.race([
        Promise.all([
          colas.analisis.getJobs(['active']),
          colas.scanDetalle.getJobs(['active']),
          colas.scanNicho.getJobs(['active']),
          colas.analisis.getJobs(enEspera),
          colas.scanDetalle.getJobs(enEspera),
          colas.scanNicho.getJobs(enEspera),
          colas.scanDetalle.getJobs(['delayed']),
        ]),
        new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('timeout')), 1500)),
      ])
      // reintentos programados (bloqueo de ML) primero; la espera real y lo activo pisan.
      // un reintento de un scan ya superado por otro más nuevo se va a descartar solo:
      // no confundir a la UI mostrándolo como pendiente
      const ultimoScanPorNicho = new Map(
        nichos.map((n) => [String(n._id), n.ultimoScanEl ? new Date(n.ultimoScanEl).getTime() : 0]),
      )
      for (const j of retrasados) {
        const id = j?.data?.nichoId
        if (!id) continue
        const fechaScan = j.data.fechaScan ? new Date(j.data.fechaScan).getTime() : 0
        if ((ultimoScanPorNicho.get(id) ?? 0) - fechaScan > 30 * 60_000) continue
        etapas.set(id, 'reintento')
      }
      for (const j of [...analisisEsp, ...detallesEsp, ...scansEsp])
        if (j?.data?.nichoId) etapas.set(j.data.nichoId, 'cola')
      for (const j of analisisAct) if (j?.data?.nichoId) etapas.set(j.data.nichoId, 'analizando')
      for (const j of detallesAct) if (j?.data?.nichoId) etapas.set(j.data.nichoId, 'detalle')
      for (const j of scansAct) if (j?.data?.nichoId) etapas.set(j.data.nichoId, 'escaneando')
    } catch {
      // sin Redis no hay etapas; la lista funciona igual
    }

    // familias (mismo mercado por solape de SKUs): el sidebar anida las
    // keywords duplicadas bajo su líder (el de mayor score) en cada grupo
    try {
      const porScore = [...nichos].sort(
        (a, b) => (b.ultimoReporte?.scoreOportunidad ?? -1) - (a.ultimoReporte?.scoreOportunidad ?? -1),
      )
      const filas = porScore.map((n) => ({
        keyword: n.keyword,
        familiaAparte: n.familiaAparte ?? [],
        jugadaDeKeyword: n.jugadaDe?.keyword ?? null,
      }))
      const skus = await topSkusPorKeyword(filas.map((f) => f.keyword))
      const { deMiembro } = agruparFamilias(filas, skus)
      for (const n of nichos) {
        const m = deMiembro.get(n.keyword)
        n.familiaLider = m?.lider ?? null
        n.familiaSolapePct = m?.solapePct ?? null
        n.esJugadaDelLider = m?.esJugadaDelLider ?? false
      }
    } catch (err) {
      console.warn(`[nichos] familias no calculadas: ${err.message}`)
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
    // disponible del nicho mientras no exista uno más fresco — y registrar de
    // QUÉ scan salió, para avisar en la UI cuando quedó desactualizado
    let analisisDe = reporte.analisis ? reporte.fecha : null
    if (!reporte.analisis) {
      const conAnalisis = await Reporte.findOne({ nichoId: nicho._id, analisis: { $ne: null } })
        .sort({ fecha: -1 })
        .lean()
      if (conAnalisis) {
        reporte.analisis = conAnalisis.analisis
        analisisDe = conAnalisis.fecha
      }
    }

    // conteo de scans y cuántos llegaron DESPUÉS del análisis mostrado: la señal
    // de "hay data nueva que el veredicto no vio, regenera"
    const totalScans = await Reporte.countDocuments({ nichoId: nicho._id })
    const trasAnalisis = analisisDe
      ? await Reporte.countDocuments({ nichoId: nicho._id, fecha: { $gt: analisisDe } })
      : 0

    // maduración: mientras junta la serie, la UI trata el análisis como
    // preliminar (mismo criterio que el programador y el sidebar)
    const scansConDemanda = await Reporte.countDocuments({
      nichoId: nicho._id,
      'metricas.demanda.ventasEstimadasPorDia': { $ne: null },
    })
    const madurando =
      nicho.estado === 'activo' &&
      scansConDemanda < config.maduracionScans &&
      ['entrar', 'entrar_con_condiciones'].includes(reporte.analisis?.veredicto) &&
      !['descartado', 'en-espera', 'vendiendo'].includes(nicho.etapaCompra ?? 'evaluando')

    res.json({
      scans: { total: totalScans, trasAnalisis, analisisDe, conDemanda: scansConDemanda, madurando },
      nicho: {
        id: nicho._id,
        keyword: nicho.keyword,
        domainCode: nicho.domainCode,
        estado: nicho.estado,
        ultimoScanEl: nicho.ultimoScanEl,
        costoUsd: Math.round((nicho.costoUsd ?? 0) * 100) / 100,
        contextoUsuario: nicho.contextoUsuario ?? null,
        listingDraft: nicho.listingDraft ?? null,
        frecuenciaScan: nicho.frecuenciaScan,
        etapaCompra: nicho.etapaCompra ?? 'evaluando',
        revisarEl: nicho.revisarEl ?? null,
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

// Productos del último scan como CSV listo para Excel chileno
router.get(
  '/:id/productos.csv',
  manejar(async (req, res) => {
    const nicho = await Nicho.findById(req.params.id)
    if (!nicho) return res.status(404).json({ error: 'nicho no encontrado' })

    const vista = await obtenerProductosUltimoScan(nicho)
    if (!vista) return res.status(404).json({ error: 'aún no hay scans completados para este nicho' })

    const filas = vista.productos.map((p) => ({ ...p, fechaScan: vista.fechaScan }))
    const archivo = `productos-${nicho.keyword.replace(/\s+/g, '-')}.csv`
    res
      .set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${archivo}"`)
      .send(aCsvExcel(filas, COLUMNAS_PRODUCTO_CSV))
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
      // veredicto de entrada → acotar los campos del proveedor solo
      if (analisis.veredicto !== 'no_entrar') await encolarRfq()
      res.json({ analisis })
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message })
      throw err
    }
  }),
)

// Borrador de listing con IA: títulos ≤60, ficha técnica, descripción y checklist
router.post(
  '/:id/listing',
  manejar(async (req, res) => {
    if (!llmDisponible()) {
      return res.status(503).json({ error: 'listing IA no configurado: falta ANTHROPIC_API_KEY en el entorno' })
    }
    const nicho = await Nicho.findById(req.params.id)
    if (!nicho) return res.status(404).json({ error: 'nicho no encontrado' })
    try {
      const listing = await generarListing(nicho)
      res.json({ listing })
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message })
      throw err
    }
  }),
)

// Ajustar un nicho a mano: pausar/reactivar o cambiar su cadencia de scan
// (diario = modo lupa para el nicho al que le vas a poner plata; semanal = seguimiento)
const ajustarNicho = manejar(async (req, res) => {
  const cambios = {}
  const { estado, frecuenciaScan, contextoUsuario, etapaCompra, notaEtapa, revisarEl, exwCotizadoUsd, unidadesPedido } = req.body ?? {}
  if (unidadesPedido !== undefined) {
    // cantidad del pedido editada a mano en la planilla (pisa la sugerida por
    // el análisis; null = volver a la sugerencia)
    if (unidadesPedido === null || unidadesPedido === '') {
      cambios.unidadesPedido = null
    } else {
      const n = Number(unidadesPedido)
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'unidadesPedido inválido (> 0)' })
      cambios.unidadesPedido = Math.round(n)
    }
  }
  if (exwCotizadoUsd !== undefined) {
    if (exwCotizadoUsd === null || exwCotizadoUsd === '') {
      cambios.exwCotizadoUsd = null
      cambios.exwCotizadoEl = null
    } else {
      const n = Number(exwCotizadoUsd)
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'exwCotizadoUsd inválido (> 0)' })
      cambios.exwCotizadoUsd = n
      cambios.exwCotizadoEl = new Date()
    }
  }
  if (revisarEl !== undefined) {
    if (revisarEl === null || revisarEl === '') {
      cambios.revisarEl = null
    } else {
      const fecha = new Date(revisarEl)
      if (Number.isNaN(fecha.getTime())) return res.status(400).json({ error: 'revisarEl inválida' })
      cambios.revisarEl = fecha
    }
  }
  if (notaEtapa !== undefined) {
    const nota = String(notaEtapa ?? '').trim()
    if (nota.length > 200) return res.status(400).json({ error: 'notaEtapa demasiado larga (máx 200)' })
    cambios.notaEtapa = nota || null
  }
  if (etapaCompra !== undefined) {
    if (!ETAPAS_COMPRA.includes(etapaCompra)) {
      return res.status(400).json({ error: `etapaCompra debe ser una de: ${ETAPAS_COMPRA.join(', ')}` })
    }
    const actual = await Nicho.findById(req.params.id).select('etapaCompra').lean()
    if (!actual) return res.status(404).json({ error: 'nicho no encontrado' })
    Object.assign(cambios, cambiosPorEtapa(etapaCompra, actual))
  }
  if (req.body?.familiaAparte !== undefined) {
    // "mantener aparte": marca el par como falso positivo del agrupador de familias
    const kw = String(req.body.familiaAparte ?? '').trim().toLowerCase()
    if (!kw) return res.status(400).json({ error: 'familiaAparte requiere la keyword del otro nicho' })
    const doc = await Nicho.findByIdAndUpdate(req.params.id, { $addToSet: { familiaAparte: kw } }, { new: true })
    if (!doc) return res.status(404).json({ error: 'nicho no encontrado' })
    if (Object.keys(req.body).length === 1) return res.json({ nicho: doc })
  }
  if (contextoUsuario !== undefined) {
    const texto = String(contextoUsuario ?? '').trim()
    if (texto.length > 2000) {
      return res.status(400).json({ error: 'contextoUsuario demasiado largo (máx 2000 caracteres)' })
    }
    cambios.contextoUsuario = texto || null
  }
  if (estado !== undefined) {
    if (!['activo', 'pausado'].includes(estado)) {
      return res.status(400).json({ error: 'estado debe ser "activo" o "pausado"' })
    }
    cambios.estado = estado
  }
  if (frecuenciaScan !== undefined) {
    if (!['diario', 'semanal'].includes(frecuenciaScan)) {
      return res.status(400).json({ error: 'frecuenciaScan debe ser "diario" o "semanal"' })
    }
    cambios.frecuenciaScan = frecuenciaScan
  }
  if (!Object.keys(cambios).length) {
    return res.status(400).json({ error: 'nada que cambiar: enviar estado y/o frecuenciaScan' })
  }
  const nicho = await Nicho.findByIdAndUpdate(req.params.id, cambios, { new: true })
  if (!nicho) return res.status(404).json({ error: 'nicho no encontrado' })
  res.json({
    keyword: nicho.keyword,
    estado: nicho.estado,
    frecuenciaScan: nicho.frecuenciaScan,
    contextoUsuario: nicho.contextoUsuario ?? null,
    etapaCompra: nicho.etapaCompra ?? 'evaluando',
  })
})
router.patch('/:id', ajustarNicho)
router.patch('/:id/estado', ajustarNicho) // compatibilidad con la ruta original

// Medir la jugada del análisis como sub-nicho (botón en la pestaña Análisis):
// canoniza a búsqueda real, deduplica y respeta presupuesto — proponer es de
// la IA, gastar es del importador (regla del 23-jul, caso minipimer)
router.post(
  '/:id/medir-jugada',
  manejar(async (req, res) => {
    const nicho = await Nicho.findById(req.params.id)
    if (!nicho) return res.status(404).json({ error: 'nicho no encontrado' })
    const conAnalisis = await Reporte.findOne({ nichoId: nicho._id, analisis: { $ne: null } })
      .sort({ fecha: -1 })
      .lean()
    const keywordJugada = conAnalisis?.analisis?.keywordJugada
    if (!keywordJugada) {
      return res.status(409).json({ error: 'el análisis vigente no declara una keyword de jugada' })
    }
    const { crearSubNichoDeJugada } = await import('../../services/subnichos.js')
    const hijo = await crearSubNichoDeJugada(nicho, { keywordJugada, veredicto: conAnalisis.analisis.veredicto })
    if (!hijo) {
      return res
        .status(409)
        .json({ error: 'no se creó: ya existe un nicho para esa búsqueda, no es una búsqueda real, o el presupuesto está agotado' })
    }
    res.status(201).json({ nicho: hijo })
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
      canasta: r.metricas?.demanda?.reviews?.itemsComparables ?? null,
      saltosFiltrados:
        (r.metricas?.demanda?.reviews?.saltosFiltrados ?? 0) +
          (r.metricas?.demanda?.reviews?.duplicadosCatalogo ?? 0) || null,
    }))

    // señal de aceleración: compara las dos últimas velocidades depuradas
    // (reviews.porDia ya viene normalizada por días y limpia de saltos de
    // catálogo); el total del top mezcla canastas distintas y mentía
    let aceleracion = null
    const velocidades = reportes
      .map((r) => r.metricas?.demanda?.reviews?.porDia)
      .filter(Number.isFinite)
    if (velocidades.length >= 2) {
      const [d1, d2] = velocidades.slice(-2)
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
