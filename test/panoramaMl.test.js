import test from 'node:test'
import assert from 'node:assert/strict'
import { aCategoria, terminosNuevos } from '../src/services/panoramaMl.js'

test('panorama: una categoría leída guarda ruta, padre, si es hoja y su volumen', () => {
  const c = aCategoria({ name: 'Utensilios', total_items_in_this_category: 12000, children_categories: [],
    path_from_root: [{ id: 'MLC1', name: 'Hogar' }, { id: 'MLC2', name: 'Cocina' }, { id: 'MLC3', name: 'Utensilios' }] })
  assert.equal(c.ruta, 'Hogar > Cocina > Utensilios')
  assert.equal(c.padreId, 'MLC2')
  assert.equal(c.hoja, true)
  assert.equal(c.totalItems, 12000)
  assert.equal(aCategoria({ name: 'Hogar', children_categories: [{ id: 'MLC2', name: 'Cocina' }], path_from_root: [{ id: 'MLC1', name: 'Hogar' }] }).hoja, false)
})

test('panorama: búsquedas nuevas = las que no estaban en la captura anterior', () => {
  assert.deepEqual(terminosNuevos(['a', 'b', 'c'], ['b', 'x']), ['a', 'c'])
  assert.deepEqual(terminosNuevos(['a'], undefined), ['a'])
})
