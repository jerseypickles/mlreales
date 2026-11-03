import test from 'node:test'
import assert from 'node:assert/strict'
import { positivo, precioVigente } from '../src/services/precioVigente.js'
import { resumirPromocion } from '../src/services/promociones.js'
import { precioDePropio } from '../src/services/gama.js'
import { metricasDe } from '../frontend/src/lib/familiasPropias.js'
import { seriePrecioEntrada } from '../frontend/src/lib/catalogoPropios.js'

// caso 3-nov-2026: una promoción "10% llevando 2". ML la manda con price 0
// y el sistema guardaba precio efectivo $0. Precios de ejemplo.
const VOLUMEN = { id: 'C-MLC1', type: 'VOLUME', name: '10% llevando 2', price: 0, original_price: 10000, status: 'started' }
const medicion = (precio, precioEfectivo, fecha = '2026-11-03T15:30:00Z') => ({ fecha, precio, precioEfectivo })

test('precio vigente: un precio que no es positivo no es precio', () => {
  assert.equal(positivo(10000), 10000)
  for (const x of [0, -1, null, undefined, NaN, '10000']) assert.equal(positivo(x), null)
})

test('precio vigente: la promoción por volumen no tiene precio por unidad', () => {
  const r = resumirPromocion(VOLUMEN)
  assert.equal(r.precio, null, 'el 0 de ML no pasa como precio')
  assert.equal(r.precioOriginal, 10000)
  assert.equal(r.tipo, 'VOLUME')
  // una oferta de precio sí trae precio por unidad
  assert.equal(resumirPromocion({ type: 'PRICE_DISCOUNT', price: 9000, original_price: 10000 }).precio, 9000)
})

test('precio vigente: la cadena salta el 0 hasta el precio de lista', () => {
  // así quedaba guardado: promoción con 0 y efectivo 0 en cada medición
  const promo = { activa: { tipo: 'VOLUME', precio: 0 } }
  assert.equal(precioVigente({ promo, medicion: medicion(10000, 0) }), 10000)
  // una promoción con precio por unidad sí manda sobre el de lista
  assert.equal(precioVigente({ promo: { activa: { precio: 9000 } }, medicion: medicion(10000, 10000) }), 9000)
  // el precio pedido explícitamente (lo cobrado en ventas) manda sobre todo
  assert.equal(precioVigente({ precio: 9500, promo, medicion: medicion(10000, 0) }), 9500)
  assert.equal(precioVigente({}), null)
  assert.equal(precioVigente(), null)
})

test('precio vigente: gama y tarjetas de Mis productos no muestran $0', () => {
  const propio = { promoMl: { activa: { tipo: 'VOLUME', precio: 0 } }, mediciones: [medicion(10000, 0)] }
  assert.equal(precioDePropio(propio), 10000)
  assert.equal(metricasDe(propio).precio, 10000)
})

test('precio vigente: la serie de precio de una familia salta el efectivo 0', () => {
  const propio = { mediciones: [medicion(10000, 0, '2026-11-03T14:30:00Z'), medicion(10000, 10000, '2026-11-03T15:30:00Z')] }
  const serie = seriePrecioEntrada({ p: propio })
  assert.deepEqual(serie.map((x) => x.valor), [10000, 10000])
})
