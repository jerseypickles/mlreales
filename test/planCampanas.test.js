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

import { nombreCorto } from '../src/services/ml/planCampanas.js'
test('nombreCorto: distingue productos que empiezan igual', () => {
  assert.equal(nombreCorto('Brochas Maquillaje Profesionales Set 8 + Organizador Rosa'), 'Brochas Maquillaje Set 8')
  assert.equal(nombreCorto('Brochas Maquillaje Profesionales Set 18 Pcs Makeup Cosmetico Gris'), 'Brochas Maquillaje Set 18')
  assert.equal(nombreCorto('Brochas Maquillaje Set 10 Profesionales Estuche'), 'Brochas Maquillaje Set 10')
  assert.equal(nombreCorto('Pistola Juguete Lanzador Dardos Set Tiro'), 'Pistola Juguete Lanzador Dardos Set')
  assert.equal(nombreCorto('Pistola Juguete Dardos Y Balines Tipo Escopeta'), 'Pistola Juguete Dardos Y Balines')
})

import { diaDeCampanaActual } from '../src/services/ml/planCampanas.js'
test('diaDeCampanaActual: detecta el paso a una campaña nueva', () => {
  const f = [{ dia: '2026-09-01', costo: 100, campanaId: 1 }, { dia: '2026-09-20', costo: 100, campanaId: 1 }, { dia: '2026-10-02', costo: 100, campanaId: 9 }, { dia: '2026-10-03', costo: 0, campanaId: 9 }, { dia: '2026-10-04', costo: 80, campanaId: 9 }]
  assert.equal(diaDeCampanaActual(f), '2026-10-02')
  assert.equal(diaDeCampanaActual(f.slice(0, 2)), '2026-09-01')
  assert.equal(diaDeCampanaActual([]), null)
})

test('revisarCampana: una semana en cero con poco gasto no apaga si en 30 días deja plata', () => {
  const eco = economiaVenta({ precio: 3990, envio: 800 }) // deja ~2.512
  const dias = Array.from({ length: 40 }, (_, i) => ({ dia: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, gasto: 200, unidadesAds: i < 33 && i % 6 === 0 ? 1 : 0, ventaAds: i < 33 && i % 6 === 0 ? 3990 : 0, unidades: 1 }))
  const r = revisarCampana(dias, eco, P, { diasCorriendo: 60 })
  assert.ok(r.metricas.resultado7 < 0)
  assert.ok(r.metricas.resultado30 > 0)
  assert.equal(r.accion, 'mantener')
})

test('revisarCampana: con poco gasto y 30 días también en rojo, ahí sí apaga', () => {
  const eco = economiaVenta({ precio: 3990, envio: 800 })
  const dias = Array.from({ length: 40 }, (_, i) => ({ dia: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, gasto: 400, unidadesAds: 0, ventaAds: 0, unidades: 1 }))
  const r = revisarCampana(dias, eco, P, { diasCorriendo: 60 })
  assert.equal(r.accion, 'apagar')
  assert.ok(r.metricas.resultado30 < 0)
})

import { observacionesEstructura, aprenderEstructura } from '../src/services/ml/planCampanas.js'

test('observacionesEstructura: la forma de la campaña de cada producto por semana', () => {
  const eco = { precio: 4000, comisionPct: 17, envio: 800 }
  const ecoDe = new Map([['A', eco], ['B', eco], ['C', eco]])
  const filas = [
    { itemId: 'A', dia: '2026-09-01', campanaId: 1, costo: 3000, unidadesAds: 2, ventaAds: 8000 },
    { itemId: 'B', dia: '2026-09-02', campanaId: 1, costo: 1000, unidadesAds: 0, ventaAds: 0 },
    { itemId: 'C', dia: '2026-09-02', campanaId: 2, costo: 1000, unidadesAds: 1, ventaAds: 4000 },
    { itemId: 'C', dia: '2026-09-03', campanaId: 2, costo: 200, unidadesAds: 0, ventaAds: 0 },
  ]
  const o = observacionesEstructura(filas, ecoDe, new Map([['A', 'n1'], ['B', 'n1']]))
  const a = o.find((x) => x.itemId === 'A'), c = o.find((x) => x.itemId === 'C')
  assert.equal(a.forma, 'chica')
  assert.equal(a.mismoNicho, true)
  assert.equal(a.partGasto, 75)
  assert.equal(c.forma, 'sola')
  assert.equal(c.mismoNicho, null)
})

