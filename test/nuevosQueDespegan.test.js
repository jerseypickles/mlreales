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
    // republicación de algo viejo: llega con 300 reseñas
    { sku: 'REPUB', keyword: 'k', fecha: d(10), posicion: 8, numReviewsApi: 300 }, { sku: 'REPUB', keyword: 'k', fecha: d(24), posicion: 2, numReviewsApi: 330 },
    // dos publicaciones del mismo catálogo: mismas reseñas al inicio y al final
    { sku: 'CAT1', keyword: 'k', fecha: d(10), posicion: 50, numReviewsApi: 5 }, { sku: 'CAT1', keyword: 'k', fecha: d(24), posicion: 12, numReviewsApi: 25 },
    { sku: 'CAT2', keyword: 'k', fecha: d(10), posicion: 52, numReviewsApi: 5 }, { sku: 'CAT2', keyword: 'k', fecha: d(24), posicion: 15, numReviewsApi: 25 },
    // se hunde en el ranking aunque gane reseñas
    { sku: 'HUNDE', keyword: 'k', fecha: d(10), posicion: 20, numReviewsApi: 2 }, { sku: 'HUNDE', keyword: 'k', fecha: d(24), posicion: 60, numReviewsApi: 12 },
    // solo posición, sin venta y sin sostenerse: barajado de ML
    { sku: 'BARAJA', keyword: 'k', fecha: d(10), posicion: 177, numReviewsApi: 0 }, { sku: 'BARAJA', keyword: 'k', fecha: d(24), posicion: 25, numReviewsApi: 0 },
    // solo posición pero llega al top y se sostiene: cuenta
    { sku: 'SOSTIENE', keyword: 'k', fecha: d(10), posicion: 60, numReviewsApi: 0 }, { sku: 'SOSTIENE', keyword: 'k', fecha: d(17), posicion: 12 }, { sku: 'SOSTIENE', keyword: 'k', fecha: d(24), posicion: 9, numReviewsApi: 0 },
    // salto de fuente: 100 → 900 reseñas no es venta, y sin subir de posición no despega
    { sku: 'AGRUPADO', keyword: 'k', fecha: d(10), posicion: 20, numReviewsApi: 100 }, { sku: 'AGRUPADO', keyword: 'k', fecha: d(24), posicion: 19, numReviewsApi: 900 },
  ]
  const r = nuevosQueDespegan(snaps, [{ sku: 'NUEVO', titulo: 'Producto nuevo' }], { ahora: hoy })
  assert.deepEqual(r.map((x) => x.sku).sort(), ['CAT1', 'NUEVO', 'SOSTIENE'], 'del catálogo queda uno solo; la republicación, el que se hunde y el barajado no')
  const nuevo = r.find((x) => x.sku === 'NUEVO')
  assert.equal(nuevo.subida, 34)
  assert.equal(nuevo.reseniasGanadas, 8)
})
