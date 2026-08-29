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

async function pedirUna(url, { geolocation, apiKey }) {
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
