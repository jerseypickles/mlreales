import { config } from '../config/env.js'

// DETALLE DE FICHA POR ZYTE, CON LAS TRAMPAS YA PAGADAS.
//
// Reemplaza al actor de detalle de Apify (`ecomscrape`), que ML bloquea incluso
// con proxy residencial. Zyte pasa, pero medido contra ML el 29-ago-2026 tiene
// tres comportamientos que hay que respetar o los datos salen mal SIN AVISO:
//
//   1. NO FALLA, SE DEGRADA. Con 12 fichas en paralelo, 4 volvieron HTTP 200
//      con la ficha vacía —solo nombre, sku y descripción— y `probability: 0`.
//      Las mismas URLs, pedidas de a una, devolvieron precio, rating y vendidos.
//      Un HTTP 200 de Zyte no es un dato bueno: hay que mirar `probability`.
//
//   2. LA CONCURRENCIA ES EL FACTOR. Medido sobre las mismas 12 URLs:
//         12 en paralelo →  7/11 útiles (19s)
//          6 en paralelo →  7/11 útiles (30s)
//          4 en paralelo →  9/11 útiles (47s)
//      Bajar de 4 no compensa: lo que falta lo rescata el reintento.
//
//   3. SIN ESPERA, ML ENTREGA EL PRECIO TACHADO COMO VIGENTE. Ésta costó
//      encontrarla. La misma ficha, con y sin `actions`:
//         sin espera     → html   11.983 chars, precio 331.990  (el TACHADO)
//         espera de 3 s  → html 1.334.442 chars, precio 259.990  (el vigente)
//      Y las dos con `probability` sobre 0,99. Cuando la página no termina de
//      renderizar, lo primero que queda pintado es el precio anterior, y la
//      extracción lo toma como bueno. Eso explica el 429.990/575.990 que
//      alternaba entre corridas y el 14.352 suelto.
//      Por eso la espera NO ES OPCIONAL acá tampoco: cuesta ~19 s más por
//      ficha y evita meter precios falsos en la puntuación de nichos.
//      Igual se conserva la guardia de coherencia, porque `probability` no
//      protege del valor malo: el precio vigente nunca supera al tachado, y
//      cuando el nivel 1 ya midió esta publicación se contrasta contra esa
//      fuente, que es independiente.
//
// El navegador no es opcional. Con `extractFrom: httpResponseBody` la misma
// ficha sale en 1,5s en vez de 6,2s y cuesta ~10x menos, pero pierde precio,
// marca, disponibilidad y rating: quedan 7 campos inútiles para puntuar.
//
// Tampoco hacen falta `customAttributes`: vendidos, vendedor y Full los entrega
// ahora el nivel 1 (ver listadoMl.js) y el bloque del vendedor sale del evento
// melidata embebido en la página. Sacarlos ahorra el LLM generativo, que era
// ~$0,004 por ficha —la parte más cara de la petición.

const ZYTE = 'https://api.zyte.com/v1/extract'

// medido: 4 es donde la tasa de páginas vacías deja de crecer
const CONCURRENCIA = 4
// bajo esto la extracción no reconoció la página como ficha de producto
const PROBABILIDAD_MINIMA = 0.5
const REINTENTOS = 2
const TIMEOUT_MS = 200_000

export class ZyteError extends Error {
  constructor(mensaje, { status = null, url = null } = {}) {
    super(mensaje)
    this.name = 'ZyteError'
    this.status = status
    this.url = url
  }
}

// Pura. El cuerpo de la petición, aparte para poder probarlo sin red.
export function cuerpoPeticion(url, { geolocation = 'CL' } = {}) {
  return {
    url,
    geolocation,
    product: true,
    // browserHtml y no httpResponseBody: ver cabecera del archivo
    productOptions: { extractFrom: 'browserHtml' },
    // el HTML crudo se pide además de la extracción: de ahí sale el bloque del
    // vendedor, que ningún esquema estándar expone
    browserHtml: true,
    // la espera es lo que hace que el precio sea el vigente y no el tachado
    actions: [{ action: 'waitForTimeout', timeout: 3 }],
  }
}

