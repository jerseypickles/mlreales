import test from 'node:test'
import assert from 'node:assert/strict'
import { calibracionFactor } from '../src/services/calibracion.js'

test('calibracionFactor: ventas propias vs reseñas nuevas desde la primera venta', () => {
  const propios = [
    {
      sku: 'MLC1',
      itemIdMl: null,
      mediciones: [
        { fecha: new Date('2026-07-28'), numReviews: 10 },
        { fecha: new Date('2026-07-29'), numReviews: 10 },
        { fecha: new Date('2026-07-31'), numReviews: 13 },
      ],
    },
  ]
  const ventas = [
    { fecha: new Date('2026-07-29T21:00:00Z'), items: [{ itemId: 'MLC1', cantidad: 2 }] },
    {
      fecha: new Date('2026-07-30T10:00:00Z'),
      items: [
        { itemId: 'MLC1', cantidad: 1 },
        { itemId: 'AJENO', cantidad: 5 },
      ],
    },
  ]
  const c = calibracionFactor(propios, ventas)
  assert.equal(c.ventas, 3) // las unidades del item ajeno no cuentan
  assert.equal(c.resenasNuevas, 3) // 13 − 10: base = medición vigente a la primera venta
  assert.equal(c.factorObservado, 1)
})

test('calibracionFactor: reconoce la venta por itemIdMl cuando el sku es página /up/', () => {
  const propios = [
    { sku: 'MLCU9', itemIdMl: 'MLC7', mediciones: [{ fecha: new Date('2026-07-28'), numReviews: 0 }] },
  ]
  const ventas = [{ fecha: new Date('2026-07-29'), items: [{ itemId: 'MLC7', cantidad: 1 }] }]
  const c = calibracionFactor(propios, ventas)
  assert.equal(c.ventas, 1)
  assert.equal(c.factorObservado, null) // sin reseñas nuevas todavía no hay factor
})

test('calibracionFactor: sin ventas propias devuelve null', () => {
  const c = calibracionFactor(
    [{ sku: 'MLC1', mediciones: [] }],
    [{ fecha: new Date('2026-07-29'), items: [{ itemId: 'OTRO', cantidad: 1 }] }],
  )
  assert.equal(c, null)
})
