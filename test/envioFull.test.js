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

// ── LA TARIFA ES LA MISMA DESDE FULL QUE DESDE LA BODEGA (2-sep-2026) ────────
//
// Mercado Envíos cobra por peso facturable y tramo de precio, no por dónde
// sale el bulto. Para que el analista deje de adivinar "27 kg se comen el
// margen", se le pasa la curva real de la cuenta; estas cajas sintéticas son
// las que la generan.
import { dimensionesParaKgFacturables, KG_CURVA_TARIFA } from '../src/services/envioFull.js'

test('dimensionesParaKgFacturables: la caja factura exactamente los kg pedidos, por volumétrico', () => {
  for (const kg of KG_CURVA_TARIFA) {
    const caja = dimensionesParaKgFacturables(kg)
    const facturable = pesoFacturableG(caja) / 1000
    assert.ok(Math.abs(facturable - kg) < 0.1, `${kg} kg pedidos, factura ${facturable}`)
    assert.equal(caja.gramos, 1000, 'el peso real queda chico para que mande el volumétrico')
  }
})

test('dimensionesParaKgFacturables: formato que acepta la API', () => {
  assert.match(formatoDimensiones(dimensionesParaKgFacturables(15)), /^50x40x\d+,1000$/)
})
