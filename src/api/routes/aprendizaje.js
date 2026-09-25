import { Router } from 'express'
import { config } from '../../config/env.js'
import { obtenerColas } from '../../jobs/queues.js'
import { estadoMl, perfilesPropiosMl, seriesActuales } from '../../services/ml/servicio.js'
import { PrediccionMl } from '../../models/PrediccionMl.js'
import { ModeloMl } from '../../models/ModeloMl.js'
import { predecirComercial } from '../../services/ml/comercial.js'
import { isObjectIdOrHexString } from 'mongoose'
import { contextoActual } from '../../services/ml/integracion.js'
import { OBJETIVO_CONTEXTO } from '../../services/ml/contexto.js'

const router = Router()
router.get('/', async (_req, res) => res.json({ activo: config.mlActivo, ...await estadoMl() }))
router.get('/perfiles', async (_req, res) => res.json({ perfiles: await perfilesPropiosMl() }))
// La historia mensual tal como se entrena: permite reproducir una evaluación
// fuera del servidor sin volver a pagarle al proveedor.
router.get('/series', async (_req, res) => {
  const series = await seriesActuales()
  res.json({ series: series.map((s) => ({ keyword: s.keyword, capturadoEl: s.capturadoEl, meses: s.meses.map((m) => ({ periodo: m.periodo, valor: m.valor })) })) })
})
router.get('/afinidad', async (req, res) => {
  const precio = Number(req.query.precio)
  const categoria = typeof req.query.categoria === 'string' ? req.query.categoria : null
  if (!categoria || !Number.isFinite(precio) || precio <= 0 || !['true', 'false'].includes(req.query.full)) {
    return res.status(400).json({ error: 'categoria, precio positivo y full=true|false requeridos' })
  }
  const nichoId = req.query.nichoId
  if (nichoId !== undefined && (typeof nichoId !== 'string' || !isObjectIdOrHexString(nichoId))) return res.status(400).json({ error: 'nichoId inválido' })
  const objetivo = nichoId ? OBJETIVO_CONTEXTO : 'unidades-por-visita'
  const ahora = new Date()
  const modelo = await ModeloMl.findOne({ objetivo, 'resultado.estado': 'sombra',
    creadoEl: { $gte: new Date(+ahora - 90 * 86400e3), $lte: ahora } }).sort({ creadoEl: -1 }).lean()
  const enlace = nichoId ? await contextoActual({ nichoId, precio, ahora }) : null
  const prediccion = modelo ? predecirComercial(modelo.resultado, { categoria, precio, full: req.query.full === 'true', contexto: enlace?.contexto }) : null
  res.json({ modo: 'sombra', objetivo, modeloId: modelo?._id ?? null, prediccion,
    motivo: prediccion ? null : enlace?.motivo || 'sin modelo suficiente o candidato fuera de categorías, precios, logística o contexto observados' })
})
router.get('/pronosticos', async (req, res) => {
  const filtro = typeof req.query.keyword === 'string' ? { keyword: req.query.keyword.trim().slice(0, 120) } : {}
  const pronosticos = await PrediccionMl.find(filtro).sort({ emitidoEl: -1 }).limit(100).lean()
  res.json({ modo: 'sombra', objetivo: 'busquedas-google', pronosticos })
})
// UN PRONÓSTICO POR NICHO, NO POR PALABRA. El historial se mide para cada
// variante ("brochas", "brochas de maquillaje", "brochas de maquillajes") y la
// lista cruda mostraba las tres como si fueran tres mercados. Acá cada nicho
// activo aparece una vez, con la palabra que de verdad se le mide.
// EL ORDEN, NO EL NÚMERO. El modelo falla en cuánto se va a buscar (lo
// arrastra la deriva común del mercado) pero acierta cuál nicho crece más que
// otro: del quinto que marca arriba, 3,9-4,4 de cada 10 lo hacen (azar: 2).
// Por eso se entrega el lugar de cada nicho entre todos, con la emisión más
// reciente y solo los meses que todavía no pasaron.
export function ordenarPorTendencia(nichos) {
  const puntaje = (n) => {
    const futuros = n.meses.filter((m) => m.real === null && m.estimado > 0 && m.referencia > 0)
    const ultima = Math.max(...futuros.map((m) => +new Date(m.emitidoEl)))
    const vigentes = futuros.filter((m) => ultima - +new Date(m.emitidoEl) < 2 * 86400e3)
    if (!vigentes.length) return null
    return vigentes.reduce((a, m) => a + Math.log(m.estimado / m.referencia), 0) / vigentes.length
  }
  const conPuntaje = nichos.map((n) => ({ n, v: puntaje(n) })).filter((x) => x.v !== null).sort((a, b) => a.v - b.v)
  const lugar = new Map(conPuntaje.map((x, i) => [x.n, { percentil: conPuntaje.length > 1 ? i / (conPuntaje.length - 1) : 0.5,
    vsAnioPasadoPct: Math.round(Math.expm1(x.v) * 100) }]))
  return nichos.map((n) => ({ ...n, tendencia: lugar.has(n) ? { ...lugar.get(n), entre: conPuntaje.length,
    grupo: lugar.get(n).percentil >= 0.8 ? 'arriba' : lugar.get(n).percentil <= 0.2 ? 'abajo' : 'medio' } : null }))
}

