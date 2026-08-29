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

// PAGINACIÓN. ML pagina de a 50 con un sufijo en la URL, y el sufijo importa:
//   _Desde_51                  → ML lo ignora y devuelve la página 1
//   _Desde_49_NoIndex_True     → cambia el canonical pero sirve lo mismo
//   _Desde_51_NoIndex_True     → la página 2 de verdad (medido: 59 items,
//                                solo 12 repetidos con la página 1)
// Sin esto Zyte traía ~50 items donde karamelo traía ~95, y el listado se
// quedaba en la mitad del mercado.
const POR_PAGINA = 50

// Pura. La URL de listado para una keyword, con los espacios como ML los espera.
// `pagina` es 1-based.
export function urlListado(keyword, domainCode = 'CL', pagina = 1) {
  const base = LISTADO_POR_DOMINIO[domainCode]
  if (!base) throw new ZyteError(`domainCode "${domainCode}" sin URL de listado (services/listadoMl.js)`)
  const slug = String(keyword ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
  const url = `${base}${encodeURIComponent(slug).replace(/%2F/g, '/')}`
  if (pagina <= 1) return url
  return `${url}_Desde_${(pagina - 1) * POR_PAGINA + 1}_NoIndex_True`
}

// Pura. El cuerpo de la petición. Sin `productList`: el parseo es nuestro, y así
// tampoco se paga extracción automática.
export function cuerpoListado(keyword, { domainCode = 'CL', pagina = 1 } = {}) {
  return {
    url: urlListado(keyword, domainCode, pagina),
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

// Pura. La telemetría de ML, indexada por id de item.
//
// UN ITEM PUEDE SER ANUNCIO Y ORGÁNICO A LA VEZ. Medido en "depiladora laser":
// 10 de 60 filas son el mismo item apareciendo dos veces —arriba como PAD,
// pagado, y más abajo como ORGANIC, ganado—. Tratar esos como "anuncio" y
// sacarlos del análisis borraría competidores reales: son justamente los
// vendedores fuertes, los que rankean Y además pagan.
//
// Así que se distingue: `esSoloAnuncio` es el que NUNCA aparece orgánico. Y la
// posición se toma de la fila ORGÁNICA cuando existe, porque la del anuncio
// (0-3) es un lugar comprado, no un lugar en el ranking.
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
    const previo = porId.get(id)
    const esOrganica = fila.type === 'ORGANIC'
    if (!previo) {
      porId.set(id, { fila, tieneOrganico: esOrganica, tienePad: !esOrganica })
      continue
    }
    previo.tieneOrganico ||= esOrganica
    previo.tienePad ||= !esOrganica
    // la fila orgánica manda: es la que lleva la posición real
    if (esOrganica) previo.fila = fila
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
export function aItemBusqueda(tarjeta, telemetria, { keyword, domainCode = 'CL', resultadosTotales = null } = {}) {
  const meta = tarjeta?.metadata ?? {}
  const fila = telemetria?.fila ?? null
  const { vigente, anterior, cuotas } = precios(tarjeta)
  const vend = componente(tarjeta, 'seller')
  const nota = valor(componente(tarjeta, 'review_compacted'), 'review_compacted', 'label')
  // solo anuncio = pagó y NO rankea. El que hace las dos cosas es competidor.
  const esAnuncio = telemetria
    ? Boolean(telemetria.tienePad && !telemetria.tieneOrganico)
    : String(meta.is_pad) === 'true'
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
    // `item_position` viene en -1 en las tarjetas de anuncio: tomarlo ordenaría
    // los pagados ANTES de la posición 1. Manda la posición de la fila orgánica.
    // el anuncio puro no tiene lugar en el ranking: su 0-3 es comprado
    itemPosition: esAnuncio ? null : posicionReal(meta, fila),
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

// Pura. La posición que vale es la orgánica. Se descarta el -1 con que ML marca
// las tarjetas pagadas, y también el 0, que es un lugar de anuncio.
export function posicionReal(meta, fila) {
  if (fila?.type === 'ORGANIC' && Number.isFinite(fila.position)) return fila.position
  const dela = Number(meta?.item_position)
  if (Number.isFinite(dela) && dela > 0) return dela
  const dela2 = Number(fila?.position)
  return Number.isFinite(dela2) && dela2 > 0 ? dela2 : null
}

// Pura. El total de resultados que ML declara. Viene en un componente propio,
// `{"type":"TOTAL_RESULTS","text":"544 resultados"}`, y ML lo capea en 9.999
// para búsquedas grandes —ahí lo escribe como "+9.999", que es lo que
// `parsearResultadosTotales` lee como `esMinimo`.
export function resultadosTotalesDe(html) {
  const m = String(html ?? '').match(/"type":"TOTAL_RESULTS","text":"([^"]+)"/)
  if (m) return m[1]
  // respaldo: el mismo número pintado en la cabecera del listado
  const t = String(html ?? '').match(/quantity-results[^>]*>([^<]+)</)
  return t ? t[1] : null
}

// Pura. HTML → items listos para `normalizarScan`.
//
// SE DEVUELVEN ORDENADOS POR POSICIÓN ORGÁNICA, y no es un detalle estético.
// `normalizarScan` asigna la posición con el ÍNDICE DEL ARRAY (`posicionGlobal:
// indice + 1`) e ignora el `itemPosition` del item. Como ML entrega las
// tarjetas con los anuncios primero, dejar el orden crudo escribía en la serie
// un ranking donde los cuatro primeros lugares eran comprados —medido: en los
// seis nichos probados el 29-ago-2026, las primeras cuatro posiciones eran
// pagadas SIN EXCEPCIÓN.
//
// Los anuncios puros van al final: no tienen lugar en el ranking orgánico. No
// se descartan porque siguen siendo oferta real del mercado y cuentan para
// precios y descuentos; quien mire ranking los excluye por `esAnuncio`.
export function itemsDesdeHtml(html, { keyword, domainCode = 'CL' } = {}) {
  const tarjetas = extraerPolycards(html)
  const telemetria = extraerPrintedResult(html)
  const totales = resultadosTotalesDe(html)
  const items = tarjetas.map((t) => aItemBusqueda(t, telemetria.get(t?.metadata?.id), {
    keyword,
    domainCode,
    resultadosTotales: totales,
  }))
  const rango = (i) => (i.esAnuncio ? Infinity : (i.itemPosition ?? Infinity))
  return items.sort((a, b) => rango(a) - rango(b))
}

// Nivel 1 completo. Misma firma que `buscarNivel1` de apify.js —{items, costoUsd}—
// para que el worker no distinga el proveedor.
// Zyte devuelve 5xx transitorios contra ML —medido un 520 en la página 2 de
// "cama perro"—. Sin reintento el scan se queda con la mitad del listado y no
// se entera: hay red de seguridad más arriba, pero prefiere reintentar antes
// de resignar media página de mercado.
const REINTENTOS_PAGINA = 2

async function pedirPaginaUnaVez(keyword, { domainCode, apiKey, pagina }) {
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
      body: JSON.stringify(cuerpoListado(keyword, { domainCode, pagina })),
    })
  } finally {
    clearTimeout(t)
  }
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '')
    throw new ZyteError(
      `Zyte HTTP ${r.status} en listado "${keyword}" p${pagina}: ${cuerpo.slice(0, 200)}`,
      { status: r.status },
    )
  }
  return (await r.json())?.browserHtml ?? ''
}

