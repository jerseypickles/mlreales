import test from 'node:test'
import assert from 'node:assert/strict'
import { exwConTransporte } from '../src/services/tablero.js'

test('el EXW que se paga es el de fábrica más el recargo de transporte; sin recargo queda igual', () => {
  assert.equal(exwConTransporte(17, 15), 19.55)
  assert.equal(exwConTransporte(1.72, 15), 1.98)
  assert.equal(exwConTransporte(8.3, null), 8.3)
  assert.equal(exwConTransporte(8.3, 0), 8.3)
  assert.equal(exwConTransporte(null, 15), null)
})