// EL VENDEDOR, DESDE EL EVENTO DE TELEMETRÍA DE ML.
//
// La página embebe un `melidata_event` con el vendedor ya identificado:
//   {"seller_id":204808902,"seller_name":"Philips",
//    "reputation_level":"5_green","power_seller_status":"platinum",
//    "official_store_id":97}
// Son exactamente los formatos que guardan `Producto.reputacionSeller` y
// `powerSeller`, así que se emiten con los nombres del actor viejo y
// `normalizarItemSourabh` los toma sin cambios. Sin esto, migrar a Zyte perdía
// la reputación del vendedor, que alimenta el panel y el CSV.
export function vendedorDesdeHtml(html) {
  const texto = String(html ?? '')
  const i = texto.indexOf('"seller_id"')
  if (i === -1) return null
  const lee = (clave, comillas) => {
    const re = comillas
      ? new RegExp(`"${clave}":"([^"]*)"`)
      : new RegExp(`"${clave}":(\\d+)`)
    const m = texto.slice(Math.max(0, i - 2000), i + 2000).match(re)
    return m ? m[1] : null
  }
  const id = lee('seller_id', false)
  if (!id) return null
  return {
    sellerId: id,
    sellerName: lee('seller_name', true),
    sellerReputation: lee('reputation_level', true),
    sellerPowerStatus: lee('power_seller_status', true),
    officialStoreId: lee('official_store_id', false),
  }
}

// EL STOCK DEL COMPETIDOR, QUE YA VENÍA EN LA FICHA Y NO SE LEÍA.
//
// Sondeado el 17-sep-2026 (GET /api/debug/ficha-senales) sobre tres fichas: el
// mismo evento de telemetría que trae al vendedor trae
//   "stock_type":"normal","quantity":51,"sold_quantity":5000
// `quantity` es el stock disponible: EXACTO hasta 50 —una publicación chica
// mostró 3 y la página decía "4 disponibles"— y TOPADO en 51 para quien tiene
// más (los dos vendedores grandes medidos daban 51). `sold_quantity` es el mismo
// balde del listado (5, 1.000, 5.000).
//
// Para qué sirve: la baja del stock entre dos lecturas es venta REAL de ese
// vendedor, sin factor ni reseñas de por medio. Solo se puede leer en quien
// tiene 50 o menos, que es justo el vendedor chico que entra como entraría el
// importador. No cuesta nada: la ficha ya se paga para leer las reseñas.
export function stockDesdeHtml(html) {
  const texto = String(html ?? '')
  // CORRECCIÓN DEL MISMO DÍA. El primer scan con esto guardó tres vendedores
  // distintos con "26" y tres con "6": demasiada coincidencia. Cruzado contra la
  // sonda, `quantity` es el MÍNIMO entre el stock y el tope de compra por pedido
  // —una ficha decía "(4 disponibles)" y "Puedes comprar hasta 3 unidades", y
  // `quantity` valía 3—. El stock de verdad es el texto que ve el comprador:
  //   "(4 disponibles)"  ·  "(+50 disponibles)"  ·  "¡Última disponible!"
  // Se lee ese; `quantity` queda solo como respaldo, marcado como tal, y no
  // sirve para calcular ventas. Y ojo: el texto también viene EN BALDES —"+5",
  // "+10", "+25", "+50"— y es exacto solo con pocas unidades. Con "+" se guarda
  // el piso del balde más uno (26 = "más de 25") y stockTopado = true.
  const vendidos = texto.match(/"sold_quantity":(\d+)/)
  const vendidosFicha = vendidos ? Number(vendidos[1]) : null
  const visible = texto.match(/\((\+?)(\d+) disponibles?\)/) ?? texto.match(/"text":"(\+?)(\d+) disponibles?"/)
  if (visible) {
    const n = Number(visible[2])
    return { stock: visible[1] ? n + 1 : n, stockTopado: Boolean(visible[1]), stockFuente: 'texto', vendidosFicha }
  }
  if (/[¡"(]\s*[ÚUúu]ltima disponible/.test(texto)) return { stock: 1, stockTopado: false, stockFuente: 'texto', vendidosFicha }
  const m = texto.match(/"stock_type":"[a-z_]*","quantity":(\d+)/) ?? texto.match(/"quantity":(\d+),"sold_quantity"/)
  if (!m) return vendidosFicha != null ? { stock: null, stockTopado: null, stockFuente: null, vendidosFicha } : null
  const cantidad = Number(m[1])
  return { stock: cantidad, stockTopado: cantidad >= 51, stockFuente: 'telemetria', vendidosFicha }
}

// EL PRODUCTO, LEÍDO DEL HTML SIN LA EXTRACCIÓN DE ZYTE (en prueba).
//
// `product: true` se cobra aparte por cada ficha. La A/B del 22-sep-2026 mostró
// que el precio leído de los datos estructurados de la página coincide con el
// de Zyte en 8 de 8 fichas. Esto lee el resto de lo que el pipeline usa, con la
// MISMA forma que `product` de Zyte, para poder cambiar una por otra sin tocar
// `aItemDetalle`. No se usa en producción hasta medir paridad campo por campo.
function jsonLd(html) {
  const bloques = []
  for (const m of String(html ?? '').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1])
      for (const x of [j, ...(Array.isArray(j) ? j : []), ...(Array.isArray(j?.['@graph']) ? j['@graph'] : [])]) if (x && typeof x === 'object') bloques.push(x)
    } catch { /* un bloque roto no invalida los otros */ }
  }
  return bloques
}

