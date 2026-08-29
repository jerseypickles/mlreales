import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarDestacados,
  normalizarTendencias,
  cruceConDestacados,
} from '../src/services/senalesOficiales.js'

// Respuestas REALES de la API oficial, medidas el 29-ago-2026 sobre la
// categoría MLC178734 (depiladoras definitivas).
const HIGHLIGHTS = {
  query_data: { highlight_type: 'BEST_SELLER', criteria: 'CATEGORY', id: 'MLC178734' },
  content: [
    { id: 'MLC45472609', position: 1, type: 'PRODUCT' },
    { id: 'MLCU3831502409', position: 2, type: 'USER_PRODUCT' },
    { id: 'MLC25818307', position: 3, type: 'PRODUCT' },
    { id: null, position: 4, type: 'PRODUCT' },
  ],
}

// `highlights` mezcla catálogo (MLC…) con publicaciones de vendedor (MLCU…), y
// los ids no son intercambiables: hay que saber de cuál se habla.
test('los destacados distinguen catálogo de publicación', () => {
  const d = normalizarDestacados(HIGHLIGHTS)
  assert.equal(d.length, 3, 'la fila sin id se descarta')
  assert.deepEqual(d[0], { id: 'MLC45472609', posicion: 1, tipo: 'catalogo' })
  assert.equal(d[1].tipo, 'publicacion')
})

test('sin contenido no explota', () => {
  assert.deepEqual(normalizarDestacados(null), [])
  assert.deepEqual(normalizarDestacados({}), [])
})

// Las tendencias traen la keyword COMO LA ESCRIBE LA GENTE —"philips lumea ipl
// 9000", no "depiladora"—, que es justo lo que el nivel de búsqueda intenta
// adivinar hoy.
test('las tendencias se limpian y no se repiten', () => {
  const t = normalizarTendencias([
    { keyword: 'Philips Lumea IPL 9000', url: 'x' },
    { keyword: 'philips lumea ipl 9000', url: 'y' },
    { keyword: '  braun silk expert pro 5 ', url: 'z' },
    { keyword: '', url: 'w' },
    null,
  ])
  assert.deepEqual(t, ['philips lumea ipl 9000', 'braun silk expert pro 5'])
})

// El cruce es control de calidad del scrapeo, no un score: si ML dice que los
// más vendidos son estos y nuestro top no contiene ninguno, estamos midiendo un
// listado que no es el que compra la gente.
test('el cruce dice cuánto del ranking de ML estamos midiendo', () => {
  const d = normalizarDestacados(HIGHLIGHTS)
  const todo = cruceConDestacados(d, ['MLC45472609', 'MLCU3831502409', 'MLC25818307', 'MLC999'])
  assert.equal(todo.enNuestroTop, 3)
  assert.equal(todo.pct, 100)
  assert.deepEqual(todo.faltantes, [])

  const nada = cruceConDestacados(d, ['MLC111', 'MLC222'])
  assert.equal(nada.enNuestroTop, 0)
  assert.equal(nada.pct, 0)
  assert.equal(nada.faltantes.length, 3, 'se listan para poder investigarlos')
})

test('sin destacados no se inventa un porcentaje', () => {
  const r = cruceConDestacados([], ['MLC1'])
  assert.equal(r.pct, null)
  assert.equal(r.destacados, 0)
})
