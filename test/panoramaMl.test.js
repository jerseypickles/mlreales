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

test('panorama: las grandes a diario, las chicas cada 3 días', async () => {
  const { hojasQueTocan, DIARIAS } = await import('../src/services/panoramaMl.js')
  const hojas = Array.from({ length: DIARIAS + 3 }, (_, i) => ({ id: `C${i}` }))
  const ultima = new Map([['C0', '2026-09-27'], ['C1', '2026-09-26'], [`C${DIARIAS}`, '2026-09-26'], [`C${DIARIAS + 1}`, '2026-09-24']])
  const tocan = new Set(hojasQueTocan(hojas, ultima, '2026-09-27').map((h) => h.id))
  assert.equal(tocan.has('C0'), false, 'ya leída hoy')
  assert.equal(tocan.has('C1'), true, 'grande: todos los días')
  assert.equal(tocan.has(`C${DIARIAS}`), false, 'chica leída ayer: espera')
  assert.equal(tocan.has(`C${DIARIAS + 1}`), true, 'chica leída hace 3 días: toca')
  assert.equal(tocan.has(`C${DIARIAS + 2}`), true, 'chica nunca leída: toca')
})
