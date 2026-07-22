import test from 'node:test'
import assert from 'node:assert/strict'
import { resumenReviewsOficiales } from '../src/services/meli.js'
import { elegirClasica } from '../src/services/comisionesMl.js'

test('elegirClasica: prefiere gold_special; sin ella, la de menor comisión', () => {
  const clasica = { listing_type_id: 'gold_special', sale_fee_amount: 2000 }
  const premium = { listing_type_id: 'gold_pro', sale_fee_amount: 2718 }
  assert.equal(elegirClasica([premium, clasica]), clasica)
  assert.equal(elegirClasica([premium, { listing_type_id: 'free', sale_fee_amount: 1500 }]).listing_type_id, 'free')
  assert.equal(elegirClasica([]), null)
  assert.equal(elegirClasica(null), null)
})

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
