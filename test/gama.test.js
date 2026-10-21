import test from 'node:test'
import assert from 'node:assert/strict'
import { rangoGama, marcarGama, lecturaGama, rivalesDeGama, aplicarCambioGama, precioDePropio } from '../src/services/gama.js'
import { elegirGanadores } from '../src/services/auditor.js'

// el scan de "manguera extensible" del 15-oct-2026, resumido: las económicas
// tienen las reseñas; la gama alta vende menos pero existe
const p = (sku, precio, numReviews = null, extra = {}) => ({ sku, precio, numReviews, titulo: `manguera ${sku}`, url: `https://x/${sku}`, ...extra })
const SCAN = [
  p('rayun', 6585, 420, { posicion: 1, resenasNuevasDia: 1.2 }),
  p('magic', 5700, 682, { posicion: 7, resenasNuevasDia: 2 }),
  p('azul30', 6400, 557, { posicion: 8, resenasNuevasDia: 1.5 }),
  p('espiral', 8413, 300, { posicion: 4, resenasNuevasDia: 0.8 }),
  p('reforzada30', 11339, 400, { posicion: 22, resenasNuevasDia: 0.3 }),
  p('jardin30', 17800, 37, { posicion: 2, resenasNuevasDia: 0.2 }),
  p('accesorios30', 17980, 47, { posicion: 19 }),
  p('bobina15', 13990, null, { posicion: 38, vendidos: 100 }),
  p('kit', 23990, null, { posicion: 68 }),
  p('MLC4607442466', 13990, 0, { posicion: 60 }), // la propia
]

test('rangoGama: de 0,7× a 1,6× el precio; el rango del importador manda', () => {
  assert.deepEqual(rangoGama(13990), { desde: 9800, hasta: 22400, manual: false })
  assert.deepEqual(rangoGama(13990, { desde: 12000 }), { desde: 12000, hasta: 22400, manual: true })
  assert.deepEqual(rangoGama(13990, { desde: 25000, hasta: 10000 }), { desde: 10000, hasta: 25000, manual: true }, 'al revés se ordena')
  assert.equal(rangoGama(null), null)
})

test('marcarGama: la gama por precio, sin la propia; sumar y sacar a mano manda sobre el precio', () => {
  const { rango, productos } = marcarGama(SCAN, { precio: 13990, propios: ['MLC4607442466'] })
  assert.equal(rango.desde, 9800)
  assert.equal(productos.some((x) => x.sku === 'MLC4607442466'), false, 'mi publicación no es rival')
  const en = productos.filter((x) => x.enGama).map((x) => x.sku).sort()
  assert.deepEqual(en, ['accesorios30', 'bobina15', 'jardin30', 'reforzada30'])
  const corregido = marcarGama(SCAN, { precio: 13990, gama: { agregadas: ['kit'], sacadas: ['reforzada30'] }, propios: ['MLC4607442466'] }).productos
  const kit = corregido.find((x) => x.sku === 'kit'), reforzada = corregido.find((x) => x.sku === 'reforzada30')
  assert.equal(kit.enGama, true)
  assert.equal(kit.origenGama, 'agregada')
  assert.equal(reforzada.enGama, false)
  assert.equal(reforzada.origenGama, 'sacada')
})

test('lecturaGama: contra su gama la manguera queda bajo la mediana, y la gama se lleva poco de las reseñas', () => {
  const { productos } = marcarGama(SCAN, { precio: 13990, propios: ['MLC4607442466'] })
  const l = lecturaGama(productos, { precio: 13990 })
  assert.equal(l.publicaciones, 4)
  assert.equal(l.delNicho, 9)
  assert.equal(l.medianaPrecio, 15895) // (13.990 + 17.800) / 2
  assert.ok(l.medianaPrecio > 13990 && l.medianaPrecioNicho < 13990, 'cara contra el nicho, barata contra su gama')
  assert.equal(l.masBaratasQueTuPct, 25) // solo la reforzada de $11.339
  assert.equal(l.reseniasPct, Math.round((484 / 2443) * 1000) / 10)
  assert.equal(l.ventaHoyPct, Math.round((0.5 / 6) * 1000) / 10)
  assert.equal(l.conVendidos100, 1)
  // con pocas lecturas de venta de hoy no se afirma nada
  const pocas = lecturaGama(productos.map((x) => ({ ...x, resenasNuevasDia: x.sku === 'rayun' ? 1 : null })), { precio: 13990 })
  assert.equal(pocas.ventaHoyPct, null)
  // lo sacado a mano no cuenta ni en la gama ni en el nicho
  const sinKit = lecturaGama(marcarGama(SCAN, { precio: 13990, gama: { sacadas: ['kit'] }, propios: ['MLC4607442466'] }).productos, { precio: 13990 })
  assert.equal(sinKit.delNicho, 8)
})

test('rivalesDeGama: los ganadores salen de la gama; sin con qué comparar, del nicho menos lo sacado', () => {
  const { productos } = marcarGama(SCAN, { precio: 13990, propios: ['MLC4607442466'] })
  const r = rivalesDeGama(productos, elegirGanadores, { excluirSkus: ['MLC4607442466'] })
  assert.equal(r.de, 'gama')
  assert.ok(r.ganadores.every((g) => g.enGama))
  assert.ok(!r.ganadores.some((g) => g.sku === 'magic'), 'la de $5.700 ya no es su rival')
  // gama sin reseñas: cae al nicho, sin lo que el importador sacó
  const angosta = marcarGama(SCAN, { precio: 30000, gama: { sacadas: ['rayun'] }, propios: ['MLC4607442466'] }).productos
  const n = rivalesDeGama(angosta, elegirGanadores)
  assert.equal(n.de, 'nicho')
  assert.ok(!n.ganadores.some((g) => g.sku === 'rayun'))
})

test('aplicarCambioGama: rango propio, vuelta al automático, y cada publicación en una sola lista', () => {
  let g = aplicarCambioGama(null, { desde: 12000, hasta: 25000 })
  assert.equal(g.desde, 12000)
  assert.equal(g.hasta, 25000)
  g = aplicarCambioGama(g, { sacar: 'reforzada30' })
  g = aplicarCambioGama(g, { agregar: 'kit' })
  assert.deepEqual(g.sacadas, ['reforzada30'])
  assert.deepEqual(g.agregadas, ['kit'])
  g = aplicarCambioGama(g, { agregar: 'reforzada30' })
  assert.deepEqual(g.sacadas, [], 'sumarla la saca de las sacadas')
  assert.deepEqual(g.agregadas.sort(), ['kit', 'reforzada30'])
  g = aplicarCambioGama(g, { restaurar: 'kit', automatico: true })
  assert.deepEqual(g.agregadas, ['reforzada30'])
  assert.equal(g.desde, null)
  assert.equal(g.hasta, null)
})

test('precioDePropio: la promo vigente, si no el precio efectivo, si no el de lista', () => {
  assert.equal(precioDePropio({ mediciones: [{ precio: 13990 }] }), 13990)
  assert.equal(precioDePropio({ mediciones: [{ precio: 13990, precioEfectivo: 12990 }] }), 12990)
  assert.equal(precioDePropio({ promoMl: { activa: { precio: 11990 } }, mediciones: [{ precio: 13990 }] }), 11990)
  assert.equal(precioDePropio({}), null)
})
