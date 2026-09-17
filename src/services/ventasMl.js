import { VentaMl } from '../models/VentaMl.js'
import { meliGet, hayCuentaMeli } from './meli.js'

// Sincroniza las órdenes pagadas de la cuenta conectada (idempotente por
// orderId; corta al salir de la ventana). Corre con cada scan de propios:
// diario + "Medir ahora". Sin cuenta, no hace nada.
export async function sincronizarOrdenes({ dias = 90 } = {}) {
  if (!(await hayCuentaMeli())) return { omitido: true }
  const me = await meliGet('/users/me')
  const desde = new Date(Date.now() - dias * 24 * 3600e3)
  let nuevas = 0
  let vistas = 0
  let completa = false
  for (let offset = 0; offset < 1000; offset += 50) {
    const pagina = await meliGet(
      `/orders/search?seller=${me.id}&order.status=paid&sort=date_desc&limit=50&offset=${offset}`,
    )
    if (!Array.isArray(pagina.results)) throw new Error('ML devolvió una página de órdenes sin results')
    const resultados = pagina.results
    if (!resultados.length) { completa = true; break }
    let fueraDeVentana = false
    for (const o of resultados) {
      const fecha = new Date(o.date_closed ?? o.date_created ?? Date.now())
      if (fecha < desde) {
        fueraDeVentana = true
        break
      }
      const r = await VentaMl.updateOne(
        { orderId: String(o.id) },
        {
          $set: {
            fecha,
            estado: o.status ?? null,
            totalClp: Number.isFinite(o.total_amount) ? o.total_amount : null,
            items: (o.order_items ?? []).map((oi) => ({
              itemId: oi.item?.id ?? null,
              titulo: oi.item?.title ?? null,
              cantidad: oi.quantity ?? null,
              precioUnitClp: Number.isFinite(oi.unit_price) ? oi.unit_price : null,
            })),
          },
        },
        { upsert: true },
      )
      if (r.upsertedCount) nuevas++
      else vistas++
    }
    if (fueraDeVentana || resultados.length < 50) { completa = true; break }
  }
  // UNA ORDEN PAGADA PUEDE DEJAR DE SERLO. La búsqueda de arriba solo trae las
  // que HOY están pagadas: la que se reembolsa desaparece de ahí y acá seguía
  // guardada como venta para siempre. Medido el 17-sep-2026: ML tenía 285
  // pagadas y 8 anuladas, y esta colección 290 — cinco ventas que no existen.
  // Solo se marca lo que ya estaba guardado; una anulada que nunca se vio
  // pagada no es una venta que corregir.
  let anuladas = 0
  try {
    for (let offset = 0; offset < 500; offset += 50) {
      const pagina = await meliGet(`/orders/search?seller=${me.id}&order.status=cancelled&sort=date_desc&limit=50&offset=${offset}`)
      const resultados = Array.isArray(pagina.results) ? pagina.results : []
      for (const o of resultados) {
        const r = await VentaMl.updateOne({ orderId: String(o.id), estado: { $ne: 'cancelled' } },
          { $set: { estado: 'cancelled', anuladaEl: new Date(o.date_closed ?? o.last_updated ?? Date.now()) } })
        anuladas += r.modifiedCount
      }
      if (resultados.length < 50 || resultados.some((o) => new Date(o.date_created) < desde)) break
    }
  } catch (err) {
    console.warn(`[ventas] no se pudieron leer las órdenes anuladas: ${err.message}`)
  }
  return { nuevas, vistas, completa, desde, anuladas }
}

// Ventas reales por item en una ventana: Map itemId → {unidades, ingresosClp,
// ultimaVenta}. Para Mis productos (clave: itemIdMl ?? sku del propio).
export async function ventasPorItem({ dias = 30 } = {}) {
  const desde = new Date(Date.now() - dias * 24 * 3600e3)
  const filas = await VentaMl.aggregate([
    { $match: { fecha: { $gte: desde }, estado: { $ne: 'cancelled' } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.itemId',
        unidades: { $sum: '$items.cantidad' },
        ingresosClp: { $sum: { $multiply: ['$items.cantidad', '$items.precioUnitClp'] } },
        ultimaVenta: { $max: '$fecha' },
      },
    },
  ])
  return new Map(
    filas
      .filter((f) => f._id)
      .map((f) => [
        f._id,
        { unidades: f.unidades ?? 0, ingresosClp: Math.round(f.ingresosClp ?? 0), ultimaVenta: f.ultimaVenta },
      ]),
  )
}

// DESDE CUÁNDO VENDE cada item: la primera orden pagada que se le conoce. Es el
// nacimiento honesto para la velocidad de reposición — el libro de movimientos
// de Full retiene ~14 días y confunde un reabastecimiento con el inicio.
export async function primeraVentaPorItem() {
  const filas = await VentaMl.aggregate([
    { $unwind: '$items' },
    { $match: { 'items.itemId': { $ne: null } } },
    { $group: { _id: '$items.itemId', primera: { $min: '$fecha' } } },
  ])
  return new Map(filas.map((f) => [f._id, f.primera]))
}
