import test from 'node:test'
import assert from 'node:assert/strict'
import { envioPorUnidadDeLineas } from '../src/services/cargosMl.js'

test('envioPorUnidadDeLineas: cada cobro con las unidades de SU orden, base y órdenes caras', () => {
  const lineas = [
    ...Array.from({ length: 8 }, (_, i) => ({ tipo: 'CFF', itemId: 'A', orderId: `o${i}`, montoClp: 799.4 })),
    { tipo: 'CFF', itemId: 'A', orderId: 'o8', montoClp: 4789.4 },
    { tipo: 'CFF', itemId: 'A', orderId: 'o9', montoClp: 1598.8 }, // 2 unidades
    { tipo: 'CFF', itemId: 'A', orderId: 'o10', montoClp: 9999, anulado: true },
    { tipo: 'CFF', itemId: 'A', orderId: 'sin-orden', montoClp: 5000 },
    { tipo: 'CCV', itemId: 'A', orderId: 'o1', montoClp: 500 },
  ]
  const u = (o) => (o === 'o9' ? 2 : o === 'sin-orden' ? 0 : 1)
  const r = envioPorUnidadDeLineas(lineas, u).get('A')
  assert.equal(r.base, 799)
  assert.equal(r.unidades, 11)
  assert.equal(r.ordenes, 10)
  assert.equal(r.porUnidad, Math.round((799.4 * 8 + 4789.4 + 1598.8) / 11))
  assert.equal(r.pctOrdenesSobreBase, 10)
})

test('envioPorUnidadDeLineas: lo que pagó el comprador de envío no es costo, y se descuenta una vez por carrito', () => {
  const lineas = [
    { tipo: 'CFF', itemId: 'A', orderId: 'o1', montoClp: 4789.4 }, // comprador pagó $3.990
    { tipo: 'CFF', itemId: 'A', orderId: 'o2', montoClp: 799.4 },
    { tipo: 'CFF', itemId: 'A', orderId: 'p1a', montoClp: 6289.4 }, // carrito: el comprador pagó $5.490 en otra orden
    { tipo: 'CFF', itemId: 'A', orderId: 'p1b', montoClp: 799.4 }, // misma caja: ya no queda nada que descontar
  ]
  const comprador = (o) => ({ o1: { clave: 'orden:o1', clp: 3990 }, o2: { clave: 'orden:o2', clp: 0 }, p1a: { clave: 'pack:1', clp: 5490 }, p1b: { clave: 'pack:1', clp: 5490 } })[o]
  const r = envioPorUnidadDeLineas(lineas, () => 1, comprador).get('A')
  assert.equal(r.base, 799)
  assert.equal(r.porUnidad, 799)
  assert.equal(r.pctOrdenesSobreBase, 0)
})

import { envioDelComprador } from '../src/services/ventasMl.js'
test('envioDelComprador: suma el envío de los pagos aprobados', () => {
  assert.equal(envioDelComprador({ payments: [{ status: 'approved', shipping_cost: 3990 }] }), 3990)
  assert.equal(envioDelComprador({ payments: [{ status: 'approved', shipping_cost: 0 }, { status: 'rejected', shipping_cost: 3990 }] }), 0)
  assert.equal(envioDelComprador({ payments: [], shipping_cost: 1200 }), 1200)
  assert.equal(envioDelComprador({}), null)
})

import { envioDesdeShipment } from '../src/services/ventasMl.js'
test('envioDesdeShipment: total, comprador y vendedor (envío real del 28-sep)', () => {
  assert.deepEqual(envioDesdeShipment({ shipping_option: { cost: 5490, list_cost: 6289.4 } }), { envioTotalClp: 6289.4, envioCompradorClp: 5490, envioVendedorClp: 799.4 })
  assert.deepEqual(envioDesdeShipment({ shipping_option: { cost: 0, list_cost: 799.4 } }), { envioTotalClp: 799.4, envioCompradorClp: 0, envioVendedorClp: 799.4 })
  assert.equal(envioDesdeShipment({}), null)
})
test('envioDelComprador: si el pago no marca el envío, lo pagado de más es el envío', () => {
  assert.equal(envioDelComprador({ total_amount: 4490, paid_amount: 7669, payments: [{ status: 'approved', shipping_cost: 0 }, { status: 'approved', shipping_cost: 0 }] }), 3179)
})

import { conteosPorItem } from '../src/services/reviewsApi.js'
test('conteosPorItem: si ML niega todas las de muestra (403), para y no insiste', async () => {
  let llamadas = 0
  const contar = async () => { llamadas++; return { denegado: true, error: '403: access denied' } }
  const r = await conteosPorItem(Array.from({ length: 50 }, (_, i) => `MLC${i}`), { contar })
  assert.equal(r.size, 0)
  assert.equal(llamadas, 8)
  const r2 = await conteosPorItem(['MLC1', 'MLC2', 'MLC3'], { contar })
  assert.equal(r2.size, 0)
  assert.equal(llamadas, 8) // bloqueado: ni pregunta
})
