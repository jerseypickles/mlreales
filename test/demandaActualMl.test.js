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

test('ranking en el tiempo: el nicho sube si aparece más o mejora de puesto, baja si se cae', async () => {
  const { serieRanking, tendenciaRanking, ajustePorRanking } = await import('../src/services/demandaActualMl.js')
  const dias = Array.from({ length: 21 }, (_, k) => `2026-09-${String(10 + k).padStart(2, '0')}`)
  // antes en el puesto 15 un solo producto; la última semana dos productos y el mejor en el 4
  const indice = new Map([
    ['A', dias.map((dia, k) => ({ dia, posicion: k < 14 ? 15 : 4 }))],
    ['B', dias.slice(14).map((dia) => ({ dia, posicion: 9 }))],
  ])
  const t = tendenciaRanking(serieRanking(['A', 'B', 'X'], indice, dias))
  assert.equal(t.estado, 'sube')
  assert.equal(t.mejorAhora, 4)
  assert.equal(ajustePorRanking(t), 3)
  const cae = new Map([['A', dias.slice(0, 14).map((dia) => ({ dia, posicion: 6 }))]])
  assert.equal(tendenciaRanking(serieRanking(['A'], cae, dias)).estado, 'baja')
  assert.equal(ajustePorRanking({ estado: 'baja' }), -2)
  assert.equal(tendenciaRanking(serieRanking(['Z'], cae, dias)).estado, 'fuera')
  assert.equal(ajustePorRanking({ estado: 'estable', mejorAhora: 3 }), 2, 'estable y arriba del top 5')
})

test('ranking de tus productos: se busca por producto de usuario y catálogo, no por id de publicación', async () => {
  const { serieRanking } = await import('../src/services/demandaActualMl.js')
  const dias = ['2026-10-06', '2026-10-07']
  const indice = new Map([['MLCU123', [{ dia: '2026-10-07', posicion: 7 }]]])
  const s = serieRanking(['MLCU123', 'MLC999', 'MLC4212659314'], indice, dias)
  assert.deepEqual(s.map((d) => d.mejor), [null, 7])
})

test('ranking en el tiempo: un cambio chico no es tendencia (19,9 → 18,6 productos es estable)', async () => {
  const { tendenciaRanking } = await import('../src/services/demandaActualMl.js')
  const serie = [...Array.from({ length: 14 }, (_, k) => ({ dia: `a${k}`, productos: 20, mejor: 1 })), ...Array.from({ length: 7 }, (_, k) => ({ dia: `b${k}`, productos: 18.6, mejor: 1 }))]
  assert.equal(tendenciaRanking(serie).estado, 'estable')
})
