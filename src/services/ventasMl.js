import { VentaMl } from '../models/VentaMl.js'
import { meliGet, hayCuentaMeli } from './meli.js'

// Pura. Lo que el comprador pagó de envío en esta orden (pagos aprobados).
export function envioDelComprador(orden) {
  const pagos = (orden?.payments ?? []).filter((p) => !p.status || p.status === 'approved')
  const declarado = pagos.length
    ? pagos.reduce((a, p) => a + (Number.isFinite(p.shipping_cost) ? p.shipping_cost : 0), 0)
    : Number.isFinite(orden?.shipping_cost) ? orden.shipping_cost : null
  // a veces el pago no marca el envío pero cobra de más: $7.669 por una brocha
  // de $4.490 (orden 2000018621155242), la diferencia es el envío
  const sobre = Number.isFinite(orden?.paid_amount) && Number.isFinite(orden?.total_amount) ? Math.max(0, orden.paid_amount - orden.total_amount) : null
  if (declarado == null) return sobre
  return Math.max(declarado, sobre ?? 0)
}

// Pura. Las tres partes del envío según ML: el total que cobra en la factura,
// lo que pagó el comprador y lo que queda para el vendedor.
export function envioDesdeShipment(e) {
  const op = e?.shipping_option
  if (!Number.isFinite(op?.list_cost)) return null
  const comprador = Number.isFinite(op.cost) ? op.cost : 0
  return { envioTotalClp: op.list_cost, envioCompradorClp: comprador, envioVendedorClp: Math.max(0, Math.round((op.list_cost - comprador) * 10) / 10) }
}

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
            packId: o.pack_id ? String(o.pack_id) : null,
            shipmentId: o.shipping?.id ? String(o.shipping.id) : null,
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
      // respaldo mientras no se lea el envío: lo pagado por encima del producto
      await VentaMl.updateOne({ orderId: String(o.id), envioVendedorClp: null }, { $set: { envioCompradorClp: envioDelComprador(o) } })
      if (r.upsertedCount) nuevas++
      else vistas++
    }
    if (fueraDeVentana || resultados.length < 50) { completa = true; break }
  }
  // el envío de cada orden, leído del envío: un llamado por orden, una sola
  // vez (las ya leídas no se repiten), con tope por pasada para no gastar cuota
  let enviosLeidos = 0
  try {
    const faltan = await VentaMl.find({ shipmentId: { $ne: null }, envioVendedorClp: null, fecha: { $gte: desde } }).sort({ fecha: -1 }).limit(150).select('orderId shipmentId').lean()
    for (const v of faltan) {
      const e = await meliGet(`/shipments/${v.shipmentId}`).catch(() => null)
      const partes = envioDesdeShipment(e)
      if (!partes) continue
      await VentaMl.updateOne({ orderId: v.orderId }, { $set: partes })
      enviosLeidos++
    }
  } catch (err) {
    console.warn(`[ventas] envíos no leídos: ${err.message}`)
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
  return { nuevas, vistas, completa, desde, anuladas, enviosLeidos }
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
        // el envío que pagó el comprador, repartido por lo que pesa el item en la orden
        envioCompradorClp: { $sum: { $multiply: [{ $ifNull: ['$envioCompradorClp', 0] },
          { $divide: [{ $multiply: ['$items.cantidad', '$items.precioUnitClp'] }, { $max: ['$totalClp', 1] }] }] } },
        ultimaVenta: { $max: '$fecha' },
      },
    },
  ])
  return new Map(
    filas
      .filter((f) => f._id)
      .map((f) => [
        f._id,
        { unidades: f.unidades ?? 0, ingresosClp: Math.round(f.ingresosClp ?? 0), envioCompradorClp: Math.round(f.envioCompradorClp ?? 0), ultimaVenta: f.ultimaVenta },
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
