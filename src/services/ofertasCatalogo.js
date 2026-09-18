import { meliGet } from './meli.js'

// DE QUIÉN ES ESTE STOCK. Una página de catálogo (/p/MLC…) muestra al ganador de
// la caja de compra, que rota: el 18-sep-2026 el 38% de las lecturas de catálogo
// reportaban un vendedor distinto al que seguíamos, y eso fabricaba reposiciones
// que no existían.
//
// La API oficial lo resuelve gratis. `/products/{id}/items` lista TODAS las
// ofertas de ese producto, cada una con:
//   · `item_id`   — la publicación propia de ese vendedor
//   · `seller_id` — quién es
//   · `shipping.logistic_type` — 'fulfillment' es Full de verdad, no un badge
//                                leído de la página
//   · `price`     — sin pagar scraping
// Con el item_id se lee la página PROPIA del vendedor, que siempre muestra SU
// stock. Probado sobre el mismo producto de catálogo: un vendedor "+5", otro
// "+50", leídos por separado y sin ambigüedad.
const ID = /^MLC\d+$/i

export const urlDeItem = (itemId) => `https://articulo.mercadolibre.cl/${String(itemId).replace(/^(MLC)/i, '$1-')}-_JM`

export const esFullPorLogistica = (logisticType) => (logisticType == null ? null : logisticType === 'fulfillment')

// Pura: ordena y limpia lo que entrega la API.
export function ofertasDe(respuesta) {
  return (respuesta?.results ?? [])
    .filter((o) => o?.item_id && ID.test(o.item_id))
    .map((o) => ({
      itemId: o.item_id,
      sellerId: o.seller_id != null ? String(o.seller_id) : null,
      precio: Number.isFinite(o.price) ? o.price : null,
      logisticType: o.shipping?.logistic_type ?? null,
      esFull: esFullPorLogistica(o.shipping?.logistic_type),
      esTiendaOficial: o.official_store_id != null,
      url: urlDeItem(o.item_id),
    }))
    .sort((a, b) => (a.precio ?? Infinity) - (b.precio ?? Infinity))
}

// El id de catálogo sale de la URL: .../p/MLC27221799 o /p/MLC27221799#algo
export function catalogoDeUrl(url) {
  const m = /\/p\/(MLC\d+)/i.exec(String(url ?? ''))
  return m ? m[1].toUpperCase() : null
}

// El id de la publicación propia sale de su URL: articulo…/MLC-3545535420-slug
export function itemDeUrl(url) {
  const m = /\/(MLC)-?(\d{6,})/i.exec(String(url ?? ''))
  return m ? `${m[1].toUpperCase()}${m[2]}` : null
}

export async function ofertasDeCatalogo(catalogId) {
  if (!ID.test(String(catalogId ?? ''))) return []
  const r = await meliGet(`/products/${catalogId}/items`).catch(() => null)
  return ofertasDe(r)
}
