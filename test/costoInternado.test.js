import test from 'node:test'
import assert from 'node:assert/strict'
import { costoInternado } from '../src/services/margen.js'

// Cotización QBUY 20260824587 del 24-ago-2026: 15 líneas EXW por US$13.615.
// El EXW no es comparable con el precio de venta en ML — entre uno y otro hay
// flete, seguro, arancel y despacho, y en productos voluminosos el flete pesa
// más que la diferencia de precio entre dos proveedores.

const TC = { tipoCambioUsdClp: 900 } // fijo, para que los tests no dependan del dólar del día

test('el EXW se convierte con el tipo de cambio, no se usa crudo', () => {
  const r = costoInternado({ exwUsd: 17, unidades: 150, parametros: TC })
  assert.equal(r.desglose.exwClp, 15_300) // 17 × 900
  assert.ok(r.internadoClp > r.desglose.exwClp, 'el puesto siempre supera al EXW')
})

test('el despacho se prorratea: más unidades, menos por unidad', () => {
  // US$250 de agente de aduana por embarque, no por producto
  const pocas = costoInternado({ exwUsd: 10, unidades: 30, parametros: TC })
  const muchas = costoInternado({ exwUsd: 10, unidades: 300, parametros: TC })
  assert.equal(pocas.desglose.despachoClp, 7500) // 250 × 900 / 30
  assert.equal(muchas.desglose.despachoClp, 750)
  assert.ok(pocas.internadoClp > muchas.internadoClp)
})

test('SIN cubicaje el número sale igual, pero rotulado', () => {
  // un blanco no sirve de nada; un número con su advertencia sí
  const r = costoInternado({ exwUsd: 8.3, unidades: 150, parametros: TC })
  assert.equal(r.supuestos.volumenSupuesto, true)
  assert.equal(r.supuestos.volumenM3, 0.003)
  assert.ok(r.internadoClp > 0)
})

test('el cubicaje real puede cambiar el costo puesto por completo', () => {
  // caso rack de 85 cm: con el supuesto de producto chico el flete es ruido,
  // con el volumen real es un cuarto del costo
  const supuesto = costoInternado({ exwUsd: 8.3, unidades: 150, parametros: TC })
  const real = costoInternado({ exwUsd: 8.3, unidades: 150, volumenM3: 0.05, parametros: TC })
  assert.equal(supuesto.supuestos.volumenSupuesto, true)
  assert.equal(real.supuestos.volumenSupuesto, false)
  assert.ok(real.fletePctDelInternado > 20, `el flete real pesa ${real.fletePctDelInternado}%`)
  assert.ok(supuesto.fletePctDelInternado < 3, 'con el supuesto parecía irrelevante')
  assert.ok(real.internadoClp > supuesto.internadoClp * 1.2, 'y el costo sube más de 20%')
})

test('el IVA de importación se informa aparte: es crédito, pero se financia', () => {
  const r = costoInternado({ exwUsd: 17, unidades: 150, parametros: TC })
  assert.ok(r.ivaImportacionClp > 0)
  // la caja que hay que poner incluye el IVA aunque después se recupere
  assert.ok(r.inversionCajaClp > r.internadoClp * 150)
})

test('flete aéreo cobra por kilo, no por metro cúbico', () => {
  const mar = costoInternado({ exwUsd: 10, unidades: 100, volumenM3: 0.01, parametros: TC })
  const aire = costoInternado({ exwUsd: 10, unidades: 100, pesoKg: 2, modoFlete: 'aereo', parametros: TC })
  assert.ok(aire.desglose.fleteClp > mar.desglose.fleteClp, 'el aéreo siempre sale más caro')
  assert.equal(aire.supuestos.modoFlete, 'aereo')
})

test('sin EXW no hay costo puesto que calcular', () => {
  assert.throws(() => costoInternado({ exwUsd: 0, unidades: 10 }), /exwUsd/)
  assert.throws(() => costoInternado({ exwUsd: null, unidades: 10 }), /exwUsd/)
  assert.throws(() => costoInternado({ exwUsd: 5, unidades: 0 }), /unidades/)
})

// ── el margen NO se muestra contra un precio que no es tuyo ──────────────────
//
// Regla del importador el 26-ago-2026: "no podemos saber lo que va a dejar por
// un precio que va a competir solo; varios productos son de mejor calidad, son
// todo diferente". El precio del análisis sale de la mediana del mercado, o sea
// de OTRO producto — usarlo para juzgar el tuyo es inventar dos veces (el
// cubicaje y el precio).

test('costoPuesto no habla de margen ni de precio de venta', () => {
  const r = costoInternado({ exwUsd: 17, unidades: 150, parametros: TC })
  assert.equal(r.margenClp, undefined, 'no le corresponde: no sabe a qué vas a vender')
  assert.equal(r.precioVentaClp, undefined)
  assert.ok(Number.isFinite(r.internadoClp), 'lo suyo es el costo puesto y nada más')
})

test('el costo puesto no depende del precio de venta, solo del EXW y el embarque', () => {
  // dos productos con el mismo EXW y embarque cuestan lo mismo puesto en
  // bodega, se vendan a $5.000 o a $50.000
  const a = costoInternado({ exwUsd: 12.5, unidades: 80, parametros: TC })
  const b = costoInternado({ exwUsd: 12.5, unidades: 80, parametros: TC })
  assert.equal(a.internadoClp, b.internadoClp)
})

// ── internado NO es puesto ───────────────────────────────────────────────────
//
// "Puesto es cuando llega a Chile, pero faltan costos" — el importador, 26-ago.
// Tiene razón: esto llega hasta salir de aduana. Después queda el transporte a
// bodega, los gastos locales de naviera y el envío a Full.

test('el internado declara lo que NO incluye', () => {
  const r = costoInternado({ exwUsd: 17, unidades: 150, parametros: TC })
  assert.ok(Array.isArray(r.noIncluye) && r.noIncluye.length >= 3)
  assert.ok(r.noIncluye.some((x) => /bodega/i.test(x)), 'el transporte a bodega tiene que estar nombrado')
  assert.ok(r.noIncluye.some((x) => /Full/i.test(x)), 'y el envío a Full también')
})

test('el internado es un PISO: el costo real solo puede ser mayor', () => {
  const r = costoInternado({ exwUsd: 10, unidades: 100, parametros: TC })
  const suma = r.desglose.exwClp + r.desglose.fleteClp + r.desglose.seguroClp + r.desglose.arancelClp + r.desglose.despachoClp
  assert.equal(r.internadoClp, Math.round(suma), 'es exactamente la suma de sus partes, sin colchón')
})
