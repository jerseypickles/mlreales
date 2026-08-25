import test from 'node:test'
import assert from 'node:assert/strict'
import { cacheVigente } from '../src/services/indicadores.js'
import { importacion } from '../src/config/importacion.js'

// El tipo de cambio estaba clavado en 950 desde julio y el observado del
// 25-ago-2026 fue 914,64: 3,7% sobre TODO el costeo de importación, y siempre
// para el mismo lado — el modelo dice que cuesta más de lo que cuesta, así que
// mata nichos que sí daban.

test('cacheVigente: un valor recién leído sirve', () => {
  const ahora = Date.parse('2026-08-25T20:00:00Z')
  assert.equal(cacheVigente({ leidoEl: ahora - 60_000 }, ahora), true)
})

test('cacheVigente: pasada la vigencia, no', () => {
  const ahora = Date.parse('2026-08-25T20:00:00Z')
  const sieteHoras = 7 * 60 * 60 * 1000
  assert.equal(cacheVigente({ leidoEl: ahora - sieteHoras }, ahora), false)
})

test('cacheVigente: sin fecha de lectura nunca sirve', () => {
  assert.equal(cacheVigente(null), false)
  assert.equal(cacheVigente({}), false)
  assert.equal(cacheVigente({ leidoEl: null }), false)
})

test('cacheVigente: acepta la fecha como Date y como número', () => {
  // en memoria se guarda un timestamp y en Mongo un Date; los dos tienen que
  // medirse igual o el valor de la base se leería siempre como vencido
  const ahora = Date.parse('2026-08-25T20:00:00Z')
  const hace1h = ahora - 3600_000
  assert.equal(cacheVigente({ leidoEl: hace1h }, ahora), true)
  assert.equal(cacheVigente({ leidoEl: new Date(hace1h) }, ahora), true)
})

test('el respaldo del archivo sigue existiendo, pero es respaldo', () => {
  // si mindicador.cl no responde el simulador tiene que abrir igual: un número
  // viejo y rotulado es mejor que una pantalla colgada 15 segundos
  assert.ok(Number.isFinite(importacion.tipoCambioUsdClp))
})
