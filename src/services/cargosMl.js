import { meliGet, hayCuentaMeli } from './meli.js'
import { CargoMl } from '../models/CargoMl.js'

// LO QUE ML COBRA DE VERDAD, cableado al producto y al nicho.
//
// El detalle de facturación entrega una línea por cargo con item_id, order_id y
// monto real. Con eso el margen deja de estimarse: hasta ahora la comisión
// salía del tarifario y el Full de un fijo de $1.200, y el CARGO POR ENVÍO —que
// en ticket bajo es el que se come el margen— no se modelaba en ninguna parte.
//
// Sondeado el 10-ago-2026 sobre la cuenta real (período 2026-08-01, 140 líneas):
//   CV   "Cargo por venta"                    $305,0  item MLC2076838371
//   CXD  "Cargo por envíos de Mercado Libre"  $799,4  (sin descuento $1.142)
//   PADS "Cargo por campaña de Product Ads"   $ 54,0  sin item asociado
//
// OJO CON EL RATE LIMIT: 5 requests por minuto. Nada de esto puede colgarse de
// una carga de página; se sincroniza una vez al día y se lee de la base.
const PAUSA_MS = 13_000 // 5 req/min con holgura
const POR_PAGINA = 100

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const numero = (v) => (Number.isFinite(v) ? v : null)

// Aplana una línea del detalle al documento que guardamos.
export function normalizarCargo(fila) {
  const c = fila?.charge_info
  if (!c?.detail_id) return null
  const venta = fila.sales_info?.[0] ?? null
  const item = fila.items_info?.[0] ?? null
  return {
    detalleId: String(c.detail_id),
    documentoId: fila.document_info?.document_id != null ? String(fila.document_info.document_id) : null,
    fecha: c.creation_date_time ? new Date(c.creation_date_time) : null,
    tipo: c.detail_sub_type ?? null,
    concepto: c.transaction_detail ?? null,
    montoClp: numero(c.detail_amount),
    montoSinDescuentoClp: numero(fila.discount_info?.charge_amount_without_discount),
    descuentoClp: numero(fila.discount_info?.discount_amount),
    estado: c.status ?? null,
    // "Anulado en factura": ML lo cobró y lo devolvió, no es costo
    anulado: c.status === 'BONUS_ON_BILL',
    descontadoDeLaVenta: c.debited_from_operation ? c.debited_from_operation === 'YES' : null,
    itemId: item?.item_id ?? null,
    tituloItem: item?.item_title ?? null,
    orderId: venta?.order_id != null ? String(venta.order_id) : null,
    precioVentaClp: numero(venta?.transaction_amount),
    categoriaMl: item?.item_category ?? null,
    marketplace: fila.marketplace_info?.marketplace ?? null,
  }
}

// Períodos de facturación disponibles (el abierto y los cerrados recientes).
export async function periodosFacturacion() {
  const r = await meliGet('/billing/integration/monthly/periods?group=ML&document_type=BILL')
  return (r?.results ?? []).map((p) => ({
    key: p.key,
    estado: p.period_status,
    desde: p.period?.date_from ?? null,
    hasta: p.period?.date_to ?? null,
    montoClp: numero(p.amount),
    impagoClp: numero(p.unpaid_amount),
  }))
}

// Trae y guarda el detalle de un período. Idempotente: upsert por detalleId, así
// que re-sincronizar un período abierto actualiza montos sin duplicar líneas.
export async function sincronizarPeriodo(key, { max = 600 } = {}) {
  let offset = 0
  let guardados = 0
  let total = null
  while (offset < max) {
    if (offset > 0) await esperar(PAUSA_MS)
    const r = await meliGet(
      `/billing/integration/periods/key/${key}/group/ML/details?document_type=BILL&limit=${POR_PAGINA}&offset=${offset}`,
    )
    total = r?.total ?? total
    const filas = r?.results ?? []
    if (!filas.length) break

    const ops = filas
      .map(normalizarCargo)
      .filter(Boolean)
      .map((c) => ({
        updateOne: {
          filter: { detalleId: c.detalleId },
          update: { $set: { ...c, periodo: key }, $setOnInsert: { guardadoEl: new Date() } },
          upsert: true,
        },
      }))
    if (ops.length) await CargoMl.bulkWrite(ops, { ordered: false })
    guardados += ops.length

    offset += filas.length
    if (total != null && offset >= total) break
    if (filas.length < POR_PAGINA) break
  }
  return { periodo: key, guardados, total }
}

// Pasada completa: el período abierto siempre (sus montos se mueven) y los
// cerrados que todavía no se hayan traído.
export async function sincronizarCargosMl({ periodosMax = 2 } = {}) {
  if (!(await hayCuentaMeli())) return { omitido: true, motivo: 'sin cuenta ML conectada' }
  const periodos = await periodosFacturacion()
  if (!periodos.length) return { omitido: true, motivo: 'sin períodos de facturación' }

  const resultados = []
  for (const [i, p] of periodos.slice(0, periodosMax).entries()) {
    if (i > 0) await esperar(PAUSA_MS)
    try {
      resultados.push({ ...(await sincronizarPeriodo(p.key)), estado: p.estado })
    } catch (err) {
      console.warn(`[cargos-ml] período ${p.key} falló: ${err.message}`)
      resultados.push({ periodo: p.key, error: err.message })
    }
  }
  const guardados = resultados.reduce((s, r) => s + (r.guardados ?? 0), 0)
  console.log(`[cargos-ml] ${guardados} línea(s) de cargo sincronizadas: ${JSON.stringify(resultados)}`)
  return { periodos: resultados, guardados }
}

// Cargos reales por item en una ventana. Los anulados no cuentan: ML los cobró
// y los devolvió en la misma factura.
export async function cargosPorItem({ dias = 30 } = {}) {
  const desde = new Date(Date.now() - dias * 86400e3)
  const filas = await CargoMl.aggregate([
    { $match: { fecha: { $gte: desde }, anulado: false, itemId: { $ne: null } } },
    {
      $group: {
        _id: { itemId: '$itemId', tipo: '$tipo' },
        monto: { $sum: '$montoClp' },
        lineas: { $sum: 1 },
      },
    },
  ])

  const porItem = new Map()
  for (const f of filas) {
    const acc = porItem.get(f._id.itemId) ?? { comisionClp: 0, envioClp: 0, adsClp: 0, otrosClp: 0, totalClp: 0, lineas: 0 }
    const monto = Math.round(f.monto)
    if (f._id.tipo === 'CV') acc.comisionClp += monto
    else if (f._id.tipo === 'CXD') acc.envioClp += monto
    else if (f._id.tipo === 'PADS') acc.adsClp += monto
    else acc.otrosClp += monto
    acc.totalClp += monto
    acc.lineas += f.lineas
    porItem.set(f._id.itemId, acc)
  }
  return porItem
}

// Cargos que NO cuelgan de una venta (Product Ads, cargos de cuenta): no se
// pueden imputar a un producto y hay que mirarlos aparte para no perderlos.
export async function cargosSinItem({ dias = 30 } = {}) {
  const desde = new Date(Date.now() - dias * 86400e3)
  const filas = await CargoMl.aggregate([
    { $match: { fecha: { $gte: desde }, anulado: false, itemId: null } },
    { $group: { _id: '$concepto', monto: { $sum: '$montoClp' }, lineas: { $sum: 1 } } },
    { $sort: { monto: -1 } },
  ])
  return filas.map((f) => ({ concepto: f._id, montoClp: Math.round(f.monto), lineas: f.lineas }))
}
