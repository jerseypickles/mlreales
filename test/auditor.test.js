import test from 'node:test'
import assert from 'node:assert/strict'
import { elegirGanadores } from '../src/services/auditor.js'

const p = (sku, numReviews, ventasDia = null, extra = {}) => ({
  sku,
  titulo: `producto ${sku}`,
  url: `https://articulo.mercadolibre.cl/${sku}`,
  numReviews,
  ventasDia,
  ...extra,
})

test('elegirGanadores: top por reseñas acumuladas + el que más vende ahora', () => {
  const productos = [p('A', 900), p('B', 500), p('C', 300), p('D', 50, 12), p('E', 10)]
  const elegidos = elegirGanadores(productos)
  assert.deepEqual(
    elegidos.map((x) => x.sku),
    ['A', 'B', 'C', 'D'], // D entra por velocidad aunque tenga pocas reseñas
  )
})

test('elegirGanadores: sin velocidad medida, completa con el 4to por reseñas', () => {
  const productos = [p('A', 900), p('B', 500), p('C', 300), p('D', 100), p('E', 10)]
  assert.deepEqual(
    elegirGanadores(productos).map((x) => x.sku),
    ['A', 'B', 'C', 'D'],
  )
})

test('elegirGanadores: excluye mi propio sku (también por itemIdMl) y exige reseñas y url', () => {
  const productos = [
    p('MIO', 2000, 30),
    p('A', 900),
    { sku: 'SINURL', titulo: 'x', url: null, numReviews: 800 },
    p('SINREVIEWS', 0),
    p('B', 100),
  ]
  const elegidos = elegirGanadores(productos, { excluirSkus: ['MIO', null] })
  assert.deepEqual(
    elegidos.map((x) => x.sku),
    ['A', 'B'],
  )
})

test('elegirGanadores: el más rápido no se duplica si ya está en el top por reseñas', () => {
  const productos = [p('A', 900, 40), p('B', 500), p('C', 300)]
  assert.deepEqual(
    elegirGanadores(productos).map((x) => x.sku),
    ['A', 'B', 'C'],
  )
})

// ---- validación mecánica del arranque del título ----
import { arranqueValido } from '../src/services/auditor.js'

test('arranqueValido: acepta arranques que son búsquedas reales (raíces, sin stopwords)', () => {
  const busquedas = ['pistola juguete', 'escopetas juguete', 'brochas maquillaje set']
  assert.ok(arranqueValido('Pistola Juguete Dardos Tiro Al Blanco', busquedas))
  assert.ok(arranqueValido('Escopeta Juguete Lanza Dardos Y Balines', busquedas)) // singular vs plural
  assert.ok(arranqueValido('Brochas Maquillaje Set 10 Profesional', busquedas))
})

test('arranqueValido: rechaza arranques que nadie busca', () => {
  const busquedas = ['pistola juguete', 'lanzador nerf']
  assert.ok(!arranqueValido('Lanzador De Dardos Juguete Niños', busquedas)) // "lanzador de dardos" no existe
  assert.ok(!arranqueValido('Set Tiro Al Blanco Juguete', busquedas))
  assert.ok(!arranqueValido('Pistola Juguete X', [])) // sin lista no valida nada
})
