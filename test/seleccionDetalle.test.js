import test from 'node:test'
import assert from 'node:assert/strict'
import { elegirObjetivosDetalle } from '../src/services/seleccionDetalle.js'

// listado típico: los baratos copan las primeras posiciones y los caros
// (el segmento que decide la compra) viven abajo — caso saca puntos negros
const listado = Array.from({ length: 50 }, (_, i) => ({
  sku: `S${i + 1}`,
  url: `https://ml/${i + 1}`,
  posicion: i + 1,
  precio: i < 30 ? 2000 + i * 50 : 12000 + i * 100,
}))

test('elegirObjetivosDetalle: sin exceder el cupo, devuelve todo', () => {
  const pocos = listado.slice(0, 8)
  assert.equal(elegirObjetivosDetalle(pocos, { topN: 20 }).length, 8)
})

test('elegirObjetivosDetalle: el núcleo del ranking siempre entra', () => {
  const sel = elegirObjetivosDetalle(listado, { topN: 20 })
  assert.equal(sel.length, 20)
  // 60% del cupo = 12 primeras posiciones garantizadas
  for (let p = 1; p <= 12; p++) assert.ok(sel.some((i) => i.posicion === p), `falta la posición ${p}`)
})

test('elegirObjetivosDetalle: cubre la banda cara aunque viva bajo el top', () => {
  const sel = elegirObjetivosDetalle(listado, { topN: 20 })
  const caros = sel.filter((i) => i.precio >= 12000)
  assert.ok(caros.length > 0, 'el segmento caro quedó sin medir (el bug de saca puntos negros)')
})

test('elegirObjetivosDetalle: rota — lo medido hace más tiempo entra antes', () => {
  const medidoEl = new Map(listado.map((i) => [i.sku, i.posicion >= 40 ? 1 : 9_999_999_999]))
  const sel = elegirObjetivosDetalle(listado, { topN: 20, medidoEl })
  const viejos = sel.filter((i) => i.posicion >= 40)
  assert.ok(viejos.length >= 2, 'la rotación no priorizó lo que lleva más tiempo sin medirse')
})

test('elegirObjetivosDetalle: ignora items sin URL y respeta el orden de posición', () => {
  const conHuecos = [...listado.slice(0, 5).map((i) => ({ ...i, url: null })), ...listado.slice(5)]
  const sel = elegirObjetivosDetalle(conHuecos, { topN: 15 })
  assert.ok(sel.every((i) => i.url))
  const posiciones = sel.map((i) => i.posicion)
  assert.deepEqual(posiciones, [...posiciones].sort((a, b) => a - b))
})
