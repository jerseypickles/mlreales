import { Router } from 'express'
import { urlAutorizacion, canjearCodigo, estadoMeli, meliConfigurado, sondearApi } from '../../services/meli.js'
import { importarMisItems } from '../../services/propios.js'
import { obtenerColas } from '../../jobs/queues.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

const DASHBOARD = process.env.DASHBOARD_URL || 'https://mlreales-dashboard.onrender.com'

router.get(
  '/estado',
  manejar(async (_req, res) => res.json(await estadoMeli())),
)

router.get(
  '/conectar',
  manejar(async (_req, res) => {
    if (!meliConfigurado()) {
      return res.status(503).json({ error: 'faltan MELI_APP_ID / MELI_APP_SECRET / MELI_REDIRECT_URI en el entorno' })
    }
    res.json({ url: urlAutorizacion() })
  }),
)

// Trae todas las publicaciones de la cuenta conectada a Mis productos y
// las mide al tiro (requiere el scope "Publicación y sincronización").
router.post(
  '/importar-items',
  manejar(async (_req, res) => {
    const estado = await estadoMeli()
    if (!estado.conectado) return res.status(409).json({ error: 'sin cuenta de Mercado Libre conectada' })
    const resultado = await importarMisItems()
    if (resultado.importados) {
      await obtenerColas().propios.add('medir', {}, { jobId: `propios-import-${Date.now()}` })
    }
    res.json(resultado)
  }),
)

// Publicidad (Product Ads): campañas con métricas + atribución por item
router.get(
  '/ads',
  manejar(async (req, res) => {
    const { resumenAds } = await import('../../services/ads.js')
    const dias = Math.min(90, Math.max(1, Number(req.query.dias) || 30))
    // ?forzar=1 salta la caché de 60s: es el botón "actualizar ahora" de la mesa
    const r = await resumenAds({ dias, forzar: req.query.forzar === '1' })
    if (!r) return res.status(409).json({ error: 'sin cuenta ML conectada o sin advertiser de Product Ads' })
    res.json(r)
  }),
)

// Crea una publicación nueva en ML desde un borrador de listing (pausada por
// defecto: se activa cuando llega el stock). El título nace libre — el bloqueo
// 374 de family_name solo aplica a EDITAR user products existentes.
router.post(
  '/publicar',
  manejar(async (req, res) => {
    const { publicarEnMl } = await import('../../services/publicador.js')
    try {
      res.status(201).json(await publicarEnMl(req.body ?? {}))
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  }),
)

// PÚBLICO (exento de x-api-key en app.js): ML redirige el NAVEGADOR del
// usuario acá con ?code&state — no viene con headers nuestros.
router.get(
  '/oauth/callback',
  manejar(async (req, res) => {
    const { code, state, error } = req.query
    if (error || !code) {
      return res.redirect(`${DASHBOARD}/?meli=error&detalle=${encodeURIComponent(String(error ?? 'sin code'))}`)
    }
    try {
      const cuenta = await canjearCodigo({ code: String(code), state: String(state ?? '') })
      console.log(`[meli] cuenta conectada: ${cuenta.nickname ?? cuenta.userId}`)
      // la sonda corre en background; sus resultados quedan en los logs
      sondearApi().catch((e) => console.warn(`[meli] sonda falló: ${e.message}`))
      res.redirect(`${DASHBOARD}/?meli=conectado`)
    } catch (err) {
      console.error('[meli] canje de código falló:', err.message)
      res.redirect(`${DASHBOARD}/?meli=error&detalle=${encodeURIComponent(err.message)}`)
    }
  }),
)

export default router
