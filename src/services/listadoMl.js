import { config } from '../config/env.js'
import { ZyteError } from './detalleMl.js'

// NIVEL 1 POR ZYTE, LEYENDO EL JSON QUE ML EMBEBE EN LA PÁGINA.
//
// Reemplaza al actor karamelo. La clave del cambio, medida el 29-ago-2026: la
// extracción automática de Zyte (`productList`) lee el DOM renderizado y
// devuelve 8 campos pobres, pero el HTML que ML sirve trae DOS estructuras JSON
// con todo lo que necesitamos:
//
//   "polycard": {metadata, components[], float_highlight_generic, pictures}
//       48 tarjetas únicas con título, precio VIGENTE y ANTERIOR separados,
//       vendedor, tienda oficial, nota, envío, promociones — y en `metadata`
//       el `product_id` (catálogo), `category_id`, `domain_id`, `item_position`
//       e `is_pad`.
//
//   "printed_result": [...]
//       60 filas con `sold_quantity`, `discount_pct` y `type: PAD|ORGANIC`.
//
// Se emite con LOS NOMBRES DE CAMPO DE KARAMELO para que `normalizarScan` y todo
// lo que cuelga de él no cambien. Los tres campos nuevos —vendidos, anuncio y
// id de catálogo— viajan aparte.
//
// Requiere `actions`: sin scroll ML entrega 13.873 chars; con scroll, 2.046.000.
// (La doc de Zyte dice que el parámetro de espera es `duration`; la API exige
// `timeout`.)

const ZYTE = 'https://api.zyte.com/v1/extract'
const TIMEOUT_MS = 280_000

const LISTADO_POR_DOMINIO = {
  CL: 'https://listado.mercadolibre.cl/',
  AR: 'https://listado.mercadolibre.com.ar/',
  CO: 'https://listado.mercadolibre.com.co/',
  MX: 'https://listado.mercadolibre.com.mx/',
  PE: 'https://listado.mercadolibre.com.pe/',
  UY: 'https://listado.mercadolibre.com.uy/',
}

const GEO_POR_DOMINIO = { CL: 'CL', AR: 'AR', CO: 'CO', MX: 'MX', PE: 'PE', UY: 'UY' }

