import { config } from '../config/env.js'
import { cuerpoPeticion, stockDesdeHtml, vendedorDesdeHtml } from './detalleMl.js'
import { cuerpoListado, urlListado, itemsDesdeHtml } from './listadoMl.js'

// PRUEBA A/B DE CONFIGURACIONES DE ZYTE (22-sep-2026).
//
// La documentación de Zyte dice tres cosas que pueden abaratar cada lectura
// sin perder dato: (1) Chile es una geolocalización "extendida" con recargo,
// (2) una respuesta HTTP sin navegador cuesta 4-13 veces menos que una con
// navegador, (3) la extracción automática (`product`) se cobra aparte por
// tipo de dato. Nada de eso se cambia a ciegas: la última vez que se sacó el
// navegador se perdió el precio, y sin la espera de 3 s el precio que se leía
// era el TACHADO. Esto pide la misma página con cada variante y compara campo
// por campo contra la configuración actual, que es la validada.

const ZYTE = 'https://api.zyte.com/v1/extract'

export const VARIANTES_FICHA = {
  actual: (url) => ({ ...cuerpoPeticion(url), tags: { ab: 'ficha-actual' } }),
  navegadorSinGeo: (url) => ({ url, browserHtml: true, actions: [{ action: 'waitForTimeout', timeout: 3 }], tags: { ab: 'ficha-navegador-sin-geo' } }),
  httpConGeo: (url) => ({ url, geolocation: 'CL', httpResponseBody: true, tags: { ab: 'ficha-http-cl' } }),
  httpSinGeo: (url) => ({ url, httpResponseBody: true, tags: { ab: 'ficha-http' } }),
}

export const VARIANTES_LISTADO = {
  actual: (kw) => ({ ...cuerpoListado(kw), tags: { ab: 'listado-actual' } }),
  navegadorSinAcciones: (kw) => ({ url: urlListado(kw), geolocation: 'CL', browserHtml: true, tags: { ab: 'listado-navegador-sin-acciones' } }),
  httpConGeo: (kw) => ({ url: urlListado(kw), geolocation: 'CL', httpResponseBody: true, tags: { ab: 'listado-http-cl' } }),
  httpSinGeo: (kw) => ({ url: urlListado(kw), httpResponseBody: true, tags: { ab: 'listado-http' } }),
}

const primero = (texto, patrones) => {
  for (const re of patrones) {
    const m = texto.match(re)
    // datos estructurados: punto decimal, sin separador de miles
    if (m) return Number(m[1])
  }
  return null
}

