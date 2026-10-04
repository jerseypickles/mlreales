import test from 'node:test'
import assert from 'node:assert/strict'
import { enRanking, lecturaDemanda, sinDemandaActual, PLAZO_CONFIRMAR_DIAS } from '../src/services/demandaActualMl.js'

test('demanda actual: productos del nicho en el ranking de la semana y su mejor puesto', () => {
  const ranking = new Map([['MLC1', 4], ['MLC2', 12], ['MLCP9', 1]])
  assert.deepEqual(enRanking(['MLC1', 'MLC3', 'MLCP9', 'MLC1'], ranking), { productos: 2, mejorPuesto: 1 })
  assert.deepEqual(enRanking(['MLC7'], ranking), { productos: 0, mejorPuesto: null })
})

test('demanda actual: basta el ranking o la baja de stock; el acumulado "top vendió" no cuenta', () => {
  assert.equal(lecturaDemanda({ ranking: { productos: 1 }, stock: null }).hayDemanda, true)
  assert.equal(lecturaDemanda({ ranking: { productos: 0 }, stock: { vendiendo: 2 } }).hayDemanda, true)
  assert.equal(lecturaDemanda({ ranking: { productos: 0 }, stock: { vendiendo: 0 } }).hayDemanda, false)
})

test('demanda actual: la alerta es solo para nichos nuevos con el plazo cumplido', () => {
  const ahora = new Date('2026-11-01T12:00:00Z')
  const muerto = { demandaMl: { hayDemanda: false } }
  assert.equal(sinDemandaActual({ ...muerto, creadoEl: new Date('2026-10-10') }, ahora), true)
  assert.equal(sinDemandaActual({ ...muerto, creadoEl: new Date('2026-09-20') }, ahora), false, 'anterior a la regla')
  assert.equal(sinDemandaActual({ ...muerto, creadoEl: new Date(+ahora - (PLAZO_CONFIRMAR_DIAS - 2) * 86400e3) }, ahora), false, 'todavía en plazo')
  assert.equal(sinDemandaActual({ demandaMl: { hayDemanda: true }, creadoEl: new Date('2026-10-10') }, ahora), false)
  assert.equal(sinDemandaActual({ creadoEl: new Date('2026-10-10') }, ahora), false, 'sin medir no alerta')
})
