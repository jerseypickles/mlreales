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
  assert.equal(revisarCampana(pierde, eco, P, { diasCorriendo: 60 }).fase, 'regular')
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
  const eco2 = economiaVenta({ precio: 10000, envio: 800, costo: 1000 }) // deja 6.500 a precio de lista
  const m = marcadorSemanal([{ eco: eco2, dias: [{ dia: '2026-10-12', gasto: 3000, unidadesAds: 1, ventaAds: 10000 }, { dia: '2026-10-13', gasto: 3000, unidadesAds: 0 }, { dia: '2026-10-19', gasto: 1000, unidadesAds: 1, ventaAds: 8000 }] }])
  assert.equal(m.length, 2)
  // la segunda venta se cobró a $8.000 (promo): deja 8000·0,83 − 1800 = 4.840
  assert.deepEqual(m.map((s) => s.resultado), [6500 - 6000, 4840 - 1000])
  void eco
})

test('revisarCampana: deja plata en promedio pero gasta muy sobre el óptimo → bajar hacia el óptimo', () => {
  const eco = economiaVenta({ precio: 4000, envio: 800 })
  const dias = Array.from({ length: 10 }, (_, i) => dia(i, { gasto: 3000, unidadesAds: 1.5, ventaAds: 6000, unidades: 1.2 }))
  const r = revisarCampana(dias, eco, P, { beta: 0.78, diasCorriendo: 60 })
  assert.ok(r.metricas.resultado7 > 0)
  assert.ok(r.metricas.budgetOptimoAprendido < 3000)
  assert.equal(r.accion, 'bajar')
  assert.ok(r.budgetDiario < 3000 && r.budgetDiario >= r.metricas.budgetOptimoAprendido)
})

test('revisarCampana: con menos de 1 venta al día no usa el óptimo aprendido', () => {
  const eco = economiaVenta({ precio: 4500, envio: 800 })
  const dias = Array.from({ length: 10 }, (_, i) => dia(i, { gasto: 500, unidadesAds: 0.4, ventaAds: 1800, unidades: 0.5 }))
  const r = revisarCampana(dias, eco, P, { beta: 0.78, diasCorriendo: 60 })
  assert.equal(r.metricas.budgetOptimoAprendido, null)
  assert.notEqual(r.accion, 'bajar')
})

import { transicionesSemanales, aprenderUmbral, evaluarRecomendaciones } from '../src/services/ml/planCampanas.js'
import { ajustarRidge } from '../src/services/ml/regresion.js'

// historia sintética: subir el gasto deja más plata SOLO cuando el ROAS está
// sobre 1,6× el empate (el umbral "verdadero" que el modelo debe encontrar)
function historia({ umbralVerdadero = 1.6, semanas = 40, productos = 3 } = {}) {
  let s = 5
  const azar = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const trans = []
  for (let k = 0; k < productos * semanas; k++) {
    const ratio = 0.8 + azar() * 2
    const dlog = (azar() - 0.5) * 1.6
    const dplata = dlog * (ratio - umbralVerdadero) * 3 + (azar() - 0.5) * 0.5
    trans.push({ desde: `2026-${String(7 + (k % 3)).padStart(2, '0')}-${String(1 + (k % 28)).padStart(2, '0')}`, ratio, dlog, dplata })
  }
  return trans
}

test('aprenderUmbral: encuentra el ROAS sobre el cual subir deja plata, y lo mezcla con la regla inicial según la muestra', () => {
  const r = aprenderUmbral(historia(), { ajustar: ajustarRidge })
  assert.equal(r.estado, 'aprendido')
  assert.ok(Math.abs(r.aprendido - 1.6) < 0.2, `aprendido ${r.aprendido}`)
  assert.ok(r.peso > 0.7)
  assert.ok(r.umbral > 1.3 && r.umbral <= r.aprendido + 0.01)
  const pocos = aprenderUmbral(historia().slice(0, 8), { ajustar: ajustarRidge })
  assert.equal(pocos.estado, 'pocos-casos')
  assert.equal(pocos.umbral, 1.3)
})

