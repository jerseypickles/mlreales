import test from 'node:test'
import assert from 'node:assert/strict'
import { publicacionesNuevas, urlTienda } from '../src/services/tiendasGanadoras.js'

test('tiendas ganadoras: lo nuevo es lo que no estaba en la lectura anterior', () => {
  assert.deepEqual(publicacionesNuevas([{ itemId: 'A' }, { itemId: 'B' }, { itemId: null }], [{ itemId: 'A' }]).map((i) => i.itemId), ['B'])
  assert.equal(urlTienda('123'), 'https://listado.mercadolibre.cl/_CustId_123')
})
