import { Snapshot } from '../../models/Snapshot.js'

// EL PANEL DE COMPETIDORES: LO QUE YA SE GUARDÓ Y NINGÚN MODELO USA.
//
// Cada scan deja, por publicación ajena, precio, descuento, posición, anuncio,
// reseñas, balde de vendidos, stock y preguntas. Con 110 nichos y ~90
// publicaciones cada uno son miles de productos con historia, contra los 4
// propios activos de los que aprende hoy el modelo comercial.
//
// Antes de entrenar hay que saber cuántos pares de lecturas sirven de verdad.
// Dos trampas medidas el 22-sep-2026 en brochas de maquillaje:
//  - reseñas de CATÁLOGO: tres publicaciones distintas con exactamente
//    572→634, porque la ficha muestra el agregado de todos los vendedores;
//  - SALTOS de fuente: 1.538→70 y 552→67, al pasar de la ficha a la API.
// Por eso la etiqueta de reseñas usa solo `numReviewsApi` (por publicación),
// descarta el valor repetido por varias publicaciones en el mismo scan y
// descarta las caídas, que no existen en un contador acumulado.

const DIA = 86400e3
const CAIDA_TOLERADA = 0.02 // ML borra alguna reseña; más que eso es otra fuente
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 : null }

// Valores de reseñas que aparecen en más de una publicación del mismo scan:
// no son de la publicación, son del catálogo que comparten.
export function reseniasCompartidas(snaps) {
  const cuenta = new Map()
  for (const s of snaps) {
    if (!(s.numReviewsApi > 0)) continue
    const k = `${s.keyword}|${+new Date(s.fecha)}|${s.numReviewsApi}`
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1)
  }
  return new Set([...cuenta].filter(([, n]) => n > 1).map(([k]) => k))
}

// Pura. Pares consecutivos por publicación, con la etiqueta de venta que cada
// fuente permite y el motivo cuando no la permite.
export function paresDeLecturas(snaps) {
  const compartidas = reseniasCompartidas(snaps)
  const porSku = new Map()
  for (const s of snaps) porSku.set(s.sku, [...(porSku.get(s.sku) ?? []), s])
  const pares = []
  for (const [sku, lista] of porSku) {
    const orden = lista.filter((s) => Number.isFinite(+new Date(s.fecha))).sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
    for (let i = 1; i < orden.length; i++) {
      const a = orden[i - 1], b = orden[i]
      const dias = (+new Date(b.fecha) - +new Date(a.fecha)) / DIA
      if (dias < 0.5) continue // listado y ficha del mismo scan
      let resenias = null, motivo = null
      if (!Number.isFinite(a.numReviewsApi) || !Number.isFinite(b.numReviewsApi)) motivo = 'sin-api'
      else if ([a, b].some((s) => compartidas.has(`${s.keyword}|${+new Date(s.fecha)}|${s.numReviewsApi}`))) motivo = 'compartida-catalogo'
      else if (b.numReviewsApi < a.numReviewsApi * (1 - CAIDA_TOLERADA) - 1) motivo = 'caida'
      else resenias = Math.max(0, b.numReviewsApi - a.numReviewsApi)
      const preguntas = Array.isArray(a.preguntasIds) && Array.isArray(b.preguntasIds)
        ? b.preguntasIds.filter((id) => !new Set(a.preguntasIds).has(id)).length : null
      const balde = Number.isFinite(a.vendidos) && Number.isFinite(b.vendidos) ? (b.vendidos > a.vendidos ? 'subio' : b.vendidos < a.vendidos ? 'bajo' : 'igual') : null
      pares.push({ sku, keyword: b.keyword, desde: a.fecha, hasta: b.fecha, dias, resenias, motivo, preguntas, balde,
        conPosicion: Number.isFinite(a.posicion), conPrecio: a.precio > 0, anuncio: a.esAnuncio ?? null })
    }
  }
  return pares
}

// Pura. Cuánto del panel sirve para entrenar.
export function auditarPanel(snaps, pares = paresDeLecturas(snaps)) {
  const skus = new Map()
  for (const s of snaps) skus.set(s.sku, (skus.get(s.sku) ?? 0) + 1)
  const conEtiqueta = pares.filter((p) => p.resenias !== null)
  const motivos = {}
  for (const p of pares) if (p.motivo) motivos[p.motivo] = (motivos[p.motivo] ?? 0) + 1
  const skusUtiles = new Set(conEtiqueta.map((p) => p.sku))
  const porNicho = new Map()
  for (const p of conEtiqueta) {
    if (!porNicho.has(p.keyword)) porNicho.set(p.keyword, new Set())
    porNicho.get(p.keyword).add(p.sku)
  }
  const fechas = snaps.map((s) => +new Date(s.fecha)).filter(Number.isFinite)
  return {
    lecturas: snaps.length,
    desde: fechas.length ? new Date(Math.min(...fechas)) : null,
    hasta: fechas.length ? new Date(Math.max(...fechas)) : null,
    publicaciones: skus.size,
    conDosLecturas: [...skus.values()].filter((n) => n >= 2).length,
    conCuatroLecturas: [...skus.values()].filter((n) => n >= 4).length,
    pares: pares.length,
    diasEntreLecturas: mediana(pares.map((p) => p.dias)),
    resenias: {
      paresUtiles: conEtiqueta.length,
      paresConVenta: conEtiqueta.filter((p) => p.resenias > 0).length,
      publicacionesUtiles: skusUtiles.size,
      publicacionesConVenta: new Set(conEtiqueta.filter((p) => p.resenias > 0).map((p) => p.sku)).size,
      descartes: motivos,
    },
    preguntas: {
      pares: pares.filter((p) => p.preguntas !== null).length,
      paresConNuevas: pares.filter((p) => p.preguntas > 0).length,
    },
    baldeVendidos: {
      pares: pares.filter((p) => p.balde !== null).length,
      subio: pares.filter((p) => p.balde === 'subio').length,
    },
    nichos: {
      conPanel: porNicho.size,
      conDiezOMas: [...porNicho.values()].filter((s) => s.size >= 10).length,
    },
  }
}

let cache = null
export async function auditoriaPanelCompetidores({ dias = 90, ahora = new Date() } = {}) {
  if (cache && +ahora - cache.en < 10 * 60e3 && cache.dias === dias) return cache.valor
  const snaps = await Snapshot.find({ fecha: { $gte: new Date(+ahora - dias * DIA) } })
    .select('sku fecha keyword precio posicion esAnuncio numReviewsApi vendidos preguntasIds -_id').lean()
  const valor = { dias, ...auditarPanel(snaps) }
  cache = { en: +ahora, dias, valor }
  return valor
}