test('aprenderEstructura: compara al mismo producto consigo mismo; un producto fuerte no se confunde con la forma', () => {
  // 4 productos; cada uno rinde +0,3 por peso más cuando está solo que agrupado,
  // y el producto "fuerte" P0 rinde +2 siempre (eso no es de la forma)
  const obs = []
  for (let p = 0; p < 4; p++) {
    for (let s = 0; s < 4; s++) {
      const base = p === 0 ? 2 : 0.2
      obs.push({ itemId: `P${p}`, semana: `s${s}`, forma: 'sola', mismoNicho: null, rinde: base + 0.3 })
      obs.push({ itemId: `P${p}`, semana: `g${s}`, forma: 'grande', mismoNicho: false, rinde: base })
    }
  }
  // un producto que solo estuvo en campaña grande no informa la comparación
  for (let s = 0; s < 5; s++) obs.push({ itemId: 'SOLO_GRANDE', semana: `x${s}`, forma: 'grande', mismoNicho: false, rinde: 5 })
  const r = aprenderEstructura(obs)
  assert.equal(r.estado, 'aprendido')
  assert.equal(r.productosComparables, 4)
  assert.ok(Math.abs(r.solaVsGrupo - 0.3) < 0.01, `sola vs grupo ${r.solaVsGrupo}`)
  const pocos = aprenderEstructura(obs.filter((o) => o.itemId === 'P0'))
  assert.equal(pocos.estado, 'pocos-casos')
})

test('estructuraCampanas: si lo aprendido dice que solos rinden más, hasta los chicos van solos', () => {
  const campanas = [{ id: 1, nombre: 'Campaña 1', estado: 'active', presupuestoDiario: 3500, roasObjetivo: 2.6 }]
  const porItem = { a: { campanaId: 1, estado: 'active' }, b: { campanaId: 1, estado: 'active' }, c: { campanaId: 1, estado: 'active' } }
  const planes = [
    { itemId: 'a', titulo: 'Producto Grande A', accion: 'mantener', budgetDiario: 2000, roasObjetivo: 2.7, economia: { roasEmpate: 1.5 } },
    { itemId: 'b', titulo: 'Producto Chico B', accion: 'mantener', budgetDiario: 600, roasObjetivo: 2.7, economia: { roasEmpate: 1.6 } },
    { itemId: 'c', titulo: 'Producto Chico C', accion: 'mantener', budgetDiario: 700, roasObjetivo: 2.7, economia: { roasEmpate: 1.6 } },
  ]
  const sinAprender = estructuraCampanas({ campanas, porItem, planes })
  assert.ok(sinAprender.acciones.some((a) => a.tipo === 'agrupar-chicos'))
  const aprendido = estructuraCampanas({ campanas, porItem, planes, formas: { solaVsGrupo: 0.3, porNicho: {} } })
  assert.ok(!aprendido.acciones.some((a) => a.tipo === 'agrupar-chicos'))
  assert.equal(aprendido.acciones.filter((a) => a.tipo === 'campana-propia').length, 2)
})

test('estructuraCampanas: una campaña recién creada no se corrige con el gasto que el producto tenía antes', () => {
  const planes = [{ itemId: 'a', titulo: 'Brochas Set 10', accion: 'mantener', budgetDiario: 152, roasObjetivo: 2.7, economia: { roasEmpate: 1.6 } }]
  const porItem = { a: { campanaId: 9, estado: 'active' } }
  const nueva = estructuraCampanas({ campanas: [{ id: 9, nombre: 'Campaña', estado: 'active', presupuestoDiario: 1000, creadaEl: new Date().toISOString() }], porItem, planes })
  assert.equal(nueva.acciones.length, 0)
  const vieja = estructuraCampanas({ campanas: [{ id: 9, nombre: 'Campaña', estado: 'active', presupuestoDiario: 1000, creadaEl: '2026-07-01T00:00:00Z' }], porItem, planes })
  assert.equal(vieja.acciones[0].tipo, 'ajustar-budget')
})

