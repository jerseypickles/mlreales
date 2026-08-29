import test from 'node:test'
import assert from 'node:assert/strict'
import { aplicarConteos } from '../src/services/reviewsApi.js'

// El conteo de la API oficial se guarda AL LADO del que ya existe, nunca encima:
// no miden lo mismo. La API cuenta las reseñas de la publicación y la ficha
// muestra a veces el agregado del catálogo — medido, razones de 1,000 a 0,297.

const item = (itemId, numReviews = null) => ({
  producto: { sku: 'MLC1', itemId },
  snapshot: { sku: 'MLC1', numReviews },
})

test('el conteo de la API no pisa al del nivel 2', () => {
  const items = [item('MLC999', 1549)]
  aplicarConteos(items, new Map([['MLC999', 1529]]))
  assert.equal(items[0].snapshot.numReviews, 1549, 'el de la ficha queda intacto')
  assert.equal(items[0].snapshot.numReviewsApi, 1529)
})

test('un item sin id de publicación se salta sin romper', () => {
  const items = [item(null), item('MLC1', 10)]
  assert.equal(aplicarConteos(items, new Map([['MLC1', 10]])), 1)
  assert.equal(items[0].snapshot.numReviewsApi, undefined)
})

// La API no responde por todos en todas las corridas; ausencia es ausencia, no
// cero: un cero se leería como "no tiene reseñas" y hundiría la señal.
test('si la API no contestó, el campo no se escribe', () => {
  const items = [item('MLC777')]
  assert.equal(aplicarConteos(items, new Map()), 0)
  assert.equal(items[0].snapshot.numReviewsApi, undefined)
})

test('sin items o sin mapa no explota', () => {
  assert.equal(aplicarConteos(undefined, new Map()), 0)
  assert.equal(aplicarConteos([], new Map()), 0)
})
