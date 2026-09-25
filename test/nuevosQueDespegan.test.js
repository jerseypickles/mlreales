import test from 'node:test'
import assert from 'node:assert/strict'
import { nuevosQueDespegan } from '../src/services/nuevosQueDespegan.js'

const d = (n) => new Date(Date.UTC(2026, 8, n, 15))
const hoy = d(25)

test('nuevos que despegan: aparece en un nicho viejo, sube y gana reseñas; el nicho nuevo no cuenta', () => {
  const snaps = [
    // nicho "k" se escanea desde el 1-sep
    { sku: 'VIEJO', keyword: 'k', fecha: d(1), posicion: 1, numReviewsApi: 500 }, { sku: 'VIEJO', keyword: 'k', fecha: d(20), posicion: 1, numReviewsApi: 520 },
    // aparece el 10-sep en #40 y el 24 está #6 con 8 reseñas más
    { sku: 'NUEVO', keyword: 'k', fecha: d(10), posicion: 40, numReviewsApi: 0 }, { sku: 'NUEVO', keyword: 'k', fecha: d(24), posicion: 6, numReviewsApi: 8 },
    // aparece nuevo pero no se mueve
    { sku: 'QUIETO', keyword: 'k', fecha: d(10), posicion: 45, numReviewsApi: 0 }, { sku: 'QUIETO', keyword: 'k', fecha: d(24), posicion: 44, numReviewsApi: 0 },
    // anuncio puro: su posición es comprada
    { sku: 'PAGADO', keyword: 'k', fecha: d(10), posicion: 30, esAnuncio: true }, { sku: 'PAGADO', keyword: 'k', fecha: d(24), posicion: 2, esAnuncio: true },
    // nicho "z" empezó el 20-sep: todo parece nuevo y no cuenta
    { sku: 'Z1', keyword: 'z', fecha: d(20), posicion: 30, numReviewsApi: 0 }, { sku: 'Z1', keyword: 'z', fecha: d(24), posicion: 5, numReviewsApi: 9 },
    // salto de fuente: 100 → 900 reseñas no es venta, y sin subir de posición no despega
    { sku: 'AGRUPADO', keyword: 'k', fecha: d(10), posicion: 20, numReviewsApi: 100 }, { sku: 'AGRUPADO', keyword: 'k', fecha: d(24), posicion: 19, numReviewsApi: 900 },
  ]
  const r = nuevosQueDespegan(snaps, [{ sku: 'NUEVO', titulo: 'Producto nuevo' }], { ahora: hoy })
  assert.deepEqual(r.map((x) => x.sku), ['NUEVO'])
  assert.equal(r[0].subida, 34)
  assert.equal(r[0].reseniasGanadas, 8)
})