async function pedirPagina(keyword, opciones) {
  let ultimo = null
  for (let intento = 0; intento <= REINTENTOS_PAGINA; intento++) {
    try {
      return await pedirPaginaUnaVez(keyword, opciones)
    } catch (err) {
      ultimo = err
      // 4xx no se reintenta: es la petición, no la suerte
      if (err.status && err.status >= 400 && err.status < 500) throw err
    }
  }
  throw ultimo
}

export async function buscarNivel1Zyte(
  keyword,
  { domainCode = 'CL', apiKey = config.zyteApiKey, maxPaginas = config.maxPagesBusqueda } = {},
) {
  if (!apiKey) throw new ZyteError('falta ZYTE_API_KEY')
  const paginas = Math.max(1, Number(maxPaginas) || 1)

  // la página 1 primero, sola: si viene vacía no vale la pena pagar la segunda
  const html = await pedirPagina(keyword, { domainCode, apiKey, pagina: 1 })
  let items = itemsDesdeHtml(html, { keyword, domainCode })
  let paginasPedidas = 1

  if (items.length && paginas > 1) {
    paginasPedidas = paginas
    const resto = await Promise.all(
      Array.from({ length: paginas - 1 }, (_, i) =>
        pedirPagina(keyword, { domainCode, apiKey, pagina: i + 2 })
          .then((h) => itemsDesdeHtml(h, { keyword, domainCode }))
          // una página que falla no bota el scan: se sigue con lo que haya
          .catch((err) => {
            console.warn(`[listado-ml] "${keyword}" p${i + 2}: ${err.message}`)
            return []
          }),
      ),
    )
    // el orden importa: `normalizarScan` numera la posición por índice de array,
    // así que las páginas se concatenan en orden y se deduplica dejando la
    // primera aparición, que es la mejor posición
    const vistos = new Set(items.map((i) => i.itemId))
    for (const pagina of resto) {
      for (const it of pagina) {
        if (it.itemId && vistos.has(it.itemId)) continue
        if (it.itemId) vistos.add(it.itemId)
        items.push(it)
      }
    }
    // los anuncios puros al final del conjunto, no al final de cada página
    items = items.sort((a, b) => Number(a.esAnuncio) - Number(b.esAnuncio))
  }
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
  return { items, costoUsd: paginasPedidas * config.zyteCostoListadoUsd, html }
}