export function productoDesdeHtml(html) {
  const t = String(html ?? '')
  const prod = jsonLd(t).find((b) => b['@type'] === 'Product' || (Array.isArray(b['@type']) && b['@type'].includes('Product')))
  const oferta = Array.isArray(prod?.offers) ? prod.offers[0] : prod?.offers
  const canonica = t.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1] ?? t.match(/<link[^>]+href="([^"]+)"[^>]+rel="canonical"/i)?.[1] ?? null
  const num = (v) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  // EL TACHADO no está en el JSON-LD. Se lee SOLO del componente de precio
  // principal (`"id":"price"`): el aria-label "Antes: …" y un original_price
  // suelto también aparecen en el carrusel de recomendados, y el 22-sep eso le
  // atribuyó al kayak ($89.990) el tachado de otro producto ($399.990).
  const anterior = num(t.match(/"id":"price","price":\{"previous_price":\{"value":(\d+(?:\.\d+)?)/)?.[1])
  // LAS RESEÑAS tampoco se leen del JSON-LD: su reviewCount son solo las que
  // traen comentario (178 de 276 en la freidora). Lo que la página muestra, y lo
  // que siempre guardó el sistema, es el `amount` del bloque de reseñas.
  const visible = t.match(/"reviews":\{"rating":([\d.]+),"amount":(\d+)/) ?? t.match(/"rate":([\d.]+),"count":(\d+),"layout"/)
  const disp = String(oferta?.availability ?? '')
  if (!prod) return null
  return {
    url: canonica ?? prod.url ?? null,
    canonicalUrl: canonica,
    sku: prod.sku ?? prod.productID ?? null,
    name: prod.name ?? null,
    price: num(oferta?.price),
    regularPrice: anterior,
    currency: oferta?.priceCurrency ?? null,
    availability: /InStock/i.test(disp) ? 'InStock' : /OutOfStock|SoldOut/i.test(disp) ? 'OutOfStock' : null,
    brand: prod.brand ? { name: typeof prod.brand === 'string' ? prod.brand : prod.brand.name ?? null } : null,
    aggregateRating: visible ? { ratingValue: num(visible[1]), reviewCount: num(visible[2]) }
      : prod.aggregateRating ? { ratingValue: num(prod.aggregateRating.ratingValue), reviewCount: null } : null,
  }
}

// Pura. ¿La extracción reconoció una ficha, o devolvió el cascarón?
export function confiable(respuesta) {
  const p = respuesta?.product?.metadata?.probability
  return Number.isFinite(p) && p >= PROBABILIDAD_MINIMA
}

// Pura. Las dos comprobaciones del punto 3, sin LLM de por medio.
//
// `precioListado` es el precio que el scrapeo del LISTADO vio para esta misma
// publicación. Es una fuente independiente —otra página, otra petición— así que
// sirve de testigo de verdad. Se tolera 5% porque entre el listado y la ficha
// puede haber pasado una promoción real.
//
// Devuelve null cuando no hay con qué comparar: marcar como sospechoso lo que
// no se pudo verificar tiraría datos buenos.
const TOLERANCIA = 0.05

export function precioCoherente(precio, { precioAnterior = null, precioListado = null } = {}) {
  if (!Number.isFinite(precio) || precio <= 0) return null
  // el precio vigente jamás supera al tachado: si lo hace, uno de los dos está mal
  if (Number.isFinite(precioAnterior) && precioAnterior > 0 && precio > precioAnterior) return false
  if (Number.isFinite(precioListado) && precioListado > 0) {
    return Math.abs(precio - precioListado) / precioListado <= TOLERANCIA
  }
  return Number.isFinite(precioAnterior) && precioAnterior > 0 ? true : null
}

const numero = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null)

// `regularPrice` DE ZYTE NO ES EL PRECIO ANTERIOR: LA MAYORÍA DE LAS VECES ES
// LA CUOTA. Medido el 29-ago-2026 sobre los 60 resultados de "depiladora
// laser": de las 50 fichas que traían regularPrice, 30 eran exactamente
// precio/6 o precio/12 —las cuotas sin interés que ML muestra bajo el precio—
// y solo 20 eran un precio tachado de verdad.
//
// Tomarlo crudo como "precio anterior" inventa un descuento del 83% en seis de
// cada diez publicaciones, y el descuento es justo una de las señales con que
// se juzga un nicho.
//
// La regla que los separa no necesita adivinar cuántas cuotas son: un precio
// anterior SIEMPRE es mayor que el vigente, y una cuota SIEMPRE es menor.
export function precioAnteriorReal(precio, regular) {
  if (!Number.isFinite(precio) || !Number.isFinite(regular)) return null
  return regular > precio ? regular : null
}

// Pura. Traduce la respuesta de Zyte a la forma que ya consume
// `normalizadorDetalle.normalizarItemDetalleSourabh`: mismos nombres de campo,
// para que el resto del pipeline no se entere de que cambió el proveedor.
export function aItemDetalle(respuesta, { precioListado = null } = {}) {
  const p = respuesta?.product ?? {}
  const v = vendedorDesdeHtml(respuesta?.browserHtml) ?? {}
  const st = stockDesdeHtml(respuesta?.browserHtml)
  const precio = numero(p.price)
  const anterior = precioAnteriorReal(precio, numero(p.regularPrice))
  const coherente = precioCoherente(precio, { precioAnterior: anterior, precioListado })
  return {
    url: p.url ?? p.canonicalUrl ?? null,
    sku: p.sku ?? null,
    catalogProductId: p.sku ?? null,
    title: p.name ?? null,
    price: precio,
    originalPrice: anterior,
    ratingCount: numero(p.aggregateRating?.reviewCount),
    reviewCount: numero(p.aggregateRating?.reviewCount),
    rating: numero(p.aggregateRating?.ratingValue),
    availability: p.availability ?? null,
    // stock visible del vendedor (exacto hasta 50, topado en 51) — ver stockDesdeHtml
    stockQuantity: st?.stock ?? null,
    stockTopado: st?.stockTopado ?? null,
    stockFuente: st?.stockFuente ?? null,
    soldQuantityFicha: st?.vendidosFicha ?? null,
    brand: p.brand?.name ?? null,
    // bloque del vendedor, con los nombres que espera normalizarItemSourabh
    sellerId: v.sellerId ?? null,
    sellerName: v.sellerName ?? null,
    sellerReputation: v.sellerReputation ?? null,
    sellerPowerStatus: v.sellerPowerStatus ?? null,
    isOfficialStore: v.officialStoreId != null,
    officialStoreName: v.officialStoreId ?? null,
    // el Full lo dice el nivel 1; acá null = no pisar lo que ya se sabe
    isFull: null,
    // trazas de calidad: quien puntúe puede decidir si confía
    _probabilidad: numero(p.metadata?.probability),
    // null = no había con qué comparar; false = el precio no cuadra ni con el
    // tachado de la propia ficha ni con lo que vio el listado
    _precioCoherente: coherente,
  }
}

export async function pedirUna(url, { geolocation, apiKey }) {
  const control = new AbortController()
  const t = setTimeout(() => control.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(ZYTE, {
      method: 'POST',
      signal: control.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
      },
      body: JSON.stringify(cuerpoPeticion(url, { geolocation })),
    })
    if (!r.ok) {
      const cuerpo = await r.text().catch(() => '')
      throw new ZyteError(`Zyte HTTP ${r.status}: ${cuerpo.slice(0, 200)}`, { status: r.status, url })
    }
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

// Una ficha, reintentando mientras vuelva el cascarón. El reintento no es
// terquedad: es la corrección medida del punto 1 —la misma URL que en paralelo
// devolvió probability 0 devolvió la ficha completa al pedirla de nuevo.
async function conReintento(url, opciones, precioListado) {
  let ultima = null
  for (let intento = 0; intento <= REINTENTOS; intento++) {
    try {
      const r = await pedirUna(url, opciones)
      if (confiable(r)) return { ok: true, item: aItemDetalle(r, { precioListado }), intentos: intento + 1 }
      ultima = r
    } catch (err) {
      ultima = null
      if (intento === REINTENTOS) return { ok: false, url, motivo: err.message }
    }
  }
  return {
    ok: false,
    url,
    motivo: ultima ? 'la extraccion no reconocio una ficha de producto' : 'sin respuesta',
  }
}

// Varias fichas con el tope de concurrencia puesto. Devuelve items en la forma
// del actor viejo más un informe de lo que no se pudo medir: un nicho al que le
// faltan la mitad de las fichas no se puntúa igual que uno completo.
// `preciosListado` es opcional: un Map url→precio con lo que el scrapeo del
// listado ya midió. Cuando viene, cada ficha queda contrastada contra una
// fuente independiente sin costar una petición extra.
export async function detallesDeMl(
  urls,
  { geolocation = 'CL', apiKey = config.zyteApiKey, preciosListado = new Map() } = {},
) {
  if (!apiKey) throw new ZyteError('falta ZYTE_API_KEY')
  const pendientes = [...new Set((urls ?? []).filter(Boolean))]
  const items = []
  const fallidos = []
  let sospechosos = 0

  let cursor = 0
  async function obrero() {
    while (cursor < pendientes.length) {
      const url = pendientes[cursor++]
      const r = await conReintento(url, { geolocation, apiKey }, preciosListado.get(url) ?? null)
      if (r.ok) {
        if (r.item._precioCoherente === false) sospechosos++
        items.push(r.item)
      } else {
        fallidos.push({ url: r.url, motivo: r.motivo })
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCIA, pendientes.length) }, () => obrero()),
  )

  if (sospechosos) {
    console.warn(
      `[detalle-ml] ${sospechosos}/${items.length} fichas con precio incoherente`,
    )
  }
  return { items, fallidos, pedidas: pendientes.length }
}
