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

test('el lead time se puede correr sin tocar código', () => {
  // si el forwarder tarda más, la ventana entera se adelanta
  const conLeadLargo = ventanaDeCompra(estacional('diciembre'), { hoy: HOY, leadMax: 5, leadMin: 3 })
  assert.equal(conLeadLargo.desde, '2026-07')
  assert.equal(conLeadLargo.hasta, '2026-09')
  assert.deepEqual(conLeadLargo.leadMeses, { min: 3, max: 5 })
  // con lead más largo, un pico de octubre YA no se alcanza desde agosto
  const apretado = ventanaDeCompra(estacional('octubre'), { hoy: HOY, leadMax: 5, leadMin: 3 })
  assert.equal(apretado.perdioLaTemporada, true)
})

test('mesChile: el mes en hora de Chile, no en UTC', () => {
  // 02:00 UTC del 1-sep = 22:00 del 31-ago en Chile
  assert.equal(mesChile(new Date('2026-09-01T02:00:00Z')), '2026-08')
  assert.equal(mesChile(new Date('2026-09-01T13:00:00Z')), '2026-09')
})

test('ventanaDeCompra: la curva medida manda sobre la estacionalidad inferida', () => {
  const hoy = new Date('2026-08-12T12:00:00Z')

  // caso partidor batería: la IA lo leyó como invernal y lo mandó a cuarentena
  // hasta 2027; la curva real da ratio 1,34 = se mueve los 12 meses
  const todoElAno = ventanaDeCompra(
    {
      estacionalidad: { tipo: 'estacional', mesesPico: ['junio', 'julio'] },
      curvaAnual: { clasificacion: 'todo-el-año', mesPico: 7, ratioPico: 1.34 },
    },
    { hoy },
  )
  assert.equal(todoElAno.estado, 'sin-temporada', 'sin pico real, la ventana deja de estorbar')
  assert.equal(todoElAno.fuente, 'curva-medida')

  // caso quitasol: curva medida con pico en enero (ratio 4,52)
  const estacional = ventanaDeCompra(
    { curvaAnual: { clasificacion: 'estacional', mesPico: 1, ratioPico: 4.52 } },
    { hoy },
  )
  assert.equal(estacional.fuente, 'curva-medida')
  assert.equal(estacional.pico, '2027-01')
  assert.equal(estacional.ratioPico, 4.52)

  // sin curva medida se conserva el camino de siempre
  const sinCurva = ventanaDeCompra(
    { ventanaCompra: { desde: '2026-08', hasta: '2026-11', motivo: 'x' } },
    { hoy },
  )
  assert.equal(sinCurva.fuente, 'analisis')
})

test('ventanaDeCompra: un alza suave NO abre ventana de urgencia', () => {
  const hoy = new Date('2026-08-13T12:00:00Z')
  // toallitas húmedas: ratio 1,50 con pico en octubre. Antes esto producía
  // "🔥 último mes para pedir" sobre una curva visualmente plana.
  const v = ventanaDeCompra(
    { curvaAnual: { clasificacion: 'alza-suave', mesPico: 10, nombreMesPico: 'oct', ratioPico: 1.5 } },
    { hoy },
  )
  assert.equal(v.estado, 'sin-temporada', 'no existe "último mes" en un producto de venta pareja')
  assert.equal(v.alzaSuave, true)
  assert.equal(v.mesAlza, 'oct', 'el bulto se conserva como información, no como urgencia')

  // una temporada de verdad sí la abre
  const real = ventanaDeCompra(
    { curvaAnual: { clasificacion: 'estacional', mesPico: 12, ratioPico: 3.94 } },
    { hoy },
  )
  assert.notEqual(real.estado, 'sin-temporada')
})
