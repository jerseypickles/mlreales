import { Router } from 'express'
import { generarInformeEstratega, informesEstratega, validarNichosInforme } from '../../services/estratega.js'
import { llmDisponible } from '../../services/llm.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Último informe (con nichoIds validados) + fechas de la historia
router.get(
  '/',
  manejar(async (_req, res) => {
    const docs = await informesEstratega()
    if (!docs.length) return res.json({ informe: null, historia: [] })
    const [ultimo, ...previos] = docs
    res.json({
      generadoEl: ultimo.generadoEl,
      modelo: ultimo.modelo,
      informe: await validarNichosInforme(ultimo.informe),
      historia: previos.map((d) => ({ id: d._id, generadoEl: d.generadoEl })),
    })
  }),
)

// Generar ahora (además del cron semanal). Corre inline: una sola llamada LLM,
// mismo patrón que POST /nichos/:id/analisis.
router.post(
  '/',
  manejar(async (_req, res) => {
    if (!llmDisponible()) {
      return res.status(503).json({ error: 'IA no configurada: falta ANTHROPIC_API_KEY en el entorno' })
    }
    const doc = await generarInformeEstratega()
    res.json({
      generadoEl: doc.generadoEl,
      modelo: doc.modelo,
      informe: await validarNichosInforme(doc.informe),
    })
  }),
)

export default router
