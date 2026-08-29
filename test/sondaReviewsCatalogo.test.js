import test from 'node:test'
import assert from 'node:assert/strict'
import { veredicto } from '../src/services/sondaReviewsCatalogo.js'

// La sonda decide si el conteo de reseñas puede salir de la API oficial en vez
// de la ficha. El criterio duro es la FIDELIDAD: un conteo que no calza con el
// de la ficha mide otra cosa, y mezclarlo en la serie fabrica deltas falsos.
//
// Ya pasó una vez: el endpoint público de reseñas daba 41 donde la ficha decía
// 59 —cuenta solo las que tienen texto— y la razón contra la ficha variaba
// entre 0,36 y 0,69 según el producto, así que ni calibrando servía.

test('si la API no calza con la ficha, no sirve aunque responda todo', () => {
  const v = veredicto({ conCatalogo: 40, total: 50, responden: 40, comparados: 8, calzan: 3 })
  assert.equal(v.apto, false)
  assert.match(v.motivo, /calza/)
})

test('si calza pero cubre poco, tampoco: no alcanza para puntuar', () => {
  const v = veredicto({ conCatalogo: 40, total: 50, responden: 12, comparados: 8, calzan: 8 })
  assert.equal(v.apto, false)
  assert.match(v.motivo, /responde/)
})

test('calza y cubre: apto', () => {
  const v = veredicto({ conCatalogo: 40, total: 50, responden: 36, comparados: 8, calzan: 8 })
  assert.equal(v.apto, true)
})

// Sin verdad conocida no hay veredicto: declarar "apto" porque la API contestó,
// sin haber comparado contra nada, es exactamente cómo se cuelan los datos malos.
test('sin nada contra qué comparar, no se opina', () => {
  const v = veredicto({ conCatalogo: 40, total: 50, responden: 40, comparados: 0, calzan: 0 })
  assert.equal(v.apto, false)
  assert.match(v.motivo, /comparar/)
})

test('listado vacío o sin ids de catálogo se reportan distinto', () => {
  assert.match(veredicto({ conCatalogo: 0, total: 0, responden: 0, comparados: 0, calzan: 0 }).motivo, /vacío/)
  assert.match(veredicto({ conCatalogo: 0, total: 50, responden: 0, comparados: 0, calzan: 0 }).motivo, /catálogo/)
})
