import test from 'node:test'
import assert from 'node:assert/strict'
import { sospechaDeMedicion } from '../src/services/vigiaMejoras.js'

test('vigía: Google casi nada y Mercado Libre vende mucho = medición sospechosa', () => {
  assert.match(sospechaDeMedicion({ busquedasMes: 110, vendidosTop: 73200 }), /otro nombre/)
  assert.ok(sospechaDeMedicion({ busquedasMes: 320, nivelMl: 'alto' }))
  assert.equal(sospechaDeMedicion({ busquedasMes: 14800, vendidosTop: 90000 }), null, 'volumen sano: nada que mejorar')
  assert.equal(sospechaDeMedicion({ busquedasMes: 1500, vendidosTop: 3000 }), null, 'ML tampoco muestra mucho')
  assert.equal(sospechaDeMedicion({ busquedasMes: null, vendidosTop: 50000 }), null, 'sin medición no se sospecha')
})
