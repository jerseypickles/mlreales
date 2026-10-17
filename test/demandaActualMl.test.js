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

// El 14-oct-2026 ML cerró el ranking a la app (403). Sin esto, a los pocos días
// todo nicho sin baja de stock pasaba a "no se ve" y los abiertos desde el 4-oct
// recibían la alerta de nicho muerto por falta de dato, no de venta.
test('demanda actual: sin ranking en la ventana, no aparecer no es falta de demanda', async () => {
  assert.equal(lecturaDemanda({ ranking: { productos: 0 }, stock: null, rankingDisponible: false }).hayDemanda, null)
  assert.equal(lecturaDemanda({ ranking: { productos: 0 }, stock: { vendiendo: 0 }, rankingDisponible: false }).hayDemanda, null)
  assert.equal(lecturaDemanda({ ranking: { productos: 0 }, stock: { vendiendo: 1 }, rankingDisponible: false }).hayDemanda, true, 'la baja de stock sigue diciendo que sí')
  assert.equal(lecturaDemanda({ ranking: { productos: 2 }, stock: null, rankingDisponible: false }).hayDemanda, true, 'lo visto antes del cierre cuenta')
  assert.equal(lecturaDemanda({ ranking: { productos: 0 }, stock: null }).ranking.disponible, true)
  const ahora = new Date('2026-11-01T12:00:00Z')
  assert.equal(sinDemandaActual({ demandaMl: { hayDemanda: null }, creadoEl: new Date('2026-10-10') }, ahora), false, 'sin dato no hay alerta')
})

test('demanda actual: un día con 1 o 2 categorías sueltas no es un día con ranking', async () => {
  const { huboRanking } = await import('../src/services/demandaActualMl.js')
  const semana = (desde) => Array.from({ length: 7 }, (_, k) => `2026-10-${String(desde + k).padStart(2, '0')}`)
  // capturas reales por día alrededor del cierre
  const porDia = new Map([['2026-10-10', 1729], ['2026-10-11', 1723], ['2026-10-12', 1717], ['2026-10-13', 1709], ['2026-10-14', 1], ['2026-10-15', 2], ['2026-10-16', 2]])
  assert.equal(huboRanking(new Map(semana(1).map((d) => [d, 1700])), semana(1)), true)
  assert.equal(huboRanking(porDia, semana(10)), true, '4 días con ranking todavía alcanzan')
  assert.equal(huboRanking(porDia, semana(11)), false, '3 no')
})

test('ranking de tus productos: el día sin captura de su categoría no es "fuera del top 20"', async () => {
  const { serieConCaptura } = await import('../src/services/demandaActualMl.js')
  const serie = [{ dia: 'd1', mejor: 11 }, { dia: 'd2', mejor: null }, { dia: 'd3', mejor: null }]
  const capturadas = new Map([['d1', new Set(['MLC389306'])], ['d2', new Set(['MLC389306'])], ['d3', new Set(['OTRA'])]])
  assert.deepEqual(serieConCaptura(serie, 'MLC389306', capturadas), [{ dia: 'd1', puesto: 11 }, { dia: 'd2', puesto: null }, { dia: 'd3', puesto: null, sinCaptura: true }])
  assert.deepEqual(serieConCaptura(serie, null, capturadas).map((d) => d.sinCaptura), [undefined, undefined, undefined], 'sin categoría conocida no se inventa')
})

test('ranking en el tiempo: la tendencia pide las dos ventanas casi completas (un día sin captura promedia como cero)', async () => {
  const { hayTendencia } = await import('../src/services/demandaActualMl.js')
  const dias = Array.from({ length: 21 }, (_, k) => new Date(Date.UTC(2026, 8, 26 + k)).toISOString().slice(0, 10)) // 26-sep → 16-oct
  const completo = new Map(dias.map((d) => [d, 1700]))
  assert.equal(hayTendencia(completo, dias), true)
  const unHueco = new Map(completo); unHueco.set('2026-10-12', 0)
  assert.equal(hayTendencia(unHueco, dias), true, 'un día perdido en la semana se tolera')
  // el cierre: capturas reales del 14 al 16-oct
  const cierre = new Map(completo); cierre.set('2026-10-14', 1); cierre.set('2026-10-15', 2); cierre.set('2026-10-16', 2)
  assert.equal(hayTendencia(cierre, dias), false)
  const antesFlojo = new Map(completo); for (const d of dias.slice(0, 3)) antesFlojo.set(d, 0)
  assert.equal(hayTendencia(antesFlojo, dias), false, 'tres días perdidos en las dos semanas de antes tampoco')
})
