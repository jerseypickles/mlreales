import test from 'node:test'
import assert from 'node:assert/strict'
import { claveRespaldo } from '../src/services/claveCompra.js'

// Antes vivía en rfq.js junto al pase de LLM que armaba la planilla de
// cotización al proveedor. Esa planilla se retiró; la clave de compra sigue,
// porque es la que une dos nichos que se surten del mismo producto de fábrica.

test('claveRespaldo: kebab-case limpio desde la keyword', () => {
  assert.equal(claveRespaldo('toallitas húmedas'), 'toallitas-humedas')
  assert.equal(claveRespaldo('vaso térmico 1.2L'), 'vaso-termico-1-2l')
  assert.equal(claveRespaldo('  silla de comer bebé  '), 'silla-de-comer-bebe')
})

test('claveRespaldo: dos keywords que solo difieren en tildes dan la misma clave', () => {
  // si difirieran, unir/separar compras dejaría de agrupar el mismo pedido
  assert.equal(claveRespaldo('Depiladora Láser'), claveRespaldo('depiladora laser'))
})