// Pura. La URL de listado para una keyword, con los espacios como ML los espera.
export function urlListado(keyword, domainCode = 'CL') {
  const base = LISTADO_POR_DOMINIO[domainCode]
  if (!base) throw new ZyteError(`domainCode "${domainCode}" sin URL de listado (services/listadoMl.js)`)
  const slug = String(keyword ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
  return `${base}${encodeURIComponent(slug).replace(/%2F/g, '/')}`
}

// Pura. El cuerpo de la petición. Sin `productList`: el parseo es nuestro, y así
// tampoco se paga extracción automática.
export function cuerpoListado(keyword, { domainCode = 'CL' } = {}) {
  return {
    url: urlListado(keyword, domainCode),
    geolocation: GEO_POR_DOMINIO[domainCode] ?? 'CL',
    browserHtml: true,
    actions: [
      { action: 'waitForTimeout', timeout: 3 },
      { action: 'scrollBottom' },
      { action: 'waitForTimeout', timeout: 3 },
    ],
  }
}

// Pura. Lee el objeto JSON que empieza en `inicio` (que debe ser un '{' o '[')
// contando llaves y respetando strings y escapes. Hace falta porque estas
// estructuras están embebidas en HTML: no hay forma de aislarlas con regex.
export function objetoDesde(texto, inicio) {
  const abre = texto[inicio]
  const cierra = abre === '{' ? '}' : ']'
  if (abre !== '{' && abre !== '[') return null
  let nivel = 0
  let enString = false
  let escapado = false
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i]
    if (escapado) { escapado = false; continue }
    if (c === '\\') { escapado = true; continue }
    if (c === '"') { enString = !enString; continue }
    if (enString) continue
    if (c === abre) nivel++
    else if (c === cierra) {
      nivel--
      if (nivel === 0) {
        try {
          return JSON.parse(texto.slice(inicio, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

// Pura. Las tarjetas, deduplicadas por id de item: ML repite la misma tarjeta en
// varios carruseles (174 apariciones para 48 items en el nicho medido).
export function extraerPolycards(html) {
  const texto = String(html ?? '')
  const vistos = new Set()
  const tarjetas = []
  const ancla = '"polycard":{'
  let desde = 0
  for (;;) {
    const i = texto.indexOf(ancla, desde)
    if (i === -1) break
    desde = i + ancla.length
    const o = objetoDesde(texto, i + ancla.length - 1)
    const id = o?.metadata?.id
    if (!id || vistos.has(id)) continue
    vistos.add(id)
    tarjetas.push(o)
  }
  return tarjetas
}

// Pura. La telemetría de ML, indexada por id de item. De acá salen los vendidos
// y la marca de anuncio, que no están en la tarjeta.
export function extraerPrintedResult(html) {
  const texto = String(html ?? '')
  const ancla = '"printed_result":'
  const i = texto.indexOf(ancla)
  if (i === -1) return new Map()
  const arr = objetoDesde(texto, texto.indexOf('[', i))
  if (!Array.isArray(arr)) return new Map()
  const porId = new Map()
  for (const fila of arr) {
    const id = fila?.item_id
    if (!id) continue
    // un mismo item aparece como PAD y como ORGANIC; gana la fila orgánica,
    // que es la que representa su posición real en el ranking
    if (porId.has(id) && fila.type !== 'ORGANIC') continue
    porId.set(id, fila)
  }
  return porId
}

// --- lectura de los componentes de una tarjeta -----------------------------

const componente = (tarjeta, tipo) => (tarjeta?.components ?? []).find((c) => c?.type === tipo)

// Los componentes traen "text": "{label} {icon_cockade}" y los valores aparte.
// Esta función saca el valor de una clave concreta.
function valor(comp, contenedor, clave) {
  return (comp?.[contenedor]?.values ?? []).find((v) => v?.key === clave)
}

function textoEnvio(tarjeta) {
  const c = componente(tarjeta, 'shipping_v2')
  // se devuelve la PLANTILLA con sus llaves ("{same_day_free_shipping}
  // {full_icon}"): es exactamente el formato que `parsearEnvio` ya entiende
  return c?.shipping_v2?.[0]?.text ?? null
}

function precios(tarjeta) {
  const p = componente(tarjeta, 'price')?.price
  const vigente = p?.current_price?.value ?? null
  let anterior = null
  for (const etiqueta of p?.price_labels ?? []) {
    const v = (etiqueta?.values ?? []).find((x) => x?.key === 'previous_price')
    if (v?.price?.value != null) { anterior = v.price.value; break }
  }
  return { vigente, anterior, cuotas: p?.installments?.text ?? null }
}

// ML no publica la URL de la foto en el listado, solo su id
// ("639292-MLA92294746932_092025"). La URL se arma con el patrón que usa su CDN,
// el mismo que entregaba karamelo ya montado.
export function urlImagen(id) {
  if (typeof id !== 'string' || !id.trim()) return null
  return `https://http2.mlstatic.com/D_NQ_NP_${id}-O.webp`
}

// La URL del anuncio es un redirector de click1; para esos se reconstruye desde
// los ids del metadata, porque de la URL sale el SKU con que se une la serie.
function urlDeTarjeta(meta, domainCode) {
  const cruda = meta?.url ?? ''
  if (cruda && !cruda.includes('click1.')) {
    return cruda.startsWith('http') ? cruda : `https://${cruda}`
  }
  const base = (LISTADO_POR_DOMINIO[domainCode] ?? LISTADO_POR_DOMINIO.CL).replace('listado.', 'www.')
  if (meta?.product_id) return `${base}p/${meta.product_id}`
  if (meta?.user_product_id) return `${base}up/${meta.user_product_id}`
  // publicación suelta, sin catálogo ni user product: se arma la URL de artículo
  // a partir del id del item ("MLC4251805792" → ".../MLC-4251805792-_JM"), que
  // es de donde `extraerSku` saca la llave de la serie
  const m = String(meta?.id ?? '').match(/^ML([A-Z])(\d{6,})$/)
  if (m) return `${base.replace('www.', 'articulo.')}ML${m[1]}-${m[2]}-_JM`
  return null
}

// Pura. Una tarjeta + su fila de telemetría → un item CON LOS NOMBRES DE
// KARAMELO, para que `normalizarScan` no distinga de dónde vino.
//
// `SKU` va vacío a propósito: karamelo tampoco lo llenaba siempre y
// `extraerSku` deriva el id desde la URL (/p/MLC… o /up/MLCU…). Ese id —el de
// CATÁLOGO, no el del item— es la llave con que está indexada toda la serie
// histórica; usar `metadata.id` la rompería entera.
export function aItemBusqueda(tarjeta, fila, { keyword, domainCode = 'CL', resultadosTotales = null } = {}) {
  const meta = tarjeta?.metadata ?? {}
  const { vigente, anterior, cuotas } = precios(tarjeta)
  const vend = componente(tarjeta, 'seller')
  const nota = valor(componente(tarjeta, 'review_compacted'), 'review_compacted', 'label')
  const esAnuncio = String(meta.is_pad) === 'true' || fila?.type === 'PAD'
  return {
    // --- campos de karamelo, consumidos por normalizarScan sin cambios
    articuloTitulo: componente(tarjeta, 'title')?.title?.text ?? null,
    Moneda: componente(tarjeta, 'price')?.price?.current_price?.currency ?? 'CLP',
    nuevoPrecio: vigente,
    precioAnterior: anterior,
    installments: cuotas,
    Vendedor: valor(vend, 'seller', 'label')?.label?.text ?? null,
    esTiendaOficial: Boolean(valor(vend, 'seller', 'icon_cockade')),
    SKU: '',
    palabraClave: keyword ?? null,
    produtoReviews: nota?.label?.text ?? null,
    // ML no lo publica en el listado: verificado buscando los conteos conocidos
    // en 2 MB de HTML y en las 84 tarjetas (0 coincidencias). Karamelo tampoco
    // lo traía —`numeroEvaluaciones` vacío 0/5 en test/fixtures/nivel1.json—,
    // así que el conteo sigue viniendo del nivel 2 como siempre.
    numeroEvaluaciones: '',
    itemPosition: Number(meta.item_position) || fila?.position || null,
    resultadosTotales,
    zProductoLink: urlDeTarjeta(meta, domainCode),
    imgDireccion: urlImagen(tarjeta?.pictures?.pictures?.[0]?.id),
    Envio: textoEnvio(tarjeta),
    produtoCategoryID: meta.category_id ?? null,
    produtoDomainID: meta.domain_id ?? null,
    sellerID: '',
    highlight: tarjeta?.float_highlight_generic?.highlight?.text ?? null,
    // karamelo nunca lo llenó; ML sí lo publica, en buckets {25,50,100,500,1000}
    cantidadVendida: fila?.sold_quantity ?? null,

    // --- campos nuevos, que ningún actor daba
    esAnuncio,
    catalogId: meta.product_id ?? null,
    userProductId: meta.user_product_id ?? null,
    itemId: meta.id ?? null,
    descuentoPctMl: fila?.discount_pct ?? null,
  }
}

// Pura. El total de resultados que ML declara ("+9.999 resultados").
export function resultadosTotalesDe(html) {
  const m = String(html ?? '').match(/"total_results?"\s*:\s*"?([\d.+]+)"?/)
  return m ? m[1] : null
}

// Pura. HTML → items listos para `normalizarScan`.
export function itemsDesdeHtml(html, { keyword, domainCode = 'CL' } = {}) {
  const tarjetas = extraerPolycards(html)
  const telemetria = extraerPrintedResult(html)
  const totales = resultadosTotalesDe(html)
  return tarjetas.map((t) => aItemBusqueda(t, telemetria.get(t?.metadata?.id), {
    keyword,
    domainCode,
    resultadosTotales: totales,
  }))
}

// Nivel 1 completo. Misma firma que `buscarNivel1` de apify.js —{items, costoUsd}—
// para que el worker no distinga el proveedor.
export async function buscarNivel1Zyte(keyword, { domainCode = 'CL', apiKey = config.zyteApiKey } = {}) {
  if (!apiKey) throw new ZyteError('falta ZYTE_API_KEY')
  const control = new AbortController()
  const t = setTimeout(() => control.abort(), TIMEOUT_MS)
  let r
  try {
    r = await fetch(ZYTE, {
      method: 'POST',
      signal: control.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
      },
      body: JSON.stringify(cuerpoListado(keyword, { domainCode })),
    })
  } finally {
    clearTimeout(t)
  }
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '')
    throw new ZyteError(`Zyte HTTP ${r.status} en listado "${keyword}": ${cuerpo.slice(0, 200)}`, {
      status: r.status,
    })
  }
  const json = await r.json()
  const html = json?.browserHtml ?? ''
  const items = itemsDesdeHtml(html, { keyword, domainCode })
  // Sin tarjetas es bloqueo o cambio de layout, no un nicho vacío: ML siempre
  // devuelve algo. Vale más fallar fuerte que guardar un scan de cero items,
  // que en la serie se lee como "el nicho desapareció".
  if (!items.length) {
    throw new ZyteError(
      `Zyte devolvió 0 tarjetas para "${keyword}" (html ${html.length} chars): posible bloqueo o cambio de layout de ML`,
    )
  }
  // el costo real lo factura Zyte por request; acá no se puede leer (no viene en
  // cabeceras ni hay endpoint de consumo), así que se registra el estimado del
  // tramo de navegador y se calibra contra la factura
  return { items, costoUsd: config.zyteCostoListadoUsd, html }
}
