import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizarCargo } from '../src/services/cargosMl.js'

// Líneas REALES del detalle de facturación de la cuenta, sondeadas el
// 10-ago-2026 (período 2026-08-01). Son la referencia del mapeo.

const CARGO_VENTA = {
  charge_info: {
    creation_date_time: '2026-07-29T22:14:43',
    detail_id: 68065038823,
    transaction_detail: 'Cargo por venta',
    debited_from_operation: 'YES',
    status: null,
    detail_amount: 305,
    detail_type: 'CHARGE',
    detail_sub_type: 'CV',
  },
  discount_info: { charge_amount_without_discount: 305, discount_amount: 0 },
  sales_info: [{ order_id: 2000017659214054, transaction_amount: 1795, sale_date_time: '2026-07-29T21:13:37' }],
  items_info: [
    {
      item_id: 'MLC2076838371',
      item_title: 'Brochas Maquillaje Profesionales Set 9 Piezas + Estuche Blanco',
      item_category: 'Belleza y Cuidado Personal > Maquillaje > Aplicadores y Herramientas > Brochas para Maquillaje',
      item_price: 1795,
    },
  ],
  document_info: { document_id: 5072407904 },
  marketplace_info: { marketplace: 'CORE' },
}

const CARGO_ENVIO = {
  charge_info: {
    creation_date_time: '2026-07-29T22:14:43',
    detail_id: 68065038844,
    transaction_detail: 'Cargo por envíos de Mercado Libre',
    debited_from_operation: 'YES',
    status: null,
    detail_amount: 799.4,
    detail_sub_type: 'CXD',
  },
  discount_info: { charge_amount_without_discount: 1142, discount_amount: 342.6, discount_reason: 'Descuento general' },
  sales_info: [{ order_id: 2000017659214054, transaction_amount: 1795 }],
  items_info: [{ item_id: 'MLC2076838371', item_title: 'Brochas Maquillaje…' }],
  document_info: { document_id: 5072407904 },
  marketplace_info: { marketplace: 'SHIPPING' },
}

const CARGO_ADS_ANULADO = {
  charge_info: {
    creation_date_time: '2026-07-31T06:08:22',
    detail_id: 68142596338,
    transaction_detail: 'Cargo por campaña de publicidad de Product Ads',
    debited_from_operation: 'NO',
    status: 'BONUS_ON_BILL',
    status_description: 'Anulado en factura',
    detail_amount: 54,
    detail_sub_type: 'PADS',
  },
  discount_info: { charge_amount_without_discount: 54, discount_amount: 0 },
  sales_info: null,
  items_info: null,
  document_info: { document_id: 5072407904 },
  marketplace_info: { marketplace: 'MCLICS' },
}

test('cargo por venta: se cablea al item y trae el precio de la venta', () => {
  const c = normalizarCargo(CARGO_VENTA)
  assert.equal(c.tipo, 'CV')
  assert.equal(c.montoClp, 305)
  assert.equal(c.itemId, 'MLC2076838371')
  assert.equal(c.orderId, '2000017659214054')
  assert.equal(c.precioVentaClp, 1795)
  assert.equal(c.anulado, false)
  assert.equal(c.descontadoDeLaVenta, true)
})

test('cargo por envío: el que faltaba modelar, con su descuento', () => {
  // en esta venta de $1.795 el envío ($799) pesa más del doble que la comisión
  // ($305) — el simulador lo daba por un fijo de $1.200 de tarifa Full
  const c = normalizarCargo(CARGO_ENVIO)
  assert.equal(c.tipo, 'CXD')
  assert.equal(c.montoClp, 799.4)
  assert.equal(c.montoSinDescuentoClp, 1142)
  assert.equal(c.descuentoClp, 342.6)
  assert.equal(c.itemId, 'MLC2076838371')
})

test('cargo anulado en factura: se guarda pero no es costo', () => {
  const c = normalizarCargo(CARGO_ADS_ANULADO)
  assert.equal(c.anulado, true, 'ML lo cobró y lo devolvió en la misma factura')
  assert.equal(c.itemId, null, 'Product Ads no cuelga de una venta')
  assert.equal(c.orderId, null)
  assert.equal(c.descontadoDeLaVenta, false)
})

test('una línea sin id de detalle no se guarda', () => {
  assert.equal(normalizarCargo(null), null)
  assert.equal(normalizarCargo({}), null)
  assert.equal(normalizarCargo({ charge_info: {} }), null)
})

test('el detalleId viaja como string: son enteros que no caben cómodos en JS', () => {
  const c = normalizarCargo(CARGO_VENTA)
  assert.equal(typeof c.detalleId, 'string')
  assert.equal(typeof c.orderId, 'string')
  assert.equal(c.detalleId, '68065038823')
})
