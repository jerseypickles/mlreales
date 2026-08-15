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
    const resumir = (p) => ({
      id: p.id ?? null,
      tipo: p.type,
      nombre: p.name || p.type,
      precio: p.price ?? null,
      precioOriginal: p.original_price ?? null,
      empiezaEl: p.start_date ?? null,
      terminaEl: p.finish_date ?? null,
    })
    return {
      activa: activa ? resumir(activa) : null,
      // PRECIOS YA COMPROMETIDOS A FUTURO. Se leía solo `started`, así que el
      // sistema era ciego a las promociones AGENDADAS —status `pending`, que
      // según ML es "descuento programado, todavía no activo"— y ahí hay
      // decisiones ya tomadas: al 15-ago la lámpara tenía Black Week comprometida
      // a $6.780 desde el 27-ago y Ofertas 9 del 9 a $6.920 desde el 2-sep,
      // ninguna de las dos visible en el tablero.
      //
      // Importa para cualquier automatización de precio: subir el precio de
      // lista con una promo agendada encima es pisar un compromiso que ya existe.
      agendadas: lista.filter((p) => p.status === 'pending').map(resumir),
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
