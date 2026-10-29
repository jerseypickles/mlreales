import test from 'node:test'
import assert from 'node:assert/strict'
import { disponibilidadPublicidad, protegerPlanPublicidad, carteraCampanas } from '../src/services/ml/carteraCampanas.js'
import { observacionesEstructura, economiaVenta, dejaronDe } from '../src/services/ml/planCampanas.js'
import { serieGrupoPublicidad } from '../frontend/src/lib/seriePublicidad.js'

const ahora = new Date('2026-10-20T15:00:00Z')
const propio = (extra = {}) => ({ estadoMl: 'active', envioMl: { logistica: 'xd_drop_off' }, ultimoScanEl: ahora, mediciones: [{ stock: 30, fecha: ahora }], ...extra })
const producto = (id, extra = {}) => ({ itemId: id, titulo: `Producto ${id}`, accion: 'arrancar-con-cuidado', budgetDiario: 1500, roasObjetivo: 4,
  economia: { precio: 12000, deja: 4000, comisionPct: 15, envio: 700, costo: 5500 }, disponibilidad: { disponible: true, estado: 'disponible', stock: 30 }, ...extra })

test('disponibilidad: stock cero prevalece sobre anuncio activo y hold no prueba por sí solo falta de stock', () => {
  assert.equal(disponibilidadPublicidad(propio({ mediciones: [{ stock: 0 }] }), { estado: 'active' }, { ahora }).estado, 'sin-stock')
  const hold = disponibilidadPublicidad(propio(), { estado: 'hold' }, { ahora })
  assert.equal(hold.estado, 'retenida')
  assert.equal(hold.stock, 30)
  assert.equal(disponibilidadPublicidad(propio({ estadoMl: 'closed' }), null, { ahora }).estado, 'finalizada')
  assert.equal(disponibilidadPublicidad(propio({ ultimoScanEl: '2026-10-10' }), null, { ahora }).estado, 'sin-dato')
})

test('inventario de vendedor no se confunde con Full y dato ausente no vale cero', () => {
  const d = disponibilidadPublicidad(propio({ inventarioFull: { disponible: 0, declaraElItem: 25 }, mediciones: [{ stock: 0 }] }), null, { ahora })
  assert.equal(d.stock, 25)
  assert.equal(d.disponible, true)
  assert.equal(disponibilidadPublicidad(propio({ envioMl: { logistica: 'fulfillment' } }), null, { ahora }).stock, null)
})

test('sin stock o sin costos nunca propone iniciar ni subir; cobertura corta protege un aumento', () => {
  const plan = producto('a', { accion: 'subir' })
  const ad = { estado: 'active' }, campana = { estado: 'active', presupuestoDiario: 1200 }
  assert.equal(protegerPlanPublicidad(plan, propio({ mediciones: [{ stock: 0 }] }), ad, campana, { ahora }).budgetDiario, 0)
  const sinCosto = protegerPlanPublicidad({ ...plan, economia: { esTecho: true } }, propio(), null, null, { ahora })
  assert.equal(sinCosto.accion, 'completar-economia'); assert.equal(sinCosto.budgetDiario, null)
  const conPoco = protegerPlanPublicidad(plan, propio({ mediciones: [{ stock: 3 }] }), ad, campana, { ahora, dias: Array.from({ length: 7 }, () => ({ unidades: 2 })) })
  assert.equal(conPoco.accion, 'reponer-stock'); assert.equal(conPoco.budgetDiario, 1200)
})

test('familia oficial comparte presupuesto; variantes sin stock quedan fuera de la propuesta', () => {
  const familia = { id: 'familia-a', nombre: 'Producto de colores' }
  const ps = [producto('a', { familia }), producto('b', { familia }), producto('c', { familia, accion: 'sin-stock', disponibilidad: { disponible: false, stock: 0, estado: 'sin-stock' } })]
  const c = carteraCampanas({ productos: ps, ahora })
  assert.equal(c.grupos.length, 1); assert.equal(c.propuestas.length, 1)
  assert.equal(c.propuestas[0].presupuestoDiario, 1500)
  assert.deepEqual(c.propuestas[0].itemIds, ['a', 'b'])
  assert.equal(c.propuestas[0].excluidos[0].itemId, 'c')
})

test('idle con identificador residual sigue siendo un producto disponible sin campaña', () => {
  const p = protegerPlanPublicidad(producto('a'), propio(), { estado: 'idle', campanaId: 99 }, null, { ahora })
  assert.equal(p.campanaId, null)
  assert.equal(carteraCampanas({ productos: [p], ahora }).propuestas.length, 1)
})

