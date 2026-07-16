import test from 'node:test'
import assert from 'node:assert/strict'
import { calcularMargen } from '../src/services/margen.js'

const base = {
  costoFobUsd: 3,
  unidades: 500,
  volumenM3: 0.002,
  precioVentaClp: 15990,
  modoFlete: 'maritimo',
}

test('calcularMargen: caso marítimo con defaults', () => {
  const r = calcularMargen(base)

  // FOB 3 USD * 950 = 2850; flete 0.002 m3 * 180 USD = 342 CLP; seguro 0.5% FOB
  assert.equal(r.porUnidad.fobClp, 2850)
  assert.equal(r.porUnidad.fleteClp, 342)
  assert.equal(r.porUnidad.seguroClp, 14)
  assert.equal(r.porUnidad.arancelClp, 0) // TLC China-Chile
  assert.equal(r.porUnidad.despachoClp, 475) // 250 USD prorrateado en 500 u
  assert.equal(r.porUnidad.landedNetoClp, 3681)
  assert.equal(r.porUnidad.ivaImportacionClp, 609)
  assert.equal(r.porUnidad.ingresoNetoClp, 13437)
  assert.equal(r.porUnidad.margenClp, 6597)

  assert.equal(r.resultado.margenPctSobreVenta, 49.1)
  assert.equal(r.resultado.roiPct, 179.2)
  assert.equal(r.resultado.viable, true)
  assert.equal(r.resultado.inversionCajaClp, 2145219)
})

test('calcularMargen: cargo fijo ML bajo el umbral de precio', () => {
  const r = calcularMargen({ ...base, precioVentaClp: 8000 })
  // comisión bruta = 8000*16% + 700 fijo = 1980 → neta 1980/1.19
  assert.equal(r.porUnidad.comisionMlClp, Math.round(1980 / 1.19))
})

test('calcularMargen: flete aéreo usa peso', () => {
  const r = calcularMargen({ ...base, modoFlete: 'aereo', pesoKg: 0.8, volumenM3: 0 })
  // 0.8 kg * 6.5 USD * 950
  assert.equal(r.porUnidad.fleteClp, Math.round(0.8 * 6.5 * 950))
})

test('calcularMargen: overrides de parámetros', () => {
  const r = calcularMargen({
    ...base,
    parametros: { tipoCambioUsdClp: 1000, aduana: { arancelPct: 6, ivaPct: 19, despachoUsd: 250 } },
  })
  assert.equal(r.porUnidad.fobClp, 3000)
  assert.ok(r.porUnidad.arancelClp > 0) // sin certificado de origen
  assert.equal(r.supuestos.arancelPct, 6)
})

test('calcularMargen: valida entradas', () => {
  assert.throws(() => calcularMargen({ ...base, costoFobUsd: 0 }), /costoFobUsd/)
  assert.throws(() => calcularMargen({ ...base, volumenM3: 0 }), /volumenM3/)
  assert.throws(() => calcularMargen({ ...base, modoFlete: 'aereo', pesoKg: 0 }), /pesoKg/)
  assert.throws(() => calcularMargen({ ...base, precioVentaClp: null }), /precioVentaClp/)
})
