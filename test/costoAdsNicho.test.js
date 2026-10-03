import test from 'node:test'
import assert from 'node:assert/strict'
import { cacDeCuenta, aprenderCostoAds, cacDeNicho, ajusteScore, CAC_FIJO } from '../src/services/ml/costoAdsNicho.js'

test('costo ads: la base mezcla lo medido con el fijo según las ventas por anuncio', () => {
  const sin = cacDeCuenta({})
  assert.equal(sin.cac, CAC_FIJO)
  assert.equal(sin.fuente, 'fijo')
  const b = cacDeCuenta({ medido: 1400, unidades: 270 })
  assert.equal(b.fuente, 'cuenta')
  assert.equal(b.peso, 0.9)
  assert.equal(b.cac, Math.round(0.9 * 1400 + 0.1 * CAC_FIJO))
})

const par = (nichoId, cpcGoogle, costoPorVenta, pctTopPaga = null) => ({ nichoId, cpcGoogle, costoPorVenta, pctTopPaga })

test('costo ads: con pocos productos o un solo nicho no se estima por nicho', () => {
  assert.equal(aprenderCostoAds([par('a', 0.1, 1000), par('b', 0.2, 1500)]).estado, 'pocos-casos')
  // los 4 sets de brochas son un solo nicho: no cuentan como 5 casos distintos
  const unNicho = [0.1, 0.12, 0.15, 0.2, 0.3].map((c, i) => par('brochas', c, 1000 + i * 300))
  assert.equal(aprenderCostoAds(unNicho).estado, 'pocos-casos')
})

test('costo ads: si el clic de Google anticipa el costo, el modelo valida', () => {
  const pares = [[0.07, 900], [0.1, 1200], [0.13, 1500], [0.2, 2100], [0.4, 3600], [0.15, 1650]]
    .map(([c, v], i) => par(`n${i}`, c, v))
  const m = aprenderCostoAds(pares)
  assert.equal(m.estado, 'valida')
  assert.equal(m.variable, 'cpcGoogle')
  assert.ok(m.b > 0)
})

test('costo ads: pendiente negativa (más presión, más barato) no se acepta', () => {
  const pares = [[0.07, 3600], [0.1, 2100], [0.13, 1650], [0.2, 1200], [0.4, 900], [0.15, 1500]]
    .map(([c, v], i) => par(`n${i}`, c, v))
  assert.notEqual(aprenderCostoAds(pares).estado, 'valida')
})

test('costo ads: sin modelo válido el nicho paga la base, y el estimado queda en sombra', () => {
  const leccion = { base: { cac: 1450, fuente: 'cuenta' }, modelo: { estado: 'sin-patron', variable: 'cpcGoogle', b: 0.8, xMedia: Math.log(0.13) } }
  const c = cacDeNicho({ cpcGoogle: 0.5 }, leccion)
  assert.equal(c.cac, 1450)
  assert.equal(c.fuente, 'cuenta')
  assert.ok(c.sombra > 1450, 'clic caro: la sombra dice más caro')
})

test('costo ads: con modelo válido el nicho paga su estimado, con tope', () => {
  const leccion = { base: { cac: 1450, fuente: 'cuenta' }, modelo: { estado: 'valida', variable: 'cpcGoogle', b: 0.8, xMedia: Math.log(0.13) } }
  const caro = cacDeNicho({ cpcGoogle: 0.5 }, leccion)
  assert.equal(caro.fuente, 'nicho')
  assert.ok(caro.cac > 1450)
  assert.ok(cacDeNicho({ cpcGoogle: 50 }, leccion).cac <= 1450 * 2.5, 'tope del factor')
  assert.equal(cacDeNicho({ cpcGoogle: null }, leccion).cac, 1450, 'sin señal: la base')
})

test('costo ads: más barato que el fijo sube el score; más caro lo baja; igual no cambia', () => {
  assert.ok(ajusteScore({ mediana: 9000, cac: 1000 }) > 0)
  assert.ok(ajusteScore({ mediana: 9000, cac: 3500 }) < 0)
  assert.equal(ajusteScore({ mediana: 9000, cac: CAC_FIJO }), 0)
  assert.equal(ajusteScore({ mediana: null, cac: 1000 }), 0)
})
