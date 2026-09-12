import { normalizarMeses, indiceMes } from './series.js'

export const VERSION_CONTEXTO = 'unidades-visitas-contexto-v1'
export const OBJETIVO_CONTEXTO = 'unidades-por-visita-contexto'
export const VARIABLES_CONTEXTO = ['busquedas12mLog', 'crecimientoAnualLog', 'estacionMesLog',
  'precioRelativoLog', 'fullObservado', 'coberturaFull', 'catalogoObservado', 'resenasLog', 'coberturaResenas']
const DIA = 86400e3
const media = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 }

// Dedupe por publicación (o SKU si no viene el id), conservando la primera
// posición. Listado y detalle son revisiones del mismo scan, no dos muestras.
export function productosUnicos(productos) {
  const vistos = new Set()
  return [...productos].filter((p) => p?.sku).sort((a, b) => (a.posicion ?? Infinity) - (b.posicion ?? Infinity) || a.sku.localeCompare(b.sku))
    .filter((p) => { const id = p.itemId || p.sku; if (vistos.has(id)) return false; vistos.add(id); return true })
}

export function construirContexto({ captura, serie, desde, itemId, precio }) {
  const t = +new Date(desde)
  const falta = (motivo) => ({ contexto: null, motivo })
  if (!Number.isFinite(t) || !Number.isFinite(precio) || precio <= 0) return falta('atributos-invalidos')
  if (!captura || captura.fuente !== 'zyte') return falta('sin-captura-zyte-anterior')
  const scan = +new Date(captura.fechaScan), disponible = +new Date(captura.capturadoEl)
  if (!Number.isFinite(scan) || !Number.isFinite(disponible) || scan > disponible || disponible > t || t - scan > 14 * DIA) return falta('captura-zyte-fuera-de-fecha')
  if (!serie || serie.keyword !== captura.keywordDemanda || serie.pais !== 2152 || serie.idioma !== 'es' || serie.fuente !== 'google-ads') return falta('sin-serie-demanda-anterior')
  if (!serie.capturadoEl || !Number.isFinite(+new Date(serie.capturadoEl)) || +new Date(serie.capturadoEl) > t) return falta('serie-demanda-posterior')
  const mesInicio = indiceMes(new Date(t).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }).slice(0, 7))
  const meses = normalizarMeses(serie.meses).filter((m) => indiceMes(m.periodo) < mesInicio)
  const ultimo = indiceMes(meses.at(-1)?.periodo)
  if (ultimo === null || mesInicio - ultimo > 2) return falta('demanda-sin-meses-recientes')
  const valores = new Map(meses.map((m) => [indiceMes(m.periodo), m.valor]))
  const historia = Array.from({ length: 24 }, (_, i) => valores.get(ultimo - 23 + i))
  if (!historia.every(Number.isFinite)) return falta('demanda-con-huecos')
  const mercado = productosUnicos(captura.productos ?? []).filter((p) => p.sku !== itemId && p.itemId !== itemId && Number.isFinite(p.precio) && p.precio > 0).slice(0, 30)
  if (mercado.length < 10) return falta('pocos-productos-zyte')
  const full = mercado.filter((p) => typeof p.esFull === 'boolean')
  const resenas = mercado.filter((p) => Number.isFinite(p.resenasZyte) && p.resenasZyte >= 0)
  const precioMediano = mediana(mercado.map((p) => p.precio))
  const reciente = media(historia.slice(-12)), anterior = media(historia.slice(0, 12))
  const xs = [Math.log1p(reciente), Math.log1p(reciente) - Math.log1p(anterior),
    Math.log1p(valores.get(mesInicio - 12)) - Math.log1p(reciente), Math.log(precio / precioMediano),
    full.length ? full.filter((p) => p.esFull).length / full.length : 0, full.length / mercado.length,
    mercado.filter((p) => p.tipoListing === 'catalogo').length / mercado.length,
    resenas.length ? Math.log1p(mediana(resenas.map((p) => p.resenasZyte))) : 0, resenas.length / mercado.length]
  if (!xs.every(Number.isFinite)) return falta('contexto-incompleto')
  return { motivo: null, contexto: { version: VERSION_CONTEXTO, xs, nichoId: String(captura.nichoId),
    keyword: captura.keyword, keywordDemanda: captura.keywordDemanda, capturaId: String(captura._id), serieId: String(serie._id),
    scanEl: captura.fechaScan, zyteDisponibleEl: captura.capturadoEl, demandaDisponibleEl: serie.capturadoEl,
    hastaMesDemanda: meses.at(-1).periodo, productosComparados: mercado.length, precioMediano,
    // Reseñas públicas, posiblemente agregadas por catálogo. Nunca órdenes pagadas.
    fuentes: ['zyte', 'google-ads-dataforseo'], desde } }
}

export function contextoValido(contexto) {
  return contexto?.version === VERSION_CONTEXTO && Array.isArray(contexto.xs) &&
    contexto.xs.length === VARIABLES_CONTEXTO.length && contexto.xs.every(Number.isFinite)
}

// Buscar la última evidencia que YA EXISTÍA al abrir la ventana de ventas.
export function unirFuentes(observaciones, capturas, series) {
  const porNicho = new Map(), porKeyword = new Map()
  for (const c of [...capturas].sort((a, b) => +new Date(b.capturadoEl) - +new Date(a.capturadoEl) || String(b._id).localeCompare(String(a._id)))) {
    const id = String(c.nichoId); if (!porNicho.has(id)) porNicho.set(id, []); porNicho.get(id).push(c)
  }
  for (const s of [...series].sort((a, b) => +new Date(b.capturadoEl) - +new Date(a.capturadoEl) || String(b._id).localeCompare(String(a._id)))) {
    if (!porKeyword.has(s.keyword)) porKeyword.set(s.keyword, []); porKeyword.get(s.keyword).push(s)
  }
  const datos = [], omitidas = {}
  for (const o of observaciones) {
    let resultado
    if (!o.nichoId) resultado = { motivo: 'producto-sin-nicho-vinculado' }
    else {
      const captura = porNicho.get(String(o.nichoId))?.find((c) => +new Date(c.capturadoEl) <= +new Date(o.desde))
      const serie = porKeyword.get(captura?.keywordDemanda)?.find((s) => +new Date(s.capturadoEl) <= +new Date(o.desde))
      resultado = construirContexto({ captura, serie, desde: o.desde, itemId: o.itemId, precio: o.precio })
    }
    if (resultado.contexto) datos.push({ ...o, contexto: resultado.contexto })
    else omitidas[resultado.motivo] = (omitidas[resultado.motivo] ?? 0) + 1
  }
  return { datos, omitidas, ventanasCandidatas: observaciones.length }
}
