import test from 'node:test'
import assert from 'node:assert/strict'
import { calcularMargen, exwMaximoUsd } from '../src/services/margen.js'

const base = {
  costoExwUsd: 3,
  unidades: 500,
  volumenM3: 0.002,
  precioVentaClp: 15990,
  modoFlete: 'maritimo',
}

test('calcularMargen: caso marítimo con tarifa LCL explícita', () => {
  const r = calcularMargen({ ...base, parametros: { flete: { maritimoUsdPorM3: 180 } } })

  // EXW 3 USD * 950 = 2850; flete 0.002 m3 * 180 USD = 342 CLP; seguro 0.5% EXW
  assert.equal(r.porUnidad.exwClp, 2850)
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
  assert.equal(r.porUnidad.exwClp, 3000)
  assert.ok(r.porUnidad.arancelClp > 0) // sin certificado de origen
  assert.equal(r.supuestos.arancelPct, 6)
})

test('exwMaximoUsd: es la inversa de calcularMargen', () => {
  const objetivo = 25
  const exwMax = exwMaximoUsd({
    precioVentaClp: 15990,
    margenObjetivoPct: objetivo,
    unidades: 500,
    volumenM3: 0.002,
    modoFlete: 'maritimo',
  })
  assert.ok(exwMax > 0)

  // comprando exactamente al FOB máximo, el margen debe ser el objetivo
  const r = calcularMargen({
    costoExwUsd: exwMax,
    unidades: 500,
    volumenM3: 0.002,
    precioVentaClp: 15990,
    modoFlete: 'maritimo',
  })
  assert.ok(Math.abs(r.resultado.margenPctSobreVenta - objetivo) < 0.3)
})

test('exwMaximoUsd: precio muy bajo no da espacio', () => {
  assert.equal(exwMaximoUsd({ precioVentaClp: 900, margenObjetivoPct: 40 }), null)
})

test('calcularMargen: valida entradas', () => {
  assert.throws(() => calcularMargen({ ...base, costoExwUsd: 0 }), /costoExwUsd/)
  assert.throws(() => calcularMargen({ ...base, volumenM3: 0 }), /volumenM3/)
  assert.throws(() => calcularMargen({ ...base, modoFlete: 'aereo', pesoKg: 0 }), /pesoKg/)
  assert.throws(() => calcularMargen({ ...base, precioVentaClp: null }), /precioVentaClp/)
})
