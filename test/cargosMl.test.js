import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizarCargo, bolsilloDe, acumular, tipoDelOriginal } from '../src/services/cargosMl.js'

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

// EL CARGO POR ENVÍO NO ERA `CXD`, ERA `CFF`.
//
// Medido el 29-ago-2026 sobre el período 2026-08 completo (300 líneas), por peso:
//   CFF   108 líneas  $152.606  ← el cargo por envío de verdad
//   PADS   20         $137.327
//   CV    113         $ 59.919
//   BPAD   14         $ 57.112  anulación de publicidad
//   CFCB   10         $ 18.417  colecta Full
//   BFF     3         $  2.398  anulación de envío
//   BV      3         $    931  anulación de venta
//   CXD     1         $    799  ← el único código que se estaba leyendo
//   CFWA   28         $    647  almacenamiento Full
//
// `envioClp` capturaba $799 de $153.405: el 0,5%. El resto caía en "otros", y
// por eso la economía por unidad seguía usando la tarifa estimada.
test('CFF y CXD son el mismo bolsillo: el envío', () => {
  assert.equal(bolsilloDe('CFF'), 'envioClp')
  assert.equal(bolsilloDe('CXD'), 'envioClp')
  assert.equal(bolsilloDe('CV'), 'comisionClp')
  assert.equal(bolsilloDe('PADS'), 'adsClp')
  assert.equal(bolsilloDe('CFCB'), 'colectaClp')
  assert.equal(bolsilloDe('CFWA'), 'almacenajeClp')
})

// Un código nuevo de ML no puede desaparecer: cae en "otros" y suma al total,
// que es como se notó que faltaba CFF.
test('un código desconocido cae en otros, pero cuenta en el total', () => {
  assert.equal(bolsilloDe('XYZ'), 'otrosClp')
  const acc = { envioClp: 0, otrosClp: 0, totalClp: 0, lineas: 0 }
  acumular(acc, 'XYZ', 1200)
  assert.equal(acc.otrosClp, 1200)
  assert.equal(acc.totalClp, 1200)
})

// Las líneas B* llegan con monto POSITIVO y anulan un cargo anterior. Sin
// tratarlas se sumaban como gasto: $60.441 en el período medido.
test('una anulación devuelve al bolsillo de su cargo, no a otros', () => {
  assert.equal(tipoDelOriginal('BFF'), 'CFF')
  assert.equal(tipoDelOriginal('BV'), 'CV')
  assert.equal(tipoDelOriginal('BPAD'), 'PADS')
  const acc = { envioClp: 0, comisionClp: 0, otrosClp: 0, totalClp: 0, lineas: 0 }
  acumular(acc, 'CFF', 2487)
  acumular(acc, tipoDelOriginal('BFF'), 799, { signo: -1 })
  assert.equal(acc.envioClp, 1688, 'el envío queda neto de lo devuelto')
  assert.equal(acc.otrosClp, 0, 'la anulación jamás va a otros')
  assert.equal(acc.totalClp, 1688)
})

test('normalizarCargo marca la anulación y a quién anula', () => {
  const anulacion = normalizarCargo({
    charge_info: {
      creation_date_time: '2026-08-14T10:00:00',
      detail_id: 68629650000,
      transaction_detail: 'Anulación del cargo por envíos de Mercado Libre',
      status: null,
      detail_amount: 799.4,
      detail_sub_type: 'BFF',
      charge_bonified_id: 68629638627,
    },
    items_info: [{ item_id: 'MLC2076838371' }],
  })
  assert.equal(anulacion.esAnulacion, true)
  assert.equal(anulacion.bonificaA, '68629638627')
  // el cargo normal no lleva la marca
  assert.equal(normalizarCargo(CARGO_VENTA).esAnulacion, false)
  assert.equal(normalizarCargo(CARGO_VENTA).bonificaA, null)
})
