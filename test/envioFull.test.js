import test from 'node:test'
import assert from 'node:assert/strict'
import { pesoFacturableG, formatoDimensiones, dimensionesDeItem } from '../src/services/envioFull.js'

// Referencias medidas en vivo contra la cuenta el 10-ago-2026: ML devolvió
// billable_weight 750 para "20x15x10,500" y 150 para "10x10x5,150".

test('peso facturable: manda el volumétrico cuando la caja es grande y liviana', () => {
  // 20×15×10 = 3.000 cm³ / 4000 = 0,75 kg > 500 g reales
  assert.equal(pesoFacturableG({ largoCm: 20, anchoCm: 15, altoCm: 10, gramos: 500 }), 750)
})

test('peso facturable: manda el real cuando la caja es chica y pesada', () => {
  // 10×10×5 = 500 cm³ / 4000 = 125 g < 150 g reales
  assert.equal(pesoFacturableG({ largoCm: 10, anchoCm: 10, altoCm: 5, gramos: 150 }), 150)
})

test('peso facturable: un bulto grande factura por volumen, no por lo que pesa', () => {
  // el error que ya mordió dos veces: 0,003 m³ supuestos contra un bulto real
  assert.equal(pesoFacturableG({ largoCm: 60, anchoCm: 50, altoCm: 40, gramos: 3000 }), 30_000)
})

test('formato de dimensiones: el que espera la API de ML', () => {
  assert.equal(formatoDimensiones({ largoCm: 20, anchoCm: 10, altoCm: 5, gramos: 300 }), '20x10x5,300')
})

test('dimensiones del item: se leen las que declara ML', () => {
  assert.deepEqual(dimensionesDeItem({ shipping: { dimensions: '30x20x10,500' } }), {
    largoCm: 30,
    anchoCm: 20,
    altoCm: 10,
    gramos: 500,
  })
})

test('dimensiones del item: los de Full suelen venir sin declarar', () => {
  // caso real de MLC2076838371: logistic_type fulfillment y dimensions null
  assert.equal(dimensionesDeItem({ shipping: { dimensions: null } }), null)
  assert.equal(dimensionesDeItem({ shipping: {} }), null)
  assert.equal(dimensionesDeItem(null), null)
  assert.equal(dimensionesDeItem({ shipping: { dimensions: 'raro' } }), null)
})
