import test from 'node:test'
import assert from 'node:assert/strict'
import { resumenReviewsOficiales } from '../src/services/meli.js'

test('resumenReviewsOficiales: paging.total es el conteo, rating solo si viene', () => {
  const respuesta = { paging: { total: 49, limit: 5 }, rating_average: 4.7, reviews: [] }
  assert.deepEqual(resumenReviewsOficiales(respuesta), { numReviews: 49, rating: 4.7 })
  // 0 reseñas es una medición válida (item existe, nadie ha opinado)
  assert.deepEqual(resumenReviewsOficiales({ paging: { total: 0 } }), { numReviews: 0, rating: null })
  assert.equal(resumenReviewsOficiales({}), null)
  assert.equal(resumenReviewsOficiales(null), null)
  // la nota de UNA reseña jamás sirve de agregado
  assert.equal(resumenReviewsOficiales({ reviews: [{ rate: 5 }] }), null)
})
