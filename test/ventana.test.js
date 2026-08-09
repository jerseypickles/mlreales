import test from 'node:test'
import assert from 'node:assert/strict'
import { inicioDelPico, ventanaDeCompra, mesChile } from '../src/services/ventana.js'

// Referencia: el tablero real al 9-ago-2026 (verano chileno = dic-feb).
const HOY = new Date('2026-08-09T15:00:00Z')
const estacional = (...mesesPico) => ({ estacionalidad: { tipo: 'estacional', mesesPico } })

test('inicioDelPico: el mes que abre la temporada, aunque cruce el año', () => {
  assert.equal(inicioDelPico(['diciembre', 'enero', 'febrero']), 12)
  assert.equal(inicioDelPico(['noviembre', 'diciembre', 'enero', 'febrero']), 11)
  assert.equal(inicioDelPico(['octubre', 'noviembre', 'diciembre']), 10)
  assert.equal(inicioDelPico(['agosto', 'septiembre']), 8)
  assert.equal(inicioDelPico([]), null)
  assert.equal(inicioDelPico(['mes inventado']), null)
})

test('árbol de navidad (pico nov): en agosto la ventana está ABIERTA', () => {
  const v = ventanaDeCompra(estacional('noviembre', 'diciembre'), { hoy: HOY })
  assert.equal(v.estado, 'ahora')
  assert.equal(v.desde, '2026-07')
  assert.equal(v.hasta, '2026-09')
  assert.equal(v.pico, '2026-11')
})

test('manguera extensible (pico oct): agosto es el ÚLTIMO mes para alcanzar', () => {
  const v = ventanaDeCompra(estacional('octubre', 'noviembre', 'diciembre'), { hoy: HOY })
  assert.equal(v.estado, 'ultimo-mes')
  assert.equal(v.hasta, '2026-08')
})

test('piscina inflable (pico dic): ventana abierta hasta octubre', () => {
  const v = ventanaDeCompra(estacional('diciembre', 'enero', 'febrero'), { hoy: HOY })
  assert.equal(v.estado, 'ahora')
  assert.equal(v.desde, '2026-08')
  assert.equal(v.hasta, '2026-10')
})

test('parka niño (pico jun-ago): la temporada ya se perdió, apunta al año que viene', () => {
  const v = ventanaDeCompra(estacional('junio', 'julio', 'agosto'), { hoy: HOY })
  assert.equal(v.perdioLaTemporada, true)
  assert.equal(v.desde, '2027-02')
  assert.equal(v.hasta, '2027-04')
  assert.equal(v.estado, 'futura')
  assert.equal(v.mesesAl, 6)
})

test('disfraz fiestas patrias (pico ago-sep): estás DENTRO del pico, ya no alcanzas', () => {
  const v = ventanaDeCompra(estacional('agosto', 'septiembre'), { hoy: HOY })
  assert.equal(v.perdioLaTemporada, true)
  assert.equal(v.desde, '2027-04')
  assert.equal(v.estado, 'futura')
})

test('vuelta a clases (pico marzo): la ventana abre en noviembre, todavía no toca', () => {
  const v = ventanaDeCompra(estacional('marzo'), { hoy: HOY })
  assert.equal(v.desde, '2026-11')
  assert.equal(v.estado, 'futura')
  assert.equal(v.mesesAl, 3)
  // ya en octubre pasa a "pronto"
  const enOctubre = ventanaDeCompra(estacional('marzo'), { hoy: new Date('2026-10-05T15:00:00Z') })
  assert.equal(enOctubre.estado, 'pronto')
})

test('todo el año y tendencia: no tienen ventana, no estorban el orden', () => {
  const v = ventanaDeCompra({ estacionalidad: { tipo: 'todo_el_año' } }, { hoy: HOY })
  assert.equal(v.estado, 'sin-temporada')
  assert.equal(v.desde, null)
  assert.equal(ventanaDeCompra({ estacionalidad: { tipo: 'tendencia' } }, { hoy: HOY }).estado, 'sin-temporada')
})

test('sin señal de temporada devuelve null (no inventa una ventana)', () => {
  assert.equal(ventanaDeCompra({}, { hoy: HOY }), null)
  assert.equal(ventanaDeCompra({ estacionalidad: null }, { hoy: HOY }), null)
  assert.equal(ventanaDeCompra({ estacionalidad: { tipo: 'estacional', mesesPico: [] } }, { hoy: HOY }), null)
})

test('la ventana del analista manda sobre el cálculo del pico', () => {
  const v = ventanaDeCompra(
    { ventanaCompra: { desde: '2026-08', hasta: '2026-11', motivo: 'pico de primavera' }, ...estacional('marzo') },
    { hoy: HOY },
  )
  assert.equal(v.fuente, 'analisis')
  assert.equal(v.desde, '2026-08')
  assert.equal(v.estado, 'ahora')
  assert.equal(v.motivo, 'pico de primavera')
})

test('una ventana del analista ya vencida cae al cálculo del pico', () => {
  const v = ventanaDeCompra(
    { ventanaCompra: { desde: '2026-01', hasta: '2026-03' }, ...estacional('diciembre') },
    { hoy: HOY },
  )
  assert.equal(v.fuente, 'estacionalidad')
  assert.equal(v.estado, 'ahora')
})

test('mesChile: el mes en hora de Chile, no en UTC', () => {
  // 02:00 UTC del 1-sep = 22:00 del 31-ago en Chile
  assert.equal(mesChile(new Date('2026-09-01T02:00:00Z')), '2026-08')
  assert.equal(mesChile(new Date('2026-09-01T13:00:00Z')), '2026-09')
})
