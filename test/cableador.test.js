import test from 'node:test'
import assert from 'node:assert/strict'
import { nichoQueCalza } from '../src/services/cableador.js'

const nichos = [
  { _id: 1, keyword: 'panel solar' },
  { _id: 2, keyword: 'carpa camping 4 personas' },
  { _id: 3, keyword: 'gua sha' },
]

test('nichoQueCalza: exacto gana', () => {
  assert.equal(nichoQueCalza(nichos, 'gua sha')._id, 3)
})

test('nichoQueCalza: contención de raíces en ambas direcciones', () => {
  // derivada más específica que el nicho
  assert.equal(nichoQueCalza(nichos, 'panel solar 100w')._id, 1)
  // derivada más genérica que el nicho
  assert.equal(nichoQueCalza(nichos, 'carpa camping')._id, 2)
  // singular/plural empatan por raíz
  assert.equal(nichoQueCalza(nichos, 'paneles solares')._id, 1)
})

test('nichoQueCalza: sin calce devuelve null', () => {
  assert.equal(nichoQueCalza(nichos, 'ampolleta recargable'), null)
  assert.equal(nichoQueCalza(nichos, 'rodillo facial'), null)
  assert.equal(nichoQueCalza([], 'panel solar'), null)
})
