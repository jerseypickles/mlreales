import { Router } from 'express'
import { config } from '../../config/env.js'
import { obtenerColas } from '../../jobs/queues.js'
import { estadoMl, perfilesPropiosMl } from '../../services/ml/servicio.js'
import { PrediccionMl } from '../../models/PrediccionMl.js'
import { ModeloMl } from '../../models/ModeloMl.js'
import { predecirComercial } from '../../services/ml/comercial.js'
import { isObjectIdOrHexString } from 'mongoose'
import { contextoActual } from '../../services/ml/integracion.js'
import { OBJETIVO_CONTEXTO } from '../../services/ml/contexto.js'

const router = Router()
router.get('/', async (_req, res) => res.json({ activo: config.mlActivo, ...await estadoMl() }))
router.get('/perfiles', async (_req, res) => res.json({ perfiles: await perfilesPropiosMl() }))
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
router.post('/entrenar', async (_req, res) => {
  if (!config.mlActivo) return res.status(409).json({ error: 'ML_ACTIVO=false' })
  const job = await obtenerColas().tendencias.add('entrenar-ml', {}, {
    // Una solicitud repetida no llena la cola ni repite el mismo entrenamiento.
    jobId: `ml-manual-${Math.floor(Date.now() / 3600000)}`,
  })
  res.status(202).json({ jobId: job.id, modo: 'sombra' })
})
export default router
