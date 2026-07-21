import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizarItemDetalle, indexarDetallesPorSku, extraerImagen, resumenDeReviews } from '../src/services/normalizadorDetalle.js'

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

test('extraerImagen: arma la URL del thumbnail desde la galería', () => {
  const raw = {
    gallery: {
      picture_config: { template_thumbnail: 'https://http2.mlstatic.com/D_Q_NP_{id}-R{sanitizedTitle}.webp' },
      pictures: [{ id: '899630-MLA99916451389_112025' }],
    },
  }
  assert.equal(extraerImagen(raw), 'https://http2.mlstatic.com/D_Q_NP_899630-MLA99916451389_112025-R.webp')
  assert.equal(extraerImagen({}), null)
  assert.equal(extraerImagen({ gallery: { pictures: [] } }), null)
})

// ---- formato sourabhbgp (actor actual desde 2026-07-17) ----

const fixtureSourabh = JSON.parse(
  readFileSync(new URL('./fixtures/nivel2-sourabhbgp.json', import.meta.url), 'utf8'),
)

test('normalizarItemDetalle sourabhbgp: mapea calificaciones, seller y variantes', () => {
  const det = normalizarItemDetalle(fixtureSourabh[0])
  assert.ok(det)
  assert.equal(det.numReviews, fixtureSourabh[0].ratingCount) // calificaciones, no reseñas con texto
  assert.equal(det.rating, fixtureSourabh[0].rating)
  assert.equal(det.esFull, null) // el actor no expone Full: no pisar el nivel 1
  assert.equal(det.seller.nombre, fixtureSourabh[0].sellerName)
  assert.equal(det.seller.esTiendaOficial, Boolean(fixtureSourabh[0].isOfficialStore))
  assert.ok(det.skusCandidatos.includes('MLC62124281')) // el ID pedido viene en variations
})

test('indexarDetallesPorSku sourabhbgp: matchea por ID de variante', () => {
  const { porSku, sinMatch } = indexarDetallesPorSku([fixtureSourabh[0]], ['MLC62124281'])
  assert.equal(porSku.size, 1)
  assert.equal(sinMatch, 0)
  assert.ok(porSku.get('MLC62124281'))
})

test('indexarDetallesPorSku: página /up/ con sku MLCU casa por la URL pedida (caso gua sha)', () => {
  // el actor devuelve el user-product id (MLCU…) pero el snapshot conoce el
  // item id (MLC…): el puente es el código MLCU embebido en la URL que pedimos
  const crudo = { mode: 'product', sku: 'MLCU717263875', title: 'ice roller gua sha', price: 5990, ratingCount: 120 }
  const objetivos = [
    { sku: 'MLC2678282136', url: 'https://www.mercadolibre.cl/ice-roller-gua-sha-rodillo/up/MLCU717263875' },
  ]
  const { porSku, sinMatch } = indexarDetallesPorSku([crudo], objetivos)
  assert.equal(sinMatch, 0)
  assert.ok(porSku.has('MLC2678282136'))
  assert.equal(porSku.get('MLC2678282136').numReviews, 120)
})

test('indexarDetallesPorSku: sigue aceptando lista de skus planos (compat)', () => {
  const crudo = { mode: 'product', sku: 'MLC111222333', title: 'x', price: 1000, ratingCount: 5 }
  const { porSku, sinMatch } = indexarDetallesPorSku([crudo], ['MLC111222333'])
  assert.equal(sinMatch, 0)
  assert.ok(porSku.has('MLC111222333'))
})

test('resumenDeReviews: toma el agregado del producto, jamás la nota de una reseña', () => {
  const filas = [{ reviewRating: 5, ratingCount: 87, averageRating: 4.6, reviewText: 'buena' }]
  assert.deepEqual(resumenDeReviews(filas), { numReviews: 87, rating: 4.6 })
  assert.equal(resumenDeReviews([]), null)
  assert.equal(resumenDeReviews(null), null)
  // una fila con solo la nota individual NO es un agregado
  assert.equal(resumenDeReviews([{ reviewRating: 5, reviewText: 'ok' }]), null)
})

test('normalizarItemDetalle: sin ratingCount arriba, lee el agregado anidado de includeReviews', () => {
  const raw = {
    mode: 'product',
    sku: 'MLCU717263875',
    title: 'ice roller gua sha',
    price: 5990,
    reviews: { total: 132, rating: 4.5 },
  }
  const det = normalizarItemDetalle(raw)
  assert.equal(det.numReviews, 132)
  assert.equal(det.rating, 4.5)
  // un array de reseñas sueltas no cuenta como agregado (length ≠ total)
  const rawArray = { mode: 'product', sku: 'MLCU717263875', title: 'x', reviews: [{ rating: 5 }, { rating: 4 }] }
  assert.equal(normalizarItemDetalle(rawArray).numReviews, null)
})
