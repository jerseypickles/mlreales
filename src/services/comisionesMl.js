import { Producto } from '../models/Producto.js'
import { meliGet, hayCuentaMeli } from './meli.js'

// Comisión EXACTA de Mercado Libre vía /sites/MLC/listing_prices (validada en
// vivo 22-jul: percentage_fee + fixed_fee por tipo de publicación). Reemplaza
// la comisión adivinada por el LLM (±2-3 puntos = miles de CLP por unidad).

// gold_special = Clásica, el tipo que asume el modelo de margen; si ML no la
// lista para esa categoría/precio, la de menor comisión disponible.
export function elegirClasica(filas) {
  const lista = Array.isArray(filas) ? filas : []
  return (
    lista.find((f) => f.listing_type_id === 'gold_special') ??
    [...lista].sort((a, b) => (a.sale_fee_amount ?? Infinity) - (b.sale_fee_amount ?? Infinity))[0] ??
    null
  )
}

// cache por (categoría | banda de $5.000), TTL 24h: el tarifario no cambia
// dentro del día y el tablero no debe pagar una llamada por fila
const cache = new Map()
const TTL_MS = 24 * 3600e3

// tipoPublicacion: para MIS productos hay que cobrar la comisión del tipo real
// del item (los de la cuenta son gold_pro, 17%), no la de la Clásica que asume
// el modelo de margen para nichos que todavía no existen.
export async function comisionMlExacta({ precioClp, categoriaId = null, tipoPublicacion = null }) {
  try {
    if (!Number.isFinite(precioClp) || precioClp <= 0) return null
    if (!(await hayCuentaMeli())) return null
    // banda fina bajo $10.000: ahí vive el cargo fijo por publicación barata y
    // redondear a $5.000 lo cruzaba de tramo. Sobre eso la comisión es plana.
    const paso = precioClp < 10_000 ? 1000 : 5000
    const banda = Math.max(1000, Math.round(precioClp / paso) * paso)
    const clave = `${categoriaId ?? 'x'}|${banda}|${tipoPublicacion ?? 'clasica'}`
    const hit = cache.get(clave)
    if (hit && Date.now() - hit.el < TTL_MS) return hit.valor
    const params = new URLSearchParams({ price: String(banda) })
    if (categoriaId) params.set('category_id', categoriaId)
    const filas = await meliGet(`/sites/MLC/listing_prices?${params.toString()}`)
    const lista = Array.isArray(filas) ? filas : []
    const clasica =
      (tipoPublicacion ? lista.find((f) => f.listing_type_id === tipoPublicacion) : null) ?? elegirClasica(filas)
    const valor =
      clasica && Number.isFinite(clasica.sale_fee_details?.percentage_fee)
        ? {
            pct: clasica.sale_fee_details.percentage_fee,
            cargoFijoClp: clasica.sale_fee_details.fixed_fee ?? 0,
            tipo: clasica.listing_type_id,
          }
        : null
    cache.set(clave, { valor, el: Date.now() })
    return valor
  } catch (err) {
    console.warn(`[comisiones] listing_prices falló: ${err.message}`)
    return null
  }
}

// Categoría ML dominante entre los productos del nicho (la trae el nivel 2).
export async function categoriaDominante(keyword) {
  const filas = await Producto.aggregate([
    { $match: { keywordOrigen: keyword, categoriaML: { $nin: [null, ''] } } },
    { $group: { _id: '$categoriaML', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ])
  return filas[0]?._id ?? null
}
