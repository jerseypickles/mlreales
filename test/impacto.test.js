import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluarImpacto, intervencionesDe } from '../src/services/impacto.js'

const dia = (n) => new Date(Date.UTC(2026, 7, n))
const ahora = dia(30)

// serie diaria: visitas bajas hasta el día 10, altas después
const propioBase = {
  historialTitulos: [{ fecha: dia(10), anterior: 'Set Tiro Al Blanco', nuevo: 'Pistola Juguete Dardos' }],
  auditoria: { aplicado: [{ campo: 'descripcion', fecha: dia(9), valor: 'desc nueva' }] },
  mediciones: [
    ...[3, 4, 5, 6, 7, 8, 9].map((d) => ({ fecha: dia(d), visitas: 2, numReviews: 0 })),
    ...[11, 12, 13, 14, 15, 16, 17].map((d) => ({ fecha: dia(d), visitas: 3, numReviews: 0 })),
    ...[18, 19, 20, 21, 22].map((d, i) => ({ fecha: dia(d), visitas: 20, numReviews: i })),
  ],
}

test('intervencionesDe: junta cambios de título y aplicaciones por API, ordenados', () => {
  const lista = intervencionesDe(propioBase)
  assert.deepEqual(lista.map((i) => i.tipo), ['descripcion', 'titulo'])
  assert.ok(lista[0].fecha < lista[1].fecha)
})

test('evaluarImpacto: con 7 días limpios dictamina mejora usando la ventana post-cambio', () => {
  const { intervenciones, resumen } = evaluarImpacto(propioBase, { ahora })
  const titulo = intervenciones.find((i) => i.tipo === 'titulo')
  assert.equal(titulo.visitasAntes, 2)
  // solo promedia desde el día 17 (7 días limpios tras el cambio): (3 + 20×5) / 6
  assert.equal(titulo.visitasDespues, 17.2)
  assert.equal(titulo.veredicto, 'mejoró')
  assert.equal(resumen.mejoraron, 1)
})

test('evaluarImpacto: antes de 7 días no inventa veredicto', () => {
  const reciente = {
    historialTitulos: [{ fecha: dia(28), anterior: 'a', nuevo: 'b' }],
    mediciones: [{ fecha: dia(25), visitas: 5 }, { fecha: dia(29), visitas: 40 }],
  }
  const { intervenciones, resumen } = evaluarImpacto(reciente, { ahora })
  assert.equal(intervenciones[0].veredicto, 'midiendo')
  assert.equal(intervenciones[0].visitasDespues, null)
  assert.match(intervenciones[0].lectura, /faltan \d+ para leer el efecto/)
  assert.equal(resumen.midiendo, true)
})

test('evaluarImpacto: caída de visitas se reporta como empeoró', () => {
  const peor = {
    historialTitulos: [{ fecha: dia(10), anterior: 'a', nuevo: 'b' }],
    mediciones: [
      ...[5, 6, 7, 8, 9].map((d) => ({ fecha: dia(d), visitas: 30 })),
      ...[18, 19, 20].map((d) => ({ fecha: dia(d), visitas: 4 })),
    ],
  }
  assert.equal(evaluarImpacto(peor, { ahora }).intervenciones[0].veredicto, 'empeoró')
})

test('evaluarImpacto: sin intervenciones no hay nada que leer', () => {
  assert.deepEqual(evaluarImpacto({ mediciones: [] }), { intervenciones: [], resumen: null })
})

test('intervencionesDe: el cambio de logística (colecta → Full) es intervención medible', () => {
  const its = intervencionesDe({
    historialTitulos: [],
    historialLogistica: [{ fecha: dia(12), anterior: 'xd_drop_off', nuevo: 'fulfillment' }],
  })
  assert.equal(its.length, 1)
  assert.equal(its[0].tipo, 'logistica')
  assert.equal(its[0].nuevo, 'fulfillment')
})
