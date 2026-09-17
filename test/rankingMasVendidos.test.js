import test from 'node:test'
import assert from 'node:assert/strict'
import { movimientosDeRanking } from '../src/services/rankingMasVendidos.js'

test('el ranking dice quién entró y quién subió, y sin día anterior no inventa movimiento', () => {
  const antes = [{ id: 'A', posicion: 1 }, { id: 'B', posicion: 9 }, { id: 'C', posicion: 3 }]
  const hoy = [{ id: 'A', posicion: 1 }, { id: 'B', posicion: 2 }, { id: 'N', posicion: 5 }]
  const m = Object.fromEntries(movimientosDeRanking(hoy, antes).map((i) => [i.id, i]))
  assert.deepEqual([m.A.nuevo, m.A.subio], [false, 0])
  assert.deepEqual([m.B.subio, m.B.posicionAntes], [7, 9])
  assert.equal(m.N.nuevo, true)
  assert.deepEqual(movimientosDeRanking(hoy, null).map((i) => [i.nuevo, i.subio]), [[false, 0], [false, 0], [false, 0]])
})
