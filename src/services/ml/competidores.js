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
// descarta la trayectoria que comparten varias publicaciones y las caídas, que no existen en un contador acumulado.

const DIA = 86400e3
const CAIDA_TOLERADA = 0.02 // ML borra alguna reseña; más que eso es otra fuente
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 : null }

// Un catálogo comparte el conteo entre todas sus publicaciones, así que dos
// publicaciones del mismo nicho se mueven JUNTAS: mismo valor en las dos
// lecturas. Un valor repetido en una sola foto no basta: 1, 2 o 3 reseñas
// coinciden por azar entre publicaciones sin relación (medido 22-sep: esa
// regla marcaba 10.435 pares). Bajo MINIMO_COMPARTIDA la coincidencia de
// trayectoria también puede ser azar, y no se castiga.
const MINIMO_COMPARTIDA = 10
const claveTrayecto = (a, b) => `${b.keyword}|${+new Date(a.fecha)}|${+new Date(b.fecha)}|${a.numReviewsApi}|${b.numReviewsApi}`
export function trayectosCompartidos(paresCrudos) {
  const cuenta = new Map()
  for (const [a, b] of paresCrudos) {
    if (!(b.numReviewsApi >= MINIMO_COMPARTIDA) || !Number.isFinite(a.numReviewsApi)) continue
    const k = claveTrayecto(a, b)
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1)
  }
  return new Set([...cuenta].filter(([, n]) => n > 1).map(([k]) => k))
}

// Pura. Pares consecutivos por publicación, con la etiqueta de venta que cada
// fuente permite y el motivo cuando no la permite.
export function paresDeLecturas(snaps) {
  const porSku = new Map()
  for (const s of snaps) porSku.set(s.sku, [...(porSku.get(s.sku) ?? []), s])
  const crudos = []
  for (const [sku, lista] of porSku) {
    const orden = lista.filter((s) => Number.isFinite(+new Date(s.fecha))).sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
    for (let i = 1; i < orden.length; i++) {
      // listado y ficha del mismo scan no son dos lecturas
      if ((+new Date(orden[i].fecha) - +new Date(orden[i - 1].fecha)) / DIA >= 0.5) crudos.push([orden[i - 1], orden[i], sku])
    }
  }
  const compartidos = trayectosCompartidos(crudos)
  const pares = []
  for (const [a, b, sku] of crudos) {
    const dias = (+new Date(b.fecha) - +new Date(a.fecha)) / DIA
    let resenias = null, motivo = null
    if (!Number.isFinite(a.numReviewsApi) || !Number.isFinite(b.numReviewsApi)) motivo = 'sin-api'
    else if (compartidos.has(claveTrayecto(a, b))) motivo = 'compartida-catalogo'
    else if (b.numReviewsApi < a.numReviewsApi * (1 - CAIDA_TOLERADA) - 1) motivo = 'caida'
    // ML a veces pasa a sumar las reseñas del producto agrupado: 397 → 1.816 de
    // un día a otro en cuatro publicaciones distintas (25-sep-2026). No es venta
    else if (b.numReviewsApi - a.numReviewsApi > 50 && b.numReviewsApi - a.numReviewsApi > a.numReviewsApi * 0.5) motivo = 'salto-fuente'
    else resenias = Math.max(0, b.numReviewsApi - a.numReviewsApi)
    const preguntas = Array.isArray(a.preguntasIds) && Array.isArray(b.preguntasIds)
      ? b.preguntasIds.filter((id) => !new Set(a.preguntasIds).has(id)).length : null
    const balde = Number.isFinite(a.vendidos) && Number.isFinite(b.vendidos) ? (b.vendidos > a.vendidos ? 'subio' : b.vendidos < a.vendidos ? 'bajo' : 'igual') : null
    pares.push({ sku, keyword: b.keyword, desde: a.fecha, hasta: b.fecha, dias, resenias, motivo, preguntas, balde,
      conPosicion: Number.isFinite(a.posicion), conPrecio: a.precio > 0, anuncio: a.esAnuncio ?? null })
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
  // reduce y no Math.min(...): con 100 mil lecturas el spread revienta la pila
  const fechas = snaps.map((s) => +new Date(s.fecha)).filter(Number.isFinite)
  return {
    lecturas: snaps.length,
    desde: fechas.length ? new Date(fechas.reduce((a, b) => Math.min(a, b))) : null,
    hasta: fechas.length ? new Date(fechas.reduce((a, b) => Math.max(a, b))) : null,
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
