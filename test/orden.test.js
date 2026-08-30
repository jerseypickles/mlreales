import test from 'node:test'
import assert from 'node:assert/strict'
import { compararOportunidades, bandaBusqueda, rangoVentana } from '../frontend/src/lib/sidebar.js'

// El orden de la mesa de compra: búsqueda → momento → score. Estos casos son
// los que motivaron el cambio sobre el tablero real del 9-ago-2026.
//
// El 30-ago-2026 cambió CÓMO se mide la búsqueda: antes el nivel del
// autocompletado de ML, ahora el volumen absoluto de Google Ads cuando está
// medido —lo está para los 76 nichos de la mesa—. El nivel es relativo a su
// prefijo y ordenaba mal: "waflera electrica" con 22.200 al mes quedaba debajo
// de un "alto" de 140. El nivel queda como respaldo para lo que no se midió.
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
  assert.ok(bandaBusqueda({ nivelBusqueda: { nivel: 'alto' } }) < bandaBusqueda({}))
  assert.ok(bandaBusqueda({}) < bandaBusqueda({ nivelBusqueda: { nivel: 'bajo' } }))
  // y un volumen MEDIDO le gana a cualquier nivel sin medir
  assert.ok(
    bandaBusqueda({ curvaAnual: { busquedasMes: 25_000 } }) <
      bandaBusqueda({ nivelBusqueda: { nivel: 'alto' } }),
  )
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
