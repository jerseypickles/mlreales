import test from 'node:test'
import assert from 'node:assert/strict'
import { veredicto, calzaConteo } from '../src/services/sondaReviewsCatalogo.js'

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

// El primer criterio fue ±2 absoluto y lo delató la medición sobre "cama perro":
// la API dio 80/80, 74/74 y 109/109 exactos, pero 1529 contra 1549 en un
// producto grande. Son 20 reseñas sobre 1549 —1,3%— y quedaban marcadas como
// error. Lo que el sistema usa es el DELTA, y un desfase proporcional se cancela
// en la resta; lo que rompe un delta es mezclar escalas distintas.
test('la tolerancia es proporcional, con piso para los conteos chicos', () => {
  assert.equal(calzaConteo(1549, 1529), true, '1,3% en un conteo grande no es error')
  assert.equal(calzaConteo(80, 80), true)
  assert.equal(calzaConteo(80, 78), true, 'piso absoluto: 2 de diferencia siempre pasa')
  assert.equal(calzaConteo(80, 60), false, '25% sí es otra cosa')
  // el caso que mató al endpoint público: 41 donde la ficha decía 59
  assert.equal(calzaConteo(59, 41), false)
  assert.equal(calzaConteo(4, 0), false, 'la API dice que no hay reseñas y la ficha muestra 4')
  assert.equal(calzaConteo(10, null), false)
})
