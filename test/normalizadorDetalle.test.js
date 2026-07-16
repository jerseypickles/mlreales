import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizarItemDetalle, indexarDetallesPorSku } from '../src/services/normalizadorDetalle.js'

// output real del actor ecomscrape capturado el 2026-07-16
const fixture = JSON.parse(readFileSync(new URL('./fixtures/nivel2.json', import.meta.url), 'utf8'))

test('normalizarItemDetalle: producto de catálogo con tienda oficial y Full', () => {
  const det = normalizarItemDetalle(fixture[0]) // EOLAND
  assert.ok(det.skusCandidatos.includes('MLC45499727'))
  assert.equal(det.precio, 15990)
  assert.equal(det.precioAnterior, 25990)
  assert.equal(det.numReviews, 921)
  assert.equal(det.rating, 4.6)
  assert.equal(det.esFull, true) // logistic_type: fulfillment
  assert.equal(det.origenCrossBorder, false) // item_origins CLRM03
  assert.equal(det.seller.sellerId, '413173645')
  assert.equal(det.seller.nombre, 'EOLAND')
  assert.equal(det.seller.reputacion, '5_green')
  assert.equal(det.seller.powerSeller, 'platinum')
  assert.equal(det.seller.esTiendaOficial, true)
})

test('normalizarItemDetalle: listing /up/ despachado desde China', () => {
  const det = normalizarItemDetalle(fixture[2]) // Tienda Shunxiang
  assert.ok(det.skusCandidatos.includes('MLCU3706237055'))
  assert.equal(det.origenCrossBorder, true) // item_origins CNGD01 (Guangdong)
  assert.equal(det.seller.esTiendaOficial, false) // official_store_id null
  assert.equal(det.seller.powerSeller, 'silver')
})

test('indexarDetallesPorSku: matchea los 3 items por sus IDs candidatos', () => {
  const skus = ['MLC45499727', 'MLC69288644', 'MLCU3706237055']
  const { porSku, sinMatch } = indexarDetallesPorSku(fixture, skus)
  assert.equal(porSku.size, 3)
  assert.equal(sinMatch, 0)
  assert.equal(porSku.get('MLC69288644').numReviews, 9)
})

test('indexarDetallesPorSku: items no pedidos cuentan como sin match', () => {
  const { porSku, sinMatch } = indexarDetallesPorSku(fixture, ['MLC45499727'])
  assert.equal(porSku.size, 1)
  assert.equal(sinMatch, 2)
})

test('normalizarItemDetalle: entrada inválida devuelve null', () => {
  assert.equal(normalizarItemDetalle(null), null)
  assert.equal(normalizarItemDetalle({ title: 'sin ids' }), null)
})
