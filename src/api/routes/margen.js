import { Router } from 'express'
import { Reporte } from '../../models/Reporte.js'
import { calcularMargen } from '../../services/margen.js'
import { parametrosVigentes } from '../../services/indicadores.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Parámetros por defecto del modelo (para mostrarlos/editarlos en el dashboard)
router.get(
  '/parametros',
  manejar(async (_req, res) => res.json(await parametrosVigentes())),
)

// Simular unit economics de importación. Si viene nichoId sin precioVentaClp,
// usa la mediana de precio del último reporte del nicho.
router.post(
  '/',
  manejar(async (req, res) => {
    const { nichoId, ...entrada } = req.body ?? {}

    if (!Number.isFinite(entrada.precioVentaClp) && nichoId) {
      const reporte = await Reporte.findOne({ nichoId }).sort({ fecha: -1 }).lean()
      const mediana = reporte?.metricas?.precio?.mediana
      if (!Number.isFinite(mediana)) {
        return res.status(404).json({ error: 'el nicho no tiene reporte con mediana de precio' })
      }
      entrada.precioVentaClp = mediana
    }

    try {
      // el dólar del día manda sobre el del archivo, salvo que quien llama
      // mande el suyo (el simulador deja fijarlo a mano para escenarios)
      const vigentes = await parametrosVigentes()
      entrada.parametros = {
        tipoCambioUsdClp: vigentes.tipoCambioUsdClp,
        ...(entrada.parametros ?? {}),
      }
      res.json({ ...calcularMargen(entrada), tipoCambio: vigentes.tipoCambio })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  }),
)

export default router