router.get('/pronosticos-nichos', async (_req, res) => {
  const { Nicho } = await import('../../models/Nicho.js')
  const { CurvaEstacional } = await import('../../models/CurvaEstacional.js')
  const nichos = await Nicho.find({ estado: 'activo' }).select('keyword veredicto etapaCompra').lean()
  const curvas = new Map((await CurvaEstacional.find({ keyword: { $in: nichos.map((n) => n.keyword) } })
    .select('keyword keywordMedida busquedasMes nombreMesPico clasificacion').lean()).map((c) => [c.keyword, c]))
  const candidatas = new Map()
  for (const n of nichos) candidatas.set(n.keyword, [curvas.get(n.keyword)?.keywordMedida, n.keyword].filter(Boolean))
  const todas = [...new Set([...candidatas.values()].flat())]
  // la emisión más reciente de cada palabra y mes
  const filas = await PrediccionMl.aggregate([
    { $match: { keyword: { $in: todas } } }, { $sort: { emitidoEl: -1 } },
    { $group: { _id: { keyword: '$keyword', periodo: '$periodo' }, p: { $first: '$$ROOT' } } },
  ])
  const porKeyword = new Map()
  for (const { p } of filas) porKeyword.set(p.keyword, [...(porKeyword.get(p.keyword) ?? []), p])
  const salida = []
  for (const n of nichos) {
    const medida = candidatas.get(n.keyword).find((k) => porKeyword.has(k))
    if (!medida) continue
    const c = curvas.get(n.keyword)
    salida.push({ nichoId: n._id, nicho: n.keyword, keywordMedida: medida, veredicto: n.veredicto ?? null, etapaCompra: n.etapaCompra ?? null,
      busquedasMes: c?.busquedasMes ?? null, mesPico: c?.nombreMesPico ?? null, clasificacion: c?.clasificacion ?? null,
      meses: porKeyword.get(medida).sort((a, b) => a.periodo.localeCompare(b.periodo)).map((p) => ({ periodo: p.periodo,
        estimado: p.datos?.estimado ?? null, referencia: p.datos?.referencia ?? null, inferior: p.datos?.inferior ?? null, superior: p.datos?.superior ?? null,
        real: p.evaluacion?.real ?? null, emitidoEl: p.emitidoEl })) })
  }
  res.json({ modo: 'sombra', nichos: ordenarPorTendencia(salida) })
})
// Cuánto del panel de competidores (Snapshot) sirve para entrenar, con los
// descartes por motivo. Solo lectura; cacheado 10 minutos.
router.get('/competidores', async (req, res) => {
  const { auditoriaPanelCompetidores } = await import('../../services/ml/competidores.js')
  const dias = Math.min(180, Math.max(7, Number(req.query.dias) || 90))
  res.json(await auditoriaPanelCompetidores({ dias }))
})
// Modelo en sombra: qué hace vender a una publicación, aprendido del panel de
// competidores y probado en nichos que no vio. Cacheado 30 minutos.
router.get('/competidores/modelo', async (_req, res) => {
  const { modeloCompetidores } = await import('../../services/ml/modeloCompetidores.js')
  res.json(await modeloCompetidores())
})
// Lectura diaria de reseñas de la competencia: cuánto del panel va leído hoy
// y cuántas lecturas hubo cada día. POST encola una pasada ahora.
router.get('/resenias-diarias', async (_req, res) => {
  const { estadoResenias } = await import('../../services/reseniasDiarias.js')
  res.json(await estadoResenias())
})
router.post('/resenias-diarias', async (_req, res) => {
  const job = await obtenerColas().tendencias.add('resenias-diarias', {}, { jobId: `resenias-manual-${Math.floor(Date.now() / 300000)}` })
  res.status(202).json({ jobId: job.id })
})
// Qué eventos del calendario mueven qué nichos, aprendido de todas las series
// de búsqueda (4 años): fuerza, repetición y picos sin explicar.
router.get('/temporadas', async (_req, res) => {
  const { mapaDeTemporadas } = await import('../../services/ml/temporadas.js')
  const series = await seriesActuales()
  res.json(mapaDeTemporadas(series.map((s) => ({ keyword: s.keyword, meses: s.meses }))))
})
// Cuántas ventas hay detrás de cada reseña, por tres métodos independientes.
// MODO AUDITORÍA: no cambia ningún número de la app.
router.get('/calibracion-resenias', async (_req, res) => {
  const { calibracionResenias } = await import('../../services/ml/calibracionResenias.js')
  res.json(await calibracionResenias())
})
// El panorama de ML: árbol de categorías, ranking de todas las categorías
// finales y búsquedas que suben. POST encola una pasada ahora.
router.get('/panorama', async (_req, res) => {
  const { estadoPanorama } = await import('../../services/panoramaMl.js')
  res.json(await estadoPanorama())
})
router.post('/panorama', async (_req, res) => {
  const job = await obtenerColas().tendencias.add('panorama-ml', {}, { jobId: `panorama-manual-${Math.floor(Date.now() / 300000)}` })
  res.status(202).json({ jobId: job.id })
})
// Publicaciones que aparecieron hace poco en un nicho que ya se escaneaba y
// ya suben de posición, ganan reseñas o cambian de balde.
router.get('/nuevos-que-despegan', async (_req, res) => {
  const { productosNuevosQueDespegan } = await import('../../services/nuevosQueDespegan.js')
  res.json({ productos: await productosNuevosQueDespegan() })
})
router.post('/entrenar', async (_req, res) => {
  if (!config.mlActivo) return res.status(409).json({ error: 'ML_ACTIVO=false' })
  const job = await obtenerColas().tendencias.add('entrenar-ml', {}, {
    // Una solicitud repetida no llena la cola ni repite el mismo entrenamiento.
    jobId: `ml-manual-${Math.floor(Date.now() / 3600000)}`,
  })
  res.status(202).json({ jobId: job.id, modo: 'sombra' })
})
export default router
