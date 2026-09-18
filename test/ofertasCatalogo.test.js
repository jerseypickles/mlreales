import test from 'node:test'
import assert from 'node:assert/strict'
import { ofertasDe, urlDeItem, catalogoDeUrl, itemDeUrl, esFullPorLogistica } from '../src/services/ofertasCatalogo.js'

// Respuesta real de /products/MLC27221799/items (18-sep-2026), recortada.
const RESPUESTA = { paging: { total: 14 }, results: [
  { item_id: 'MLC1528547979', seller_id: 320677771, price: 6987, official_store_id: null, shipping: { logistic_type: 'cross_docking' } },
  { item_id: 'MLC3545535420', seller_id: 2712571304, price: 6640, official_store_id: null, shipping: { logistic_type: 'xd_drop_off' } },
  { item_id: 'MLC9999999999', seller_id: 1, price: 9990, official_store_id: 97, shipping: { logistic_type: 'fulfillment' } },
  { item_id: null, seller_id: 2, price: 1 },
] }

test('la API oficial dice de quién es cada oferta, y si es Full de verdad', () => {
  const o = ofertasDe(RESPUESTA)
  assert.equal(o.length, 3) // la oferta sin item_id se descarta
  assert.deepEqual(o.map((x) => x.itemId), ['MLC3545535420', 'MLC1528547979', 'MLC9999999999']) // por precio
  assert.deepEqual(o[0], {
    itemId: 'MLC3545535420', sellerId: '2712571304', precio: 6640, logisticType: 'xd_drop_off', esFull: false,
    esTiendaOficial: false, url: 'https://articulo.mercadolibre.cl/MLC-3545535420-_JM',
  })
  // Full es la logística oficial, no un badge leído de la página
  assert.equal(o[2].esFull, true)
  assert.equal(o[2].esTiendaOficial, true)
  assert.equal(esFullPorLogistica(null), null)
  assert.deepEqual(ofertasDe(null), [])
})

test('leer la publicación PROPIA del vendedor, no la del catálogo', () => {
  // probado contra ML: esta URL devuelve el stock de ESE vendedor ("+5"),
  // mientras que otra oferta del mismo catálogo devuelve "+50"
  assert.equal(urlDeItem('MLC3545535420'), 'https://articulo.mercadolibre.cl/MLC-3545535420-_JM')
  assert.equal(catalogoDeUrl('https://www.mercadolibre.cl/silla-plegable/p/MLC27221799'), 'MLC27221799')
  assert.equal(catalogoDeUrl('https://articulo.mercadolibre.cl/MLC-4212659314-set-8'), null)
  assert.equal(itemDeUrl('https://articulo.mercadolibre.cl/MLC-4212659314-set-8-brochas'), 'MLC4212659314')
  assert.equal(itemDeUrl('https://www.mercadolibre.cl/x/p/MLC27221799'), 'MLC27221799')
})
