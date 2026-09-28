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
