import test from 'node:test'
import assert from 'node:assert/strict'
import { costoPuesto } from '../src/services/margen.js'

// Cotización QBUY 20260824587 del 24-ago-2026: 15 líneas EXW por US$13.615.
// El EXW no es comparable con el precio de venta en ML — entre uno y otro hay
// flete, seguro, arancel y despacho, y en productos voluminosos el flete pesa
// más que la diferencia de precio entre dos proveedores.

const TC = { tipoCambioUsdClp: 900 } // fijo, para que los tests no dependan del dólar del día

test('el EXW se convierte con el tipo de cambio, no se usa crudo', () => {
  const r = costoPuesto({ exwUsd: 17, unidades: 150, parametros: TC })
  assert.equal(r.desglose.exwClp, 15_300) // 17 × 900
  assert.ok(r.puestoClp > r.desglose.exwClp, 'el puesto siempre supera al EXW')
})

test('el despacho se prorratea: más unidades, menos por unidad', () => {
  // US$250 de agente de aduana por embarque, no por producto
  const pocas = costoPuesto({ exwUsd: 10, unidades: 30, parametros: TC })
  const muchas = costoPuesto({ exwUsd: 10, unidades: 300, parametros: TC })
  assert.equal(pocas.desglose.despachoClp, 7500) // 250 × 900 / 30
  assert.equal(muchas.desglose.despachoClp, 750)
  assert.ok(pocas.puestoClp > muchas.puestoClp)
})

test('SIN cubicaje el número sale igual, pero rotulado', () => {
  // un blanco no sirve de nada; un número con su advertencia sí
  const r = costoPuesto({ exwUsd: 8.3, unidades: 150, parametros: TC })
  assert.equal(r.supuestos.volumenSupuesto, true)
  assert.equal(r.supuestos.volumenM3, 0.003)
  assert.ok(r.puestoClp > 0)
})

test('el cubicaje real puede cambiar el costo puesto por completo', () => {
  // caso rack de 85 cm: con el supuesto de producto chico el flete es ruido,
  // con el volumen real es un cuarto del costo
  const supuesto = costoPuesto({ exwUsd: 8.3, unidades: 150, parametros: TC })
  const real = costoPuesto({ exwUsd: 8.3, unidades: 150, volumenM3: 0.05, parametros: TC })
  assert.equal(supuesto.supuestos.volumenSupuesto, true)
  assert.equal(real.supuestos.volumenSupuesto, false)
  assert.ok(real.fletePctDelPuesto > 20, `el flete real pesa ${real.fletePctDelPuesto}%`)
  assert.ok(supuesto.fletePctDelPuesto < 3, 'con el supuesto parecía irrelevante')
  assert.ok(real.puestoClp > supuesto.puestoClp * 1.2, 'y el costo sube más de 20%')
})

test('el IVA de importación se informa aparte: es crédito, pero se financia', () => {
  const r = costoPuesto({ exwUsd: 17, unidades: 150, parametros: TC })
  assert.ok(r.ivaImportacionClp > 0)
  // la caja que hay que poner incluye el IVA aunque después se recupere
  assert.ok(r.inversionCajaClp > r.puestoClp * 150)
})

test('flete aéreo cobra por kilo, no por metro cúbico', () => {
  const mar = costoPuesto({ exwUsd: 10, unidades: 100, volumenM3: 0.01, parametros: TC })
  const aire = costoPuesto({ exwUsd: 10, unidades: 100, pesoKg: 2, modoFlete: 'aereo', parametros: TC })
  assert.ok(aire.desglose.fleteClp > mar.desglose.fleteClp, 'el aéreo siempre sale más caro')
  assert.equal(aire.supuestos.modoFlete, 'aereo')
})

test('sin EXW no hay costo puesto que calcular', () => {
  assert.throws(() => costoPuesto({ exwUsd: 0, unidades: 10 }), /exwUsd/)
  assert.throws(() => costoPuesto({ exwUsd: null, unidades: 10 }), /exwUsd/)
  assert.throws(() => costoPuesto({ exwUsd: 5, unidades: 0 }), /unidades/)
})
