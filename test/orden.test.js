import test from 'node:test'
import assert from 'node:assert/strict'
import { compararOportunidades, rangoBusqueda, rangoVentana } from '../frontend/src/lib/sidebar.js'

// El orden de la mesa de compra: búsqueda → momento → score. Estos casos son
// los que motivaron el cambio sobre el tablero real del 9-ago-2026.
const op = (extra) => ({ keyword: 'x', score: 50, ...extra })
const orden = (lista) => [...lista].sort(compararOportunidades).map((o) => o.keyword)

test('la búsqueda manda sobre el score', () => {
  // un score 87 sobre una keyword que nadie escribe no puede ir arriba de un
  // 60 que la gente sí busca (caso depiladora ipl casera vs depiladora laser)
  assert.deepEqual(
    orden([
      op({ keyword: 'nadie la busca', score: 87, nivelBusqueda: { nivel: 'nulo' } }),
      op({ keyword: 'mal escrita', score: 85, nivelBusqueda: { nivel: 'renombrar' } }),
      op({ keyword: 'la buscan', score: 60, nivelBusqueda: { nivel: 'alto' } }),
    ]),
    ['la buscan', 'mal escrita', 'nadie la busca'],
  )
})

test('a igual búsqueda, manda el momento de compra', () => {
  assert.deepEqual(
    orden([
      op({ keyword: 'futura', score: 90, nivelBusqueda: { nivel: 'alto' }, ventana: { estado: 'futura' } }),
      op({ keyword: 'ultimo mes', score: 55, nivelBusqueda: { nivel: 'alto' }, ventana: { estado: 'ultimo-mes' } }),
      op({ keyword: 'abierta', score: 70, nivelBusqueda: { nivel: 'alto' }, ventana: { estado: 'ahora' } }),
    ]),
    ['ultimo mes', 'abierta', 'futura'],
  )
})

test('a igual búsqueda y momento, decide el score', () => {
  assert.deepEqual(
    orden([
      op({ keyword: 'menor', score: 60, nivelBusqueda: { nivel: 'medio' } }),
      op({ keyword: 'mayor', score: 88, nivelBusqueda: { nivel: 'medio' } }),
    ]),
    ['mayor', 'menor'],
  )
})

test('sin medir queda en el medio: no adelanta a una búsqueda alta ni cae al fondo', () => {
  assert.ok(rangoBusqueda({ nivelBusqueda: { nivel: 'alto' } }) < rangoBusqueda({}))
  assert.ok(rangoBusqueda({}) < rangoBusqueda({ nivelBusqueda: { nivel: 'bajo' } }))
  assert.deepEqual(
    orden([
      op({ keyword: 'sin medir', score: 50 }),
      op({ keyword: 'cola larga', score: 99, nivelBusqueda: { nivel: 'bajo' } }),
      op({ keyword: 'alta', score: 10, nivelBusqueda: { nivel: 'alto' } }),
    ]),
    ['alta', 'sin medir', 'cola larga'],
  )
})

test('sin temporada no penaliza: se compra cuando se quiera', () => {
  assert.equal(rangoVentana({ ventana: { estado: 'sin-temporada' } }), rangoVentana({}))
  assert.ok(rangoVentana({ ventana: { estado: 'ahora' } }) < rangoVentana({}))
  assert.ok(rangoVentana({}) < rangoVentana({ ventana: { estado: 'futura' } }))
})
