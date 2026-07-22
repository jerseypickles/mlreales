import { Router } from 'express'
import { Nicho } from '../../models/Nicho.js'
import { cambiosPorEtapa, ETAPAS_COMPRA } from '../../services/oportunidades.js'
import { tableroOportunidades } from '../../services/tablero.js'
import { generarRfqPendientes, claveRespaldo } from '../../services/rfq.js'
import { llmDisponible } from '../../services/llm.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Panel de decisión (el armado vive en services/tablero.js, compartido con el
// estratega semanal). Con ?todos=1 devuelve TODO lo analizado — fuente de la
// planilla de recomendaciones IA.
router.get(
  '/',
  manejar(async (req, res) => {
    const todos = req.query.todos === '1' || req.query.todos === 'true'
    const oportunidades = await tableroOportunidades({ todos })
    res.json({ total: oportunidades.length, oportunidades })
  }),
)

// Avanza varios nichos de etapa de una vez (ej: los incluidos en una descarga
// de planilla pasan a "cotizando")
router.post(
  '/avanzar',
  manejar(async (req, res) => {
    const { nichoIds, etapa } = req.body ?? {}
    if (!Array.isArray(nichoIds) || !nichoIds.length) {
      return res.status(400).json({ error: 'nichoIds requerido (lista no vacía)' })
    }
    if (!ETAPAS_COMPRA.includes(etapa)) {
      return res.status(400).json({ error: `etapa debe ser una de: ${ETAPAS_COMPRA.join(', ')}` })
    }
    let avanzados = 0
    for (const id of nichoIds.slice(0, 100)) {
      const nicho = await Nicho.findById(id).select('etapaCompra').lean().catch(() => null)
      if (!nicho) continue
      await Nicho.updateOne({ _id: id }, { $set: cambiosPorEtapa(etapa, nicho) })
      avanzados++
    }
    res.json({ avanzados, etapa })
  }),
)

// Unir compras a mano: nichos que se surten con el MISMO producto de fábrica
// pero que el acotador dejó con claves distintas. La clave manual sobrevive a
// cualquier regeneración del acotador (rfq.claveManual).
router.post(
  '/unir',
  manejar(async (req, res) => {
    const { nichoIds } = req.body ?? {}
    if (!Array.isArray(nichoIds) || nichoIds.length < 2) {
      return res.status(400).json({ error: 'se necesitan al menos 2 nichos para unir' })
    }
    const nichos = await Nicho.find({ _id: { $in: nichoIds } }).select('keyword rfq').lean()
    if (nichos.length < 2) return res.status(404).json({ error: 'nichos no encontrados' })
    const base = nichos.find((n) => n.rfq?.productoClave) ?? nichos[0]
    const clave = base.rfq?.productoClave ?? claveRespaldo(base.keyword)
    await Nicho.updateMany(
      { _id: { $in: nichoIds } },
      { $set: { 'rfq.productoClave': clave, 'rfq.claveManual': true } },
    )
    res.json({ unidos: nichos.length, productoClave: clave })
  }),
)

// Separar una compra unida: cada nicho vuelve a su propia clave (derivada de
// su keyword), también fijada como manual para que el acotador no re-fusione
router.post(
  '/separar',
  manejar(async (req, res) => {
    const { nichoIds } = req.body ?? {}
    if (!Array.isArray(nichoIds) || !nichoIds.length) {
      return res.status(400).json({ error: 'nichoIds requerido (lista no vacía)' })
    }
    const nichos = await Nicho.find({ _id: { $in: nichoIds } }).select('keyword').lean()
    for (const n of nichos) {
      await Nicho.updateOne(
        { _id: n._id },
        { $set: { 'rfq.productoClave': claveRespaldo(n.keyword), 'rfq.claveManual': true } },
      )
    }
    res.json({ separados: nichos.length })
  }),
)

// Acota con IA los campos del proveedor (inglés, specs limpias) para los nichos
// que no los tengan al día — una sola llamada barata, sin regenerar análisis
router.post(
  '/rfq',
  manejar(async (req, res) => {
    if (!llmDisponible()) {
      return res.status(503).json({ error: 'IA no configurada: falta ANTHROPIC_API_KEY en el entorno' })
    }
    // forzar: regenerar todo el tablero (botón manual tras una mala traducción)
    const resultado = await generarRfqPendientes({ forzar: req.body?.forzar === true })
    res.json(resultado)
  }),
)

export default router