import { bitacoraProducto } from '../src/services/ml/planCampanas.js'
test('bitacoraProducto: semana a semana, acumulado, tendencia y veredicto de largo plazo', () => {
  const eco = economiaVenta({ precio: 10000, envio: 800, costo: 2000 }) // deja 5.500
  const dia = (n) => new Date(Date.UTC(2026, 9, 5) + n * 86400e3).toISOString().slice(0, 10) // lunes 5-oct
  // 4 semanas: la plata sube semana a semana
  const dias = Array.from({ length: 28 }, (_, i) => ({ dia: dia(i), gasto: 1000, unidadesAds: [0.2, 0.3, 0.5, 0.6][Math.floor(i / 7)], ventaAds: [0.2, 0.3, 0.5, 0.6][Math.floor(i / 7)] * 10000, unidades: 1 }))
  const recs = [{ dia: dia(6), accion: 'subir', budgetDiario: 2000 }]
  const b = bitacoraProducto(dias, eco, recs)
  assert.equal(b.semanas.length, 4)
  assert.equal(b.semanas[0].recomendo.accion, 'subir')
  assert.equal(b.tendencia, 'mejora')
  assert.equal(b.veredicto, 'escalar')
  const pierde = bitacoraProducto(dias.map((d) => ({ ...d, unidadesAds: 0, ventaAds: 0 })), eco)
  assert.equal(pierde.veredicto, 'cortar')
  assert.ok(pierde.acumulado < 0)
  assert.equal(bitacoraProducto(dias.slice(0, 8), eco).veredicto, 'midiendo')
})

test('bitacoraProducto: sin gasto las últimas semanas es "pausado", no "escalar"', () => {
  const eco = economiaVenta({ precio: 10000, envio: 800 })
  const dia = (n) => new Date(Date.UTC(2026, 7, 3) + n * 86400e3).toISOString().slice(0, 10)
  const dias = Array.from({ length: 42 }, (_, i) => (i < 28 ? { dia: dia(i), gasto: 1000, unidadesAds: 1, ventaAds: 10000, unidades: 1 } : { dia: dia(i), gasto: 0, unidadesAds: 0, ventaAds: 0, unidades: 0 }))
  assert.equal(bitacoraProducto(dias, eco).veredicto, 'pausado')
})

test('clic: impresiones de sobra y el CTR cayó contra su propio pasado → "cayo"', async () => {
  const { diagnosticoClic } = await import('../src/services/ml/planCampanas.js')
  // 4 semanas a 0,7% y la última a 0,2%, con ~3.000 impresiones diarias (Set 8 de septiembre)
  const antes = Array.from({ length: 28 }, (_, i) => ({ dia: `d${i}`, prints: 3000, clicks: 21 }))
  const ahora = Array.from({ length: 7 }, (_, i) => ({ dia: `n${i}`, prints: 3000, clicks: 6 }))
  const c = diagnosticoClic([...antes, ...ahora], 0.3)
  assert.equal(c.estado, 'cayo')
  assert.equal(c.ctr7, 0.2)
  assert.equal(c.ctrPrevio, 0.7)
})

test('clic: producto nuevo sin historia con CTR bajo la mitad de la cuenta → "bajo"; poca muestra no juzga', async () => {
  const { diagnosticoClic } = await import('../src/services/ml/planCampanas.js')
  const nuevo = Array.from({ length: 7 }, (_, i) => ({ dia: `n${i}`, prints: 2800, clicks: 2 })) // Set 10: 0,1%
  assert.equal(diagnosticoClic(nuevo, 0.34).estado, 'bajo')
  const chico = Array.from({ length: 7 }, (_, i) => ({ dia: `n${i}`, prints: 100, clicks: 0 }))
  assert.equal(diagnosticoClic(chico, 0.34).estado, 'poca-muestra')
  const sano = Array.from({ length: 7 }, (_, i) => ({ dia: `n${i}`, prints: 3000, clicks: 12 }))
  assert.equal(diagnosticoClic(sano, 0.34).estado, 'normal')
})

test('clic: sin ventas y sin clic, el plan dice revisar el anuncio en vez de tocar el budget', () => {
  const eco = economiaVenta({ precio: 3990, envio: 800 })
  const dias = Array.from({ length: 10 }, (_, i) => ({ dia: `2026-09-${String(20 + i).padStart(2, '0')}`, gasto: 150, unidadesAds: 0, ventaAds: 0, unidades: 0, prints: 2800, clicks: 2 }))
  const r = revisarCampana(dias, eco, P, { diasCorriendo: 10, ctrCuenta: 0.34 })
  assert.equal(r.accion, 'revisar-anuncio')
  assert.equal(r.budgetDiario, 150)
  assert.match(r.texto, /precio contra la competencia/)
})

