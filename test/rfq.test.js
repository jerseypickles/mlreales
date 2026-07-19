import test from 'node:test'
import assert from 'node:assert/strict'
import { ecoKeyword, claveRespaldo } from '../src/services/rfq.js'

test('ecoKeyword: el eco del LLM con tildes/mayúsculas calza con la keyword guardada', () => {
  // el bucle de regeneración nacía exactamente de este desajuste
  assert.equal(ecoKeyword('Toallitas Húmedas '), 'toallitas humedas')
  assert.equal(ecoKeyword('toallitas humedas'), 'toallitas humedas')
  assert.equal(ecoKeyword('Depiladora Láser'), ecoKeyword('depiladora laser'))
})

test('claveRespaldo: kebab-case limpio desde la keyword', () => {
  assert.equal(claveRespaldo('toallitas húmedas'), 'toallitas-humedas')
  assert.equal(claveRespaldo('vaso térmico 1.2L'), 'vaso-termico-1-2l')
  assert.equal(claveRespaldo('  silla de comer bebé  '), 'silla-de-comer-bebe')
})
