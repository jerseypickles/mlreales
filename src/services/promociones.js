import { meliGet, hayCuentaMeli } from './meli.js'

// Promociones de ML sobre un item propio. El precio de LISTA no es el que ve
// el comprador: una campaña activa (DEAL, PRICE_DISCOUNT…) manda sobre él —
// caso 8-ago: las 3 brochas seguían vendiéndose a $1.890 pese a que la lista
// decía $2.690, así que la subida de precio nunca llegó al cliente.
export async function promocionesDeItem(itemId) {
  try {
    if (!(await hayCuentaMeli())) return null
    const lista = await meliGet(`/seller-promotions/items/${itemId}?app_version=v2`)
    if (!Array.isArray(lista)) return null
    const activa = lista.find((p) => p.status === 'started') ?? null
    const candidatas = lista.filter((p) => p.status === 'candidate')
    const oferta = candidatas.find((p) => p.type === 'PRICE_DISCOUNT') ?? null
    return {
      activa: activa
        ? {
            id: activa.id ?? null,
            tipo: activa.type,
            nombre: activa.name || activa.type,
            precio: activa.price ?? null,
            precioOriginal: activa.original_price ?? null,
            terminaEl: activa.finish_date ?? null,
          }
        : null,
      // margen de maniobra para una oferta propia, según ML
      ofertaPropia: oferta
        ? {
            minimo: oferta.min_discounted_price ?? null,
            maximo: oferta.max_discounted_price ?? null,
            sugerido: oferta.suggested_discounted_price ?? null,
          }
        : null,
      campanasDisponibles: candidatas
        .filter((p) => p.type !== 'PRICE_DISCOUNT' && p.name)
        .map((p) => ({ id: p.id, nombre: p.name, desde: p.start_date, hasta: p.finish_date })),
    }
  } catch (err) {
    console.warn(`[promos] ${itemId}: ${err.message}`)
    return null
  }
}