test('ctrDeCuenta: mediana del CTR de la historia de cada producto con muestra', async () => {
  const { ctrDeCuenta } = await import('../src/services/ml/planCampanas.js')
  const filas = [
    { itemId: 'a', prints: 30000, clicks: 90 }, // 0,3%
    { itemId: 'b', prints: 25000, clicks: 50 }, // 0,2%
    { itemId: 'c', prints: 40000, clicks: 280 }, // 0,7%
    { itemId: 'd', prints: 500, clicks: 50 }, // sin muestra
  ]
  assert.deepEqual(ctrDeCuenta(filas), { ctr: 0.3, productos: 3 })
})

test('clic: si los demás productos, cada uno contra sí mismo, cayeron igual, es el mercado', async () => {
  const { diagnosticoClic } = await import('../src/services/ml/planCampanas.js')
  const dias = Array.from({ length: 35 }, (_, i) => ({ dia: `d${i}`, prints: 3000, clicks: i < 28 ? 21 : 6, gasto: i < 28 ? 2100 : 600 }))
  assert.equal(diagnosticoClic(dias, 0.3, { relMediana: 0.35, ctr7Mediana: 0.2 }).estado, 'cayo-con-el-mercado')
  assert.equal(diagnosticoClic(dias, 0.3, { relMediana: 1, ctr7Mediana: 0.5 }).estado, 'cayo', 'los demás estables: es el anuncio')
})

test('clic: el CTR cae y el clic se abarató mucho → es la puja (ubicaciones más baratas), no el anuncio', async () => {
  const { diagnosticoClic } = await import('../src/services/ml/planCampanas.js')
  // CPC $117 → $62, como el Set 10 en septiembre
  const dias = Array.from({ length: 35 }, (_, i) => i < 28
    ? { dia: `d${i}`, prints: 3000, clicks: 12, gasto: 12 * 117 }
    : { dia: `d${i}`, prints: 3000, clicks: 3, gasto: 3 * 62 })
  const c = diagnosticoClic(dias, 0.3, { relMediana: 1, ctr7Mediana: 0.3 })
  assert.equal(c.estado, 'cayo-por-puja')
  assert.equal(c.cpcPrevio, 117)
  assert.equal(c.cpc7, 62)
})

test('mercadoPara: cada producto contra sí mismo, sin contarse a sí mismo', async () => {
  const { mercadoPara } = await import('../src/services/ml/planCampanas.js')
  const v = (ctrPrevio, ctr7) => ({ prints7: 20000, ctrPrevio, ctr7 })
  const m = mercadoPara('a', new Map([['a', v(1, 0.1)], ['b', v(0.8, 0.4)], ['c', v(0.3, 0.18)], ['d', v(0.2, 0.1)]]))
  assert.equal(m.relMediana, 0.5)
  assert.equal(m.productos, 3)
})

test('clic de la cuenta: si sale un producto de clic alto, el bruto cae y el de mezcla constante no', async () => {
  const { clicPorSemana } = await import('../src/services/ml/planCampanas.js')
  const semana = (lunes, p, c) => Array.from({ length: 7 }, (_, i) => ({ dia: new Date(Date.parse(`${lunes}T12:00:00Z`) + i * 86400e3).toISOString().slice(0, 10), prints: p / 7, clicks: c / 7 }))
  const porProducto = [
    // alto: 1% de CTR, se queda sin stock la segunda semana
    { itemId: 'alto', titulo: 'Brochas Set 9', dias: semana('2026-08-03', 10000, 100) },
    // bajo: 0,2% las dos semanas
    { itemId: 'bajo', titulo: 'Brochas Set 10', dias: [...semana('2026-08-03', 10000, 20), ...semana('2026-08-10', 20000, 40)] },
  ]
  const [s1, s2] = clicPorSemana(porProducto)
  assert.equal(s1.ctrBruto, 0.6)
  assert.equal(s2.ctrBruto, 0.2, 'el bruto cae a un tercio')
  assert.equal(s2.ctrMezclaConstante, 0.6, 'el anuncio que quedó no cambió')
  assert.deepEqual(s2.salieron, ['Brochas Set 9'])
})