test('transicionesSemanales: la semana sin stock (sin ventas ni gasto) no enseña', () => {
  const eco = { precio: 4000, comisionPct: 17, envio: 800, costo: null }
  const d = (i, gasto, unidades, extra) => ({ dia: `2026-08-${String(i + 1).padStart(2, '0')}`, gasto, unidadesAds: unidades / 2, ventaAds: unidades / 2 * 4000, unidades, precio: 4000, ...extra })
  const dias = [
    ...Array.from({ length: 7 }, (_, i) => d(i, 2000, 2)),
    ...Array.from({ length: 7 }, (_, i) => d(i + 7, 4000, 3)),
    ...Array.from({ length: 7 }, (_, i) => d(i + 14, 0, 0)),
  ]
  const t = transicionesSemanales(dias, eco)
  assert.equal(t.length, 1)
  assert.ok(t[0].dlog > 0)
})

test('evaluarRecomendaciones: cuenta si se siguió y si la plata mejoró', () => {
  const eco = { deja: 2000 }
  const dias = Array.from({ length: 20 }, (_, i) => ({ dia: `2026-10-${String(i + 1).padStart(2, '0')}`, gasto: i < 7 ? 1000 : 2000, unidades: i < 7 ? 1 : 2 }))
  const e = evaluarRecomendaciones([{ itemId: 'A', dia: '2026-10-07', accion: 'subir' }], new Map([['A', dias]]), new Map([['A', eco]]), { hoy: '2026-10-30' })
  assert.equal(e.evaluadas, 1)
  assert.equal(e.seguidas, 1)
  assert.equal(e.aciertos, 1)
  assert.equal(e.tasaAcierto, 100)
})

import { estructuraCampanas } from '../src/services/ml/planCampanas.js'
test('estructuraCampanas: una campaña con todo mezclado → pausar lo que pierde, separar el grande, agrupar los chicos', () => {
  const campanas = [{ id: 1, nombre: 'Campaña 1', estado: 'active', presupuestoDiario: 3500, roasObjetivo: 2.6 }, { id: 2, nombre: 'Vieja', estado: 'paused' }]
  const porItem = { set8: { campanaId: 1, estado: 'active' }, tiro: { campanaId: 1, estado: 'active' }, set18: { campanaId: 1, estado: 'active' }, lampara: { campanaId: 1, estado: 'hold' }, set10: { campanaId: 1, estado: 'active' } }
  const planes = [
    { itemId: 'set8', titulo: 'Brochas Maquillaje Set 8 Organizador', accion: 'bajar', budgetDiario: 2000, roasObjetivo: 2.7, economia: { roasEmpate: 1.53 } },
    { itemId: 'tiro', titulo: 'Pistola Juguete Lanzador Dardos', accion: 'subir', budgetDiario: 1000, roasObjetivo: 2.7, economia: { roasEmpate: 1.53 } },
    { itemId: 'set18', titulo: 'Brochas Set 18', accion: 'apagar', budgetDiario: 0, economia: { roasEmpate: 1.49 } },
    { itemId: 'set10', titulo: 'Brochas Set 10', accion: 'esperar', budgetDiario: 500, roasObjetivo: 2.7, economia: { roasEmpate: 1.66 } },
    { itemId: 'lampara', titulo: 'Lampara Uñas', accion: 'apagada', budgetDiario: 0, economia: { roasEmpate: 1.34 } },
    { itemId: 'nuevo', titulo: 'Mochila Nueva', accion: 'arrancar', budgetDiario: 3000, roasObjetivo: 2.4, economia: { roasEmpate: 1.9 } },
  ]
  const e = estructuraCampanas({ campanas, porItem, planes })
  assert.equal(e.campanas.length, 1)
  assert.equal(e.campanas[0].compartida, true)
  const tipos = e.acciones.map((a) => `${a.tipo}:${a.itemId ?? ''}`)
  assert.ok(tipos.includes('pausar-anuncio:set18'))
  assert.ok(tipos.includes('separar:set8'))
  assert.ok(tipos.includes('campana-propia:tiro'))
  assert.ok(tipos.includes('agrupar-chicos:'))
  assert.ok(tipos.includes('crear:nuevo'))
  assert.ok(!tipos.some((t) => t.includes('lampara'))) // sin stock (hold): no se toca
  assert.equal(e.acciones[0].tipo, 'pausar-anuncio')
})