// Pura. Lo que la ficha dice de sí misma en el HTML, sin la extracción de
// Zyte. El precio sale de los datos estructurados (meta itemprop y JSON-LD),
// que es el vigente; el primer "andes-money-amount" suele ser el tachado.
export function fichaDesdeHtml(html) {
  const t = String(html ?? '')
  return {
    precio: primero(t, [/itemprop="price"\s+content="([\d.]+)"/i, /content="([\d.]+)"\s+itemprop="price"/i, /"offers":\{[^}]*?"price":\s*"?([\d.]+)/]),
    rating: primero(t, [/"ratingValue":\s*"?([\d.]+)/]),
    resenias: primero(t, [/"reviewCount":\s*"?(\d+)/]),
    stock: stockDesdeHtml(t),
    vendedor: vendedorDesdeHtml(t)?.sellerId ?? null,
    preguntas: (t.match(/"question_id":\s*\d+|"id":\s*\d+,\s*"text":"[^"]{3,}\?"/g) ?? []).length,
    caracteres: t.length,
  }
}

async function pedir(cuerpo, apiKey) {
  const inicio = Date.now()
  try {
    const r = await fetch(ZYTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(200_000),
    })
    const ms = Date.now() - inicio
    if (!r.ok) return { ok: false, ms, status: r.status, error: (await r.text().catch(() => '')).slice(0, 160) }
    const j = await r.json()
    const html = j.browserHtml ?? (j.httpResponseBody ? Buffer.from(j.httpResponseBody, 'base64').toString('utf8') : '')
    return { ok: true, ms, html, product: j.product ?? null }
  } catch (err) {
    return { ok: false, ms: Date.now() - inicio, error: err.message }
  }
}

async function enParalelo(tareas, limite) {
  const salida = new Array(tareas.length)
  let i = 0
  await Promise.all(Array.from({ length: limite }, async () => {
    while (i < tareas.length) { const k = i++; salida[k] = await tareas[k]() }
  }))
  return salida
}

const igual = (a, b) => a === null || b === null ? null : a === b
const mismoStock = (a, b) => !a || !b ? null : a.stock === b.stock && a.stockFuente === b.stockFuente

export async function pruebaAb({ urls = [], keywords = [], apiKey = config.zyteApiKey, concurrencia = 4 } = {}) {
  if (!apiKey) throw new Error('falta ZYTE_API_KEY')
  const tareas = []
  for (const url of urls) for (const [nombre, cuerpo] of Object.entries(VARIANTES_FICHA)) tareas.push(async () => ({ tipo: 'ficha', url, nombre, r: await pedir(cuerpo(url), apiKey) }))
  for (const kw of keywords) for (const [nombre, cuerpo] of Object.entries(VARIANTES_LISTADO)) tareas.push(async () => ({ tipo: 'listado', kw, nombre, r: await pedir(cuerpo(kw), apiKey) }))
  const crudos = await enParalelo(tareas, concurrencia)

  const fichas = urls.map((url) => {
    const porVar = Object.fromEntries(crudos.filter((c) => c.tipo === 'ficha' && c.url === url).map((c) => [c.nombre, c.r]))
    const base = porVar.actual
    // la referencia de precio es la que hoy se guarda: la extracción de Zyte
    // sobre el navegador con espera
    const precioRef = Number(base?.product?.price) || null
    const ref = base?.ok ? fichaDesdeHtml(base.html) : null
    return { url, precioReferencia: precioRef, variantes: Object.fromEntries(Object.entries(porVar).map(([n, r]) => {
      if (!r.ok) return [n, { ok: false, ms: r.ms, status: r.status ?? null, error: r.error }]
      const f = fichaDesdeHtml(r.html)
      return [n, { ok: true, ms: r.ms, caracteres: f.caracteres, precioHtml: f.precio, precioOk: igual(f.precio, precioRef),
        stock: f.stock?.stock ?? null, stockIgual: mismoStock(f.stock, ref?.stock), vendedorIgual: igual(f.vendedor, ref?.vendedor),
        resenias: f.resenias, reseniasIguales: igual(f.resenias, ref?.resenias), preguntas: f.preguntas }]
    })) }
  })

  const listados = keywords.map((kw) => {
    const porVar = Object.fromEntries(crudos.filter((c) => c.tipo === 'listado' && c.kw === kw).map((c) => [c.nombre, c.r]))
    const base = porVar.actual?.ok ? itemsDesdeHtml(porVar.actual.html, { keyword: kw }) : []
    const clave = (i) => i.itemId ?? i.zProductoLink
    const precioBase = new Map(base.map((i) => [clave(i), i.nuevoPrecio]))
    return { keyword: kw, variantes: Object.fromEntries(Object.entries(porVar).map(([n, r]) => {
      if (!r.ok) return [n, { ok: false, ms: r.ms, status: r.status ?? null, error: r.error }]
      const items = itemsDesdeHtml(r.html, { keyword: kw })
      const comunes = items.filter((i) => precioBase.has(clave(i)))
      return [n, { ok: true, ms: r.ms, caracteres: r.html.length, items: items.length,
        conVendidos: items.filter((i) => Number.isFinite(i.cantidadVendida)).length,
        conPosicion: items.filter((i) => Number.isFinite(i.itemPosition)).length,
        conEnvio: items.filter((i) => i.Envio).length,
        resultadosTotales: items[0]?.resultadosTotales ?? null,
        anuncios: items.filter((i) => i.esAnuncio).length,
        enComunConActual: comunes.length, mismoPrecio: comunes.filter((i) => i.nuevoPrecio === precioBase.get(clave(i))).length }]
    })) }
  })
  return { fichas, listados, pedidas: tareas.length }
}
