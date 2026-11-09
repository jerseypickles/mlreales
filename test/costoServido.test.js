import test from 'node:test'
import assert from 'node:assert/strict'
import { costoServido } from '../src/services/scraper.js'
import { MOTIVO_NO_ES_FICHA } from '../src/services/detalleMl.js'

test('costo de fichas: lo que el proveedor no sirvió no se cobra; el cascarón sí', () => {
  const bloqueada = { url: 'a', motivo: 'Zyte HTTP 520: Website Ban' }
  const cascaron = { url: 'b', motivo: MOTIVO_NO_ES_FICHA }
  assert.equal(costoServido({ costoUsd: 0.12, pedidas: 20, fallidos: [] }), 0.12)
  assert.ok(Math.abs(costoServido({ costoUsd: 0.12, pedidas: 20, fallidos: Array(10).fill(bloqueada) }) - 0.06) < 1e-9)
  assert.equal(costoServido({ costoUsd: 0.12, pedidas: 20, fallidos: [cascaron, cascaron] }), 0.12)
  assert.equal(costoServido({ costoUsd: 0.12, pedidas: 2, fallidos: [bloqueada, bloqueada] }), 0)
  assert.equal(costoServido({ costoUsd: 0.5, fallidos: [bloqueada] }), 0.5, 'sin el dato de lo pedido (Apify) no se descuenta nada')
})
