import test from 'node:test'
import assert from 'node:assert/strict'
import { economiaVenta, planDeArranque, revisarCampana, marcadorSemanal } from '../src/services/ml/planCampanas.js'

const P = { roas: { mediana: 2.68, p75: 2.77 }, ventasAdsPorDia: 0.57 }

test('economiaVenta: sin costo es techo; con costo, el empate de verdad', () => {
  const e = economiaVenta({ precio: 13990, envio: 1004 })
  assert.equal(e.esTecho, true)
  assert.equal(e.deja, 13990 - Math.round(13990 * 0.17) - 1004)
  const c = economiaVenta({ precio: 13990, envio: 1004, costo: 3000 })
  assert.equal(c.esTecho, false)
  assert.ok(c.roasEmpate > e.roasEmpate)
})

test('planDeArranque: ticket sano arranca con budget, ROAS y dos niveles; ticket bajo va orgánico', () => {
  const alto = planDeArranque(economiaVenta({ precio: 13990, envio: 1004, costo: 3000 }), P)
  assert.equal(alto.accion, 'arrancar')
  assert.ok(alto.budgetDiario >= 1000 && alto.budgetDiario % 500 === 0)
  assert.equal(alto.niveles.semana2, alto.budgetDiario * 2)
  assert.ok(alto.roasObjetivo >= P.roas.mediana * 0.9)
  const bajo = planDeArranque(economiaVenta({ precio: 3990, envio: 800, costo: 1200 }), P)
  assert.equal(bajo.accion, 'organico')
  assert.equal(bajo.budgetDiario, 0)
  const pierde = planDeArranque(economiaVenta({ precio: 2990, envio: 800, costo: 2000 }), P)
  assert.equal(pierde.accion, 'no-anunciar')
})

const dia = (i, extra) => ({ dia: `2026-10-${String(i + 10).padStart(2, '0')}`, gasto: 2000, unidadesAds: 1, ventaAds: 13990, unidades: 2, ...extra })

test('revisarCampana: espera al principio, dobla en semana 1 si deja plata, apaga si pierde en el ajuste', () => {
  const eco = economiaVenta({ precio: 13990, envio: 1004, costo: 3000 })
  assert.equal(revisarCampana([0, 1, 2].map((i) => dia(i)), eco, P).accion, 'esperar')
  const s1 = revisarCampana([0, 1, 2, 3, 4, 5].map((i) => dia(i)), eco, P)
  assert.equal(s1.fase, 'semana-1')
  assert.equal(s1.accion, 'subir')
  assert.equal(s1.budgetDiario, 4000)
  const pierde = Array.from({ length: 18 }, (_, i) => dia(i, { gasto: 9000, unidadesAds: 0.3, ventaAds: 4197 }))
  const r = revisarCampana(pierde, eco, P)
  assert.equal(r.fase, 'ajuste')
  assert.equal(r.accion, 'apagar')
  assert.ok(r.metricas.resultado7 < 0)
})

test('revisarCampana: gasta sin vender nada → bajar a la mitad aunque sea temprano', () => {
  const eco = economiaVenta({ precio: 13990, envio: 1004, costo: 3000 })
  const r = revisarCampana([0, 1, 2].map((i) => dia(i, { gasto: 9000, unidadesAds: 0, ventaAds: 0 })), eco, P)
  assert.equal(r.accion, 'bajar')
  assert.equal(r.budgetDiario, 4500)
})

test('marcadorSemanal: plata que dejaron las ventas por anuncio menos el gasto, por semana', () => {
  const eco = { deja: 5000 }
  const m = marcadorSemanal([{ eco, dias: [{ dia: '2026-10-12', gasto: 3000, unidadesAds: 1 }, { dia: '2026-10-13', gasto: 3000, unidadesAds: 0 }, { dia: '2026-10-19', gasto: 1000, unidadesAds: 1 }] }])
  assert.equal(m.length, 2)
  assert.deepEqual(m.map((s) => s.resultado), [-1000, 4000])
})