test('nicho compartido requiere etapa y economía compatibles; no mezcla campañas ya existentes', () => {
  const ps = [producto('a', { nichoId: 'n' }), producto('b', { nichoId: 'n', roasObjetivo: 4.5 }), producto('c', { nichoId: 'n', roasObjetivo: 8 }), producto('d', { nichoId: 'n', campanaId: 1, accion: 'mantener' })]
  const c = carteraCampanas({ productos: ps, ahora })
  assert.equal(c.propuestas.length, 2)
  assert.deepEqual(c.propuestas[0].itemIds, ['a', 'b'])
  assert.equal(c.propuestas[0].presupuestoDiario, 3000)
  assert.equal(c.propuestas[0].roasObjetivo, 4.5)
  assert(c.propuestas.every(p => !p.itemIds.includes('d')))
  const solas = carteraCampanas({ productos: ps, formas: { estado: 'aprendido', solaVsGrupo: 0.3 }, ahora })
  assert.equal(solas.propuestas.length, 3)
})

test('no mezcla productos sin nicho ni toma toda una familia con estado desconocido como elegible', () => {
  const c = carteraCampanas({ productos: [producto('a'), producto('b'), producto('c', { disponibilidad: { disponible: false, stock: null } })], ahora })
  assert.equal(c.propuestas.length, 2)
  assert.equal(c.grupos[2].stock, null)
})

test('campaña activa sin elegibles se distingue de campaña pausada y de la parcialmente disponible', () => {
  const c = carteraCampanas({ ahora, productos: [producto('a'), producto('b', { disponibilidad: { disponible: false, stock: 0 } })],
    campanas: [{ id: 1, estado: 'active' }, { id: 2, estado: 'paused' }, { id: 3, estado: 'active' }],
    porItem: { a: { campanaId: 3, estado: 'active' }, b: { campanaId: 1, estado: 'hold' }, c: { campanaId: 3, estado: 'hold' } } })
  assert.equal(c.campanas[0].atencion, 'sin-productos-disponibles')
  assert.equal(c.campanas[1].atencion, null)
  assert.equal(c.campanas[2].aptos, 1)
  assert.equal(c.campanas[2].atencion, 'parcial')
})

test('aprendizaje de estructura cuenta familias, sin multiplicar las observaciones por color', () => {
  const filas = ['a', 'b', 'c'].map(itemId => ({ itemId, dia: '2026-10-12', campanaId: 1, costo: 1000, unidadesAds: 1, ventaAds: 10000 }))
  const eco = new Map(filas.map(f => [f.itemId, { precio: 10000, comisionPct: 15, envio: 500, costo: 2000, cargoFijo: 0 }]))
  const familia = new Map(filas.map(f => [f.itemId, 'familia-a']))
  const obs = observacionesEstructura(filas, eco, new Map(), familia)
  assert.equal(obs.length, 1); assert.equal(obs[0].forma, 'sola'); assert.equal(obs[0].productos, 1)
  assert.equal(obs[0].gasto, 3000); assert.equal(obs[0].partGasto, 100)
})

test('serie familiar suma fechas observadas y declara costo pendiente sin inventar rentabilidad', () => {
  const g = { miembros: [producto('a'), producto('b', { economia: { esTecho: true } })] }
  const s = serieGrupoPublicidad(g, { a: [{ dia: '2026-10-10', gasto: 200, unidadesAds: 1, ventaAds: 12000 }], b: [{ dia: '2026-10-10', gasto: 300, unidadesAds: 0 }] })
  assert.equal(s.length, 1); assert.equal(s[0].gasto, 500); assert.equal(s[0].unidadesAds, 1); assert.equal(s[0].costoCompleto, false)
})

test('economía del plan respeta la comisión exacta y su cargo fijo', () => {
  const eco = economiaVenta({ precio: 10000, comisionPct: 13, comisionClp: 1700, envio: 500, costo: 2000 })
  assert.equal(eco.deja, 5800)
  assert.equal(dejaronDe(10000, 1, eco), 5800)
})

test('no aprende rentabilidad de agrupaciones suponiendo que la mercadería fue gratis', () => {
  const filas = [{ itemId: 'a', dia: '2026-10-12', campanaId: 1, costo: 1000, unidadesAds: 1, ventaAds: 10000 }]
  assert.deepEqual(observacionesEstructura(filas, new Map([['a', { esTecho: true }]])), [])
})
