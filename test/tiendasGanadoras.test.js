import test from 'node:test'
import assert from 'node:assert/strict'
import { publicacionesNuevas, urlTienda, secuenciaId, lanzamientosReales, repartirPorTienda } from '../src/services/tiendasGanadoras.js'

const lectura = (sellerId, dia, ids) => ({
  sellerId, vendedor: `tienda ${sellerId}`, dia, capturadoEl: new Date(`${dia}T12:00:00Z`),
  items: ids.map((itemId) => ({ itemId, titulo: `t ${itemId}` })),
})
const ids = (xs) => xs.map((x) => x.itemId)

test('tiendas ganadoras: lo nuevo es lo que no estaba en la lectura anterior', () => {
  assert.deepEqual(publicacionesNuevas([{ itemId: 'A' }, { itemId: 'B' }, { itemId: null }], [{ itemId: 'A' }]).map((i) => i.itemId), ['B'])
  assert.equal(urlTienda('123'), 'https://listado.mercadolibre.cl/_CustId_123')
})

test('tiendas ganadoras: la secuencia del número es largo y primer dígito', () => {
  assert.deepEqual(secuenciaId('MLC2380486423'), { secuencia: '10:2', n: 2380486423 })
  assert.deepEqual(secuenciaId('MLC912345678'), { secuencia: '9:9', n: 912345678 })
  assert.equal(secuenciaId('MLCU123'), null)
  assert.equal(secuenciaId(null), null)
})

test('tiendas ganadoras: lo que vuelve a la primera página no es lanzamiento', () => {
  const l = lanzamientosReales([
    lectura('1', '2026-10-01', ['MLC2000000001']),
    lectura('1', '2026-10-08', ['MLC2000000002']),
    lectura('1', '2026-10-15', ['MLC2000000001', 'MLC2000000003']),
  ])
  assert.deepEqual(ids(l), ['MLC2000000003'])
  assert.equal(l[0].sellerId, '1')
  assert.equal(l[0].desde, '2026-10-08')
  assert.equal(l[0].hasta, '2026-10-15')
})

test('tiendas ganadoras: un número menor que otro ya visto de su secuencia ya existía', () => {
  const l = lanzamientosReales([
    // otra tienda mostró una publicación más nueva antes de la lectura previa
    lectura('2', '2026-09-28', ['MLC2000000900']),
    lectura('1', '2026-10-01', ['MLC2000000500']),
    lectura('1', '2026-10-08', ['MLC2000000500', 'MLC2000000100', 'MLC2000000800', 'MLC2000000950']),
  ])
  assert.deepEqual(ids(l), ['MLC2000000950'])
})

test('tiendas ganadoras: el techo solo usa lo visto hasta la lectura previa', () => {
  const l = lanzamientosReales([
    lectura('1', '2026-10-01', ['MLC2000000500']),
    lectura('2', '2026-10-05', ['MLC2000000900']), // después de la previa de la tienda 1: no cuenta
    lectura('1', '2026-10-08', ['MLC2000000500', 'MLC2000000800']),
  ])
  assert.deepEqual(ids(l), ['MLC2000000800']) // y la tienda 2, con una sola lectura, no aporta
})

test('tiendas ganadoras: cada secuencia se compara solo consigo misma', () => {
  const l = lanzamientosReales([
    lectura('1', '2026-10-01', ['MLC4600000000', 'MLC2000000500']),
    lectura('1', '2026-10-08', ['MLC2000000600', 'MLC4500000000', 'MLC3000000001']),
  ])
  // 2…600 supera a 2…500; 4…500 es menor que 4…600; la secuencia 3 nunca se vio: pasa
  assert.deepEqual(ids(l), ['MLC2000000600', 'MLC3000000001'])
})

test('tiendas ganadoras: lo más reciente primero y sin lecturas sueltas', () => {
  const l = lanzamientosReales([
    lectura('1', '2026-10-01', ['MLC2000000001']),
    lectura('1', '2026-10-08', ['MLC2000000010']),
    lectura('2', '2026-10-03', ['MLC2000000002']),
    lectura('2', '2026-10-15', ['MLC2000000020', null]),
    lectura('3', '2026-10-15', ['MLC2000000030']),
    { sellerId: '4', dia: '2026-10-15', items: [{ itemId: 'MLC2000000040' }] }, // sin fecha de captura
  ])
  assert.deepEqual(ids(l), ['MLC2000000020', 'MLC2000000010'])
  assert.deepEqual(lanzamientosReales(null), [])
})

test('tiendas ganadoras: el radar recibe pocas por tienda, en orden', () => {
  const l = [
    ...['a1', 'a2', 'a3', 'a4', 'a5'].map((itemId) => ({ itemId, sellerId: 'A' })),
    { itemId: 'b1', sellerId: 'B' },
    { itemId: 'c1', sellerId: 'C' },
    { itemId: 'c2', sellerId: 'C' },
  ]
  assert.deepEqual(ids(repartirPorTienda(l)), ['a1', 'a2', 'a3', 'b1', 'c1', 'c2'])
  assert.deepEqual(ids(repartirPorTienda(l, { porTienda: 1, max: 2 })), ['a1', 'b1'])
  assert.deepEqual(repartirPorTienda(null), [])
})
