import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarTexto,
  palabrasClave,
  elegirMejorSugerencia,
  UMBRAL_PARECIDO,
} from '../src/services/busquedasReales.js'

test('normalizarTexto: minúsculas, sin tildes y espacios colapsados', () => {
  assert.equal(normalizarTexto('  Lámpara   SOLAR Jardín '), 'lampara solar jardin')
  assert.equal(normalizarTexto('guirnalda navideña'), 'guirnalda navidena')
})

test('palabrasClave: ignora stopwords y empata singular/plural', () => {
  assert.deepEqual(palabrasClave('freidora de aire'), palabrasClave('freidora aire'))
  assert.deepEqual(palabrasClave('foco solares'), palabrasClave('focos solares'))
  assert.deepEqual(palabrasClave('fuente solar'), palabrasClave('fuentes solares'))
})

test('elegirMejorSugerencia: keyword inventada larga matchea la búsqueda real que la contiene', () => {
  const mejor = elegirMejorSugerencia('reflector solar exterior sensor movimiento', [
    'reflector solar',
    'reflector solar sensor movimiento',
    'reflector solar led',
  ])
  assert.equal(mejor.keyword, 'reflector solar sensor movimiento')
  assert.ok(mejor.puntaje >= UMBRAL_PARECIDO)
})

test('elegirMejorSugerencia: intención distinta queda bajo el umbral', () => {
  // "cascada solar" en Chile es luces de navidad, no fuentes de jardín
  const mejor = elegirMejorSugerencia('cascada solar jardin fuente', [
    'cascada solar navidad',
    'cascada solar blanca',
    'cascada solar 5 metros',
  ])
  assert.ok(mejor.puntaje < UMBRAL_PARECIDO)
})

test('elegirMejorSugerencia: stopwords y plurales no restan puntaje', () => {
  const mejor = elegirMejorSugerencia('freidora de aire', ['freidora aire', 'freidora sin aceite'])
  assert.equal(mejor.keyword, 'freidora aire')
  assert.equal(mejor.puntaje, 1)
})

test('elegirMejorSugerencia: coincidencia exacta puntúa 1', () => {
  const mejor = elegirMejorSugerencia('depiladora laser', ['depiladora laser', 'depiladora facial'])
  assert.equal(mejor.keyword, 'depiladora laser')
  assert.equal(mejor.puntaje, 1)
})

test('elegirMejorSugerencia: sin sugerencias devuelve null', () => {
  assert.equal(elegirMejorSugerencia('lo que sea', []), null)
})
