import { Router } from 'express'
import { config } from '../../config/env.js'
import { ejecutarActorSync, iniciarRun, estadoRun, obtenerLogRun } from '../../services/apify.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function autorizado(req, res, next) {
  // con API_KEY global activa, el middleware de app.js ya validó la request
  if (process.env.API_KEY) return next()
  if (!process.env.DEBUG_KEY || req.get('x-debug-key') !== process.env.DEBUG_KEY) {
    return res.status(401).json({ error: 'no autorizado' })
  }
  next()
}

// Sonda para validar el output real de actores candidatos (el brief prohíbe asumir
// schemas). Acepta `input` arbitrario y `actorId` opcional para probar alternativas.
router.post(
  '/nivel2',
  autorizado,
  manejar(async (req, res) => {
    const actorId = typeof req.body?.actorId === 'string' ? req.body.actorId : config.actorDetails
    let input = req.body?.input
    if (!input) {
      const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, 5) : []
      if (!urls.length) return res.status(400).json({ error: 'urls o input requeridos' })
      input = { urls, max_retries_per_url: 2, ignore_url_failures: true, proxy: { useApifyProxy: true } }
    }
    // esperar=false: iniciar y devolver el runId al tiro (el proxy de Render
    // corta respuestas de +100s); los items se leen con GET /run/:id/items
    if (req.body?.esperar === false) {
      const { runId } = await iniciarRun(actorId, input)
      return res.status(202).json({ runId, actorId })
    }
    const { items, runId } = await ejecutarActorSync(actorId, input, {
      timeoutMs: 280_000,
      conMeta: true,
    })
    res.json({ cantidad: items.length, runId, actorId, items })
  }),
)

// Sonda de LECTURA de la API oficial de ML con el token de la cuenta conectada
// (diagnóstico de escrituras rechazadas: ver el item crudo, tags, catálogo).
// Solo GET y solo rutas /items|/users|/reviews: jamás escribe.
router.get(
  '/meli',
  autorizado,
  manejar(async (req, res) => {
    const ruta = typeof req.query.ruta === 'string' ? req.query.ruta : ''
    // solo lectura. `billing` entra para poder ver qué entrega ML de las
    // facturas de comisión (IVA crédito fiscal del vendedor) antes de decidir
    // si se construye la posición de IVA desde acá o desde el RCV del SII.
    //
    // `inventories`, `stock` y `shipments` entran el 28-ago-2026 por la
    // pregunta del importador: hoy el forecast usa `available_quantity` del
    // item, que es SOLO lo vendible. No ve lo que va en camino a Full ni lo
    // que está retenido, así que puede gritar "te quiebras en 5 días" con 200
    // unidades ya despachadas. El item trae `inventory_id`, que es la llave.
    if (!/^\/(items|users|user-products|reviews|categories|sites|billing|orders|seller-promotions|inventories|stock|shipments)\//.test(ruta)) {
      return res.status(400).json({
        error:
          'ruta inválida: solo /items/…, /users/…, /user-products/…, /reviews/…, /categories/…, /sites/…, /billing/…, /orders/…, /seller-promotions/…, /inventories/…, /stock/…, /shipments/…',
      })
    }
    const { meliGet } = await import('../../services/meli.js')
    res.json(await meliGet(ruta))
  }),
)

// Sonda del autocompletado real de ML (ordenado por volumen): valida qué
// escribe la gente de verdad antes de decidir keywords de título/nicho
router.get(
  '/busquedas',
  autorizado,
  manejar(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (q.length < 2) return res.status(400).json({ error: 'q requerida (mínimo 2 caracteres)' })
    const { sugerenciasReales } = await import('../../services/busquedasReales.js')
    res.json({ q, sugerencias: await sugerenciasReales(q, { limit: Number(req.query.limit) || 8 }) })
  }),
)

// ¿DataForSEO responde DESDE EL SERVIDOR? Las credenciales vivían solo en el
// equipo del importador, así que el radar podía proponer nichos y quedarse sin
// poder medirles el volumen —que es justo el filtro que decide cuáles entran—
// y eso solo se habría notado en la próxima pasada del radar.
// Cuesta ~US$0,09 por llamada: sonda, no monitor.
router.get(
  '/volumen',
  autorizado,
  manejar(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (q.length < 2) return res.status(400).json({ error: 'q requerida (mínimo 2 caracteres)' })
    const { volumenMensual, hayCredenciales } = await import('../../services/volumenBusqueda.js')
    if (!hayCredenciales()) {
      return res.status(503).json({ error: 'faltan DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD en el entorno' })
    }
    const keywords = q.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 20)
    const mapa = await volumenMensual(keywords)
    res.json({
      credenciales: true,
      medidas: keywords.map((k) => ({ keyword: k, ...(mapa.get(k) ?? { sinDato: true }) })),
    })
  }),
)

// Peso de búsqueda de frases candidatas: ?q=frase1|frase2|frase3
router.get(
  '/peso',
  autorizado,
  manejar(async (req, res) => {
    const frases = String(req.query.q ?? '')
      .split('|')
      .map((f) => f.trim())
      .filter(Boolean)
    if (!frases.length) return res.status(400).json({ error: 'q requerida (frases separadas por |)' })
    const { medirPesos } = await import('../../services/pesoKeyword.js')
    res.json({ pesos: await medirPesos(frases) })
  }),
)

// Estado + items de un run lanzado con esperar=false
router.get(
  '/run/:id/items',
  autorizado,
  manejar(async (req, res) => {
    const r = await estadoRun(req.params.id)
    res.json({ estado: r.estado, costoUsd: r.costoUsd, cantidad: r.items?.length ?? null, items: r.items })
  }),
)

// Log del run para diagnosticar corridas vacías
router.get(
  '/run/:id/log',
  autorizado,
  manejar(async (req, res) => {
    const log = await obtenerLogRun(req.params.id)
    res.type('text/plain').send(log.slice(-15_000))
  }),
)

export default router
