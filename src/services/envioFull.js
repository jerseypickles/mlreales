import { meliGet, hayCuentaMeli } from './meli.js'

// Lo que ML le cobra al VENDEDOR por despachar una venta Full. Sondeado en vivo
// el 10-ago-2026 contra la cuenta: NO es un porcentaje del precio ni un fijo,
// es una tabla escalonada que salta en $9.990 y otra vez en $19.990 (ahí ML
// obliga a envío gratis y el cargo se triplica). El descuento por nivel de
// vendedor (hoy 30%, 50% en el tramo alto) lo aplica ML y viene en la misma
// respuesta, así que no se hardcodea nada: se pregunta.
//
// Reemplaza el supuesto `fullPorUnidadClp: 1200` de config/importacion.js, que
// subestima en ~$2.050 por unidad todo lo que se venda sobre $19.990.
//
// Validación: el cargo real facturado de las brochas (CXD $1.142 sin descuento
// → $799,4 con 30%) coincide exacto con lo que devuelve esta ruta.

// Caja chica por defecto cuando ML no declara dimensiones del item. Dentro del
// tramo de precio la tarifa es insensible al peso en paquetes chicos (150g y
// 300g devuelven lo mismo), así que el error acá es menor que el del tramo.
export const DIMENSIONES_POR_DEFECTO = { largoCm: 20, anchoCm: 10, altoCm: 5, gramos: 300 }

const DIVISOR_VOLUMETRICO = 4000 // cm³ por kg facturable (regla de ML)

// ML factura por el MAYOR entre el peso real y el volumétrico. Verificado:
// 20x15x10 con 500g reales factura 750g (3.000 cm³ / 4000 = 0,75 kg).
export function pesoFacturableG({ largoCm, anchoCm, altoCm, gramos }) {
  const volumetrico = ((largoCm ?? 0) * (anchoCm ?? 0) * (altoCm ?? 0) * 1000) / DIVISOR_VOLUMETRICO
  return Math.max(Number(gramos) || 0, Math.round(volumetrico))
}

export function formatoDimensiones({ largoCm, anchoCm, altoCm, gramos }) {
  return `${largoCm}x${anchoCm}x${altoCm},${gramos}`
}

// Dimensiones declaradas por ML en el item ("30x20x10,500"). Devuelve null si
// el item no las declara — los de Full suelen venir sin ellas.
export function dimensionesDeItem(oficial) {
  const crudo = oficial?.shipping?.dimensions
  if (typeof crudo !== 'string') return null
  const m = crudo.match(/^(\d+)x(\d+)x(\d+),(\d+)$/)
  if (!m) return null
  return { largoCm: Number(m[1]), anchoCm: Number(m[2]), altoCm: Number(m[3]), gramos: Number(m[4]) }
}

let idVendedor = null
async function vendedor() {
  if (idVendedor) return idVendedor
  idVendedor = (await meliGet('/users/me'))?.id ?? null
  return idVendedor
}

// cache por (tramo de precio | dimensiones | tipo), TTL 12h: la tabla no se
// mueve dentro del día y el tablero no debe pagar una llamada por fila
const cache = new Map()
const TTL_MS = 12 * 3600e3

export async function costoEnvioFull({
  precioClp,
  dimensiones = DIMENSIONES_POR_DEFECTO,
  tipoPublicacion = 'gold_pro',
}) {
  try {
    if (!Number.isFinite(precioClp) || precioClp <= 0) return null
    if (!(await hayCuentaMeli())) return null
    const dim = formatoDimensiones(dimensiones)
    // banda de $1.000 para no llamar por cada peso, pero SIN cruzar los saltos:
    // $9.990 y $19.990 se consultan tal cual porque ahí cambia la tarifa
    const banda = precioClp >= 19_990 || precioClp >= 9_990 ? precioClp : Math.round(precioClp / 1000) * 1000
    const clave = `${banda}|${dim}|${tipoPublicacion}`
    const hit = cache.get(clave)
    if (hit && Date.now() - hit.el < TTL_MS) return hit.valor

    const uid = await vendedor()
    if (!uid) return null
    const params = new URLSearchParams({
      dimensions: dim,
      logistic_type: 'fulfillment',
      item_price: String(precioClp),
      listing_type_id: tipoPublicacion,
      condition: 'new',
      verbose: 'true',
    })
    const r = await meliGet(`/users/${uid}/shipping_options/free?${params.toString()}`)
    const c = r?.coverage?.all_country
    const valor = Number.isFinite(c?.list_cost)
      ? {
          clp: c.list_cost,
          tarifaSinDescuentoClp: c.discount?.promoted_amount ?? null,
          descuentoPct: Number.isFinite(c.discount?.rate) ? Math.round(c.discount.rate * 100) : null,
          pesoFacturableG: c.billable_weight ?? null,
        }
      : null
    cache.set(clave, { valor, el: Date.now() })
    return valor
  } catch (err) {
    console.warn(`[envio-full] shipping_options falló: ${err.message}`)
    return null
  }
}
