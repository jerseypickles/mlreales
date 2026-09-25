import test from 'node:test'
import assert from 'node:assert/strict'
import { equivalenciaChilena } from '../src/services/tallasChile.js'

// la tabla real del proveedor de trajes de baño (25-sep-2026)
const PROVEEDOR = [
  { talla: 'S', bustoMin: 72, bustoMax: 80, cinturaMin: 60, cinturaMax: 66, caderaMin: 78, caderaMax: 85, copa: 'A-B' },
  { talla: 'M', bustoMin: 80, bustoMax: 88, cinturaMin: 64, cinturaMax: 70, caderaMin: 85, caderaMax: 91, copa: 'B-C' },
  { talla: 'L', bustoMin: 88, bustoMax: 95, cinturaMin: 68, cinturaMax: 74, caderaMin: 91, caderaMax: 97, copa: 'C-D' },
  { talla: 'XL', bustoMin: 95, bustoMax: 103, cinturaMin: 72, cinturaMax: 78, caderaMin: 97, caderaMax: 105, copa: 'D-E' },
]

test('tallas chilenas: la tabla del proveedor viene una talla más chica y le faltan XL y XXL', () => {
  const e = equivalenciaChilena(PROVEEDOR)
  assert.deepEqual(e.filas.map((f) => `${f.talla}→${f.letraCl}`), ['S→XXS', 'M→S', 'L→M', 'XL→L'])
  assert.equal(e.correChica, true)
  assert.deepEqual(e.faltanEnChile, ['XL (44)', 'XXL (46)'])
  assert.deepEqual(e.fueraDeDemanda, ['S'], 'su S (cadera 78-85) queda bajo lo que se vende en Chile')
})

test('tallas chilenas: una tabla que ya calza no se marca como chica', () => {
  const e = equivalenciaChilena([{ talla: 'M', bustoMin: 86, bustoMax: 90, caderaMin: 94, caderaMax: 98 }, { talla: 'XL', bustoMin: 98, bustoMax: 102, caderaMin: 106, caderaMax: 110 }])
  assert.deepEqual(e.filas.map((f) => `${f.talla}→${f.letraCl}`), ['M→M', 'XL→XL'])
  assert.equal(e.correChica, false)
})
