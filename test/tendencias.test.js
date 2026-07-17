import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularMovimientos,
  lineasEnAlza,
  prefijoDeKeyword,
  diaChile,
} from '../src/services/tendencias.js'

test('calcularMovimientos: detecta nuevas y subidas, ignora bajadas y estables', () => {
  const anterior = ['hervidor', 'hervidor electrico', 'hervidor agua', 'hervidor portatil']
  const actual = ['hervidor', 'hervidor portatil', 'hervidor sin cable', 'hervidor electrico']

  const movs = calcularMovimientos(actual, anterior)

  // "hervidor" estable (1→1) y "hervidor electrico" bajó (2→4): fuera
  assert.deepEqual(movs, [
    { q: 'hervidor portatil', posicion: 2, antes: 4, nueva: false },
    { q: 'hervidor sin cable', posicion: 3, antes: null, nueva: true },
  ])
})

test('calcularMovimientos: sin historia previa todo es nuevo', () => {
  const movs = calcularMovimientos(['freidora aire'], [])
  assert.deepEqual(movs, [{ q: 'freidora aire', posicion: 1, antes: null, nueva: true }])
})

test('lineasEnAlza: formatea nuevas y subidas, y respeta el máximo', () => {
  const lineas = lineasEnAlza(
    [
      { prefijo: 'hervidor', q: 'hervidor sin cable', posicion: 3, antes: null, nueva: true },
      { prefijo: 'hervidor', q: 'hervidor portatil', posicion: 2, antes: 4, nueva: false },
      { prefijo: 'termo', q: 'termo electrico', posicion: 5, antes: 6, nueva: false },
    ],
    { max: 2 },
  )
  assert.deepEqual(lineas, [
    '"hervidor sin cable" — entró al ranking de "hervidor" (puesto 3)',
    '"hervidor portatil" — subió 4→2 bajo "hervidor"',
  ])
})

test('prefijoDeKeyword: primera palabra significativa, sin stopwords y en raíz', () => {
  assert.equal(prefijoDeKeyword('hervidor electrico'), 'hervidor')
  assert.equal(prefijoDeKeyword('fuente de agua gato'), 'fuente')
  assert.equal(prefijoDeKeyword('focos solares'), 'foco')
})

test('diaChile: formatea YYYY-MM-DD en hora de Chile', () => {
  // 02:00 UTC del 2 de julio = 22:00 del 1 de julio en Chile (UTC-4)
  assert.equal(diaChile(new Date('2026-07-02T02:00:00Z')), '2026-07-01')
  assert.equal(diaChile(new Date('2026-07-02T13:00:00Z')), '2026-07-02')
})
