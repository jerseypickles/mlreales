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
    //
    // `highlights` y `trends` entran el 29-ago-2026 para responder si la API
    // oficial puede dar señal de demanda gratis —más vendidos por categoría—
    // en vez de scrapearla. Siguen siendo solo lectura.
    // `products` entra el 18-sep-2026: en una página de catálogo la ficha muestra
    // al ganador de la caja de compra, así que el stock leído puede ser de otro
    // vendedor. `/products/{id}/items` lista las ofertas de cada vendedor por
    // separado; si sirve, el seguimiento deja de depender del scraping para saber
    // de quién es el stock. Se permite también `?` (multiget: /items?ids=…).
    if (!/^\/(items|products|users|user-products|reviews|categories|sites|billing|orders|seller-promotions|inventories|stock|shipments|highlights|trends)[/?]/.test(ruta)) {
      return res.status(400).json({
        error:
          'ruta inválida: solo /items/…, /products/…, /users/…, /user-products/…, /reviews/…, /categories/…, /sites/…, /billing/…, /orders/…, /seller-promotions/…, /inventories/…, /stock/…, /shipments/…, /highlights/…, /trends/…',
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

// ¿Pueden las reseñas salir gratis por la API oficial, usando el id de catálogo
// que el nivel 1 por Zyte ahora entrega? Ver services/sondaReviewsCatalogo.js.
// Solo lee: un listado, la API de reseñas y una muestra de fichas.
router.get(
  '/reviews-catalogo',
  autorizado,
  manejar(async (req, res) => {
    const keyword = String(req.query.keyword ?? '').trim()
    if (!keyword) return res.status(400).json({ error: 'falta ?keyword=' })
    const { sondearReviewsPorCatalogo } = await import('../../services/sondaReviewsCatalogo.js')
    res.json(await sondearReviewsPorCatalogo(keyword, { domainCode: req.query.pais || 'CL' }))
  }),
)

// ¿QUÉ MÁS TRAE UNA FICHA QUE HOY NO LEEMOS? Sonda del 17-sep-2026 para decidir
// si se puede medir la venta REAL de un competidor por cómo le baja el stock.
// Pide una ficha a Zyte (US$0,006) y devuelve, sin interpretar, cada mención de
// stock / cantidad / vendidos / preguntas con su contexto, más las llaves del
// evento de telemetría de ML. Solo lee.
router.get(
  '/ficha-senales',
  autorizado,
  manejar(async (req, res) => {
    const url = String(req.query.url ?? '')
    if (!/^https:\/\/[a-z.]*mercadolibre\.cl\//.test(url)) return res.status(400).json({ error: 'falta ?url= de mercadolibre.cl' })
    const { config } = await import('../../config/env.js')
    const { pedirUna, stockDesdeHtml } = await import('../../services/detalleMl.js')
    const r = await pedirUna(url, { geolocation: 'CL', apiKey: config.zyteApiKey })
    const html = r?.browserHtml ?? ''
    const contextos = (patron, max = 6) => {
      const out = []
      for (const m of html.matchAll(patron)) {
        out.push(html.slice(Math.max(0, m.index - 70), m.index + 130).replace(/\s+/g, ' '))
        if (out.length >= max) break
      }
      return out
    }
    res.json({
      chars: html.length,
      stockLeido: stockDesdeHtml(html),
      textoDisponibles: [...new Set([...html.matchAll(/\(?\+?\d+ disponibles?\)?|[ÚUúu]ltima disponible|Puedes comprar hasta \d+ unidades?/g)].map((m) => m[0]))].slice(0, 8),
      producto: r?.product ? Object.fromEntries(Object.entries(r.product).filter(([k]) => !['description', 'descriptionHtml', 'images', 'breadcrumbs', 'additionalProperties', 'features'].includes(k))) : null,
      available_quantity: contextos(/available_quantity/g),
      stock: contextos(/"stock[a-z_]*"|stock disponible|Stock disponible/gi),
      disponibles: contextos(/disponibles?\b/gi, 8),
      cantidad: contextos(/"quantity[a-z_]*"|max_quantity|"maximum[a-z_]*"/gi),
      vendidos: contextos(/sold_quantity|vendidos/gi, 5),
      ultima: contextos(/[uú]ltim[ao]s? (disponible|unidad)/gi, 4),
      preguntas: contextos(/"questions?[a-z_]*"\s*:/gi, 4),
      variaciones: contextos(/"variations?"\s*:/gi, 2),
    })
  }),
)

// PRUEBA A/B DE ZYTE: la misma ficha/listado con cada configuración, leída con
// nuestro parser y comparada contra la actual. Cuesta (se paga cada variante):
// tope 12 fichas y 3 listados por llamada.
router.post(
  '/zyte-ab',
  autorizado,
  manejar(async (req, res) => {
    const modo = req.body?.modo === 'producto' ? 'producto' : 'variantes'
    // en modo producto se paga una lectura por ficha (no cuatro): tope 30
    const urls = (Array.isArray(req.body?.urls) ? req.body.urls : []).filter((u) => /^https:\/\/[a-z.]*mercadolibre\.cl\//.test(u)).slice(0, modo === 'producto' ? 30 : 12)
    const keywords = (Array.isArray(req.body?.keywords) ? req.body.keywords : []).map((k) => String(k).trim()).filter(Boolean).slice(0, 3)
    if (!urls.length && !keywords.length) return res.status(400).json({ error: 'falta urls[] o keywords[]' })
    const { lanzarPruebaAb } = await import('../../services/zyteAb.js')
    // corre en segundo plano: tarda minutos y un navegador corta la espera
    res.status(202).json(lanzarPruebaAb({ urls, keywords, modo }))
  }),
)
router.get(
  '/zyte-ab',
  autorizado,
  manejar(async (_req, res) => {
    const { ultimaPruebaAb } = await import('../../services/zyteAb.js')
    res.json(ultimaPruebaAb())
  }),
)

// El HTML que ML sirvió en el último scan de un nicho, para diagnosticar un
// cambio de forma sin volver a scrapear. Con ?resumen=1 devuelve solo lo que el
// parser sacó ese día, que es la primera pregunta: ¿cambió ML o cambiamos
// nosotros?
router.get(
  '/html-crudo/:keyword',
  autorizado,
  manejar(async (req, res) => {
    const { leerHtmlCrudo } = await import('../../services/htmlCrudo.js')
    const soloResumen = Boolean(req.query.resumen)
    const doc = await leerHtmlCrudo(req.params.keyword, { soloResumen })
    if (!doc) return res.status(404).json({ error: 'sin html guardado para esa keyword' })
    if (soloResumen) {
      return res.json({
        keyword: doc.keyword,
        fecha: doc.fecha,
        fuente: doc.fuente,
        chars: doc.chars,
        comprimidoBytes: doc.comprimidoBytes,
        resumen: doc.resumen,
      })
    }
    res.type('text/html').send(doc.html ?? '')
  }),
)

// Forzar el refresco de las curvas de búsqueda. El cron lo hace solo con las
// vencidas a los 30 días; esto sirve para cuando cambió lo que se PIDE —como al
// sumar `date_from` para poder medir la tendencia año contra año— y hay que
// renovar todo de una vez.
//
// Cuesta poco porque DataForSEO cobra por REQUEST y no por keyword: los 84
// nichos generan ~2.200 keywords con sus variantes, o sea 3 llamadas.
router.post(
  '/refrescar-curvas',
  autorizado,
  manejar(async (req, res) => {
    const { refrescarCurvasVencidas } = await import('../../services/refrescoCurvas.js')
    // dias=0 fuerza todas; sin parámetro respeta la vigencia normal
    const dias = req.query.dias != null ? Number(req.query.dias) : undefined
    res.json(await refrescarCurvasVencidas(dias != null ? { vigenciaDias: dias } : {}))
  }),
)

// Los meses crudos que devuelve Google para una keyword. Existe porque la
// tendencia año-contra-año salió sospechosamente negativa en muchos nichos y
// afirmarla sin ver los datos sería exactamente el error que este sistema trata
// de no cometer.
router.get(
  '/volumen-crudo/:keyword',
  autorizado,
  manejar(async (req, res) => {
    const { config } = await import('../../config/env.js')
    const { desde4Anos, CHILE } = await import('../../services/volumenBusqueda.js')
    const auth = Buffer.from(`${config.dataForSeoLogin}:${config.dataForSeoPassword}`).toString('base64')
    const r = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify([
        {
          keywords: [req.params.keyword],
          location_code: CHILE,
          language_code: 'es',
          search_partners: false,
          ...(req.query.sinFecha ? {} : { date_from: desde4Anos() }),
        },
      ]),
    })
    const j = await r.json()
    const fila = j?.tasks?.[0]?.result?.[0] ?? null
    res.json({
      keyword: fila?.keyword,
      search_volume: fila?.search_volume,
      meses: (fila?.monthly_searches ?? []).length,
      monthly_searches: fila?.monthly_searches ?? null,
      costo: j?.cost,
    })
  }),
)

export default router
