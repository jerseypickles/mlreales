import test from 'node:test'
import assert from 'node:assert/strict'
import { cruzarNicho, resumenCruce, analisisDeDecision, diasUtiles, esperadoDeGama, unidadesDePropio, unidadesRecomendadas, MIN_DIAS_CON_STOCK } from '../src/services/ml/recomendadoVsVendido.js'

const dia = (i) => new Date(Date.parse('2026-10-01T12:00:00Z') + i * 86400e3).toISOString().slice(0, 10)
const libro = (n, { unidades = 1, precio = 15000, logistica = 'fulfillment', stock = 1 } = {}) =>
  Array.from({ length: n }, (_, i) => ({ dia: dia(i), unidades, visitas: 20, precio, logistica, cambioLogistica: false, stockFraccion: stock }))
const gamas = { cortes: { economicaHasta: 8000, mediaHasta: 12000 }, gamas: [
  { clave: 'economica', nombre: 'Económica', publicaciones: 50, ventaHoyDia: 20 },
  { clave: 'media', nombre: 'Media', publicaciones: 50, ventaHoyDia: 5 },
  { clave: 'alta', nombre: 'Alta', publicaciones: 50, ventaHoyDia: 2.5 },
] }
const reporte = (fecha, veredicto, recomendacion = { precioVentaClp: 9990, titular: 'Trae: pack 100 unidades' }) =>
  ({ fecha: new Date(fecha), scoreOportunidad: 70, analisis: { veredicto, confianza: 'alta', recomendacion }, metricas: { gamas } })
const nicho = { _id: 'n1', keyword: 'ejemplo', etapaCompraEl: new Date('2026-08-18'), exwCotizadoEl: null }
const propio = { itemId: 'A', titulo: 'Producto 60 Unidades', creadoEl: new Date('2026-10-01'), estadoMl: 'active', costoUnitarioClp: 5000 }

test('recomendado vs vendido: usa el análisis vigente al decidir, no el de hoy', () => {
  const reportes = [reporte('2026-08-10', 'entrar'), reporte('2026-11-01', 'no_entrar')]
  assert.equal(analisisDeDecision(reportes, new Date('2026-08-18')).veredicto, 'entrar')
  const tarde = analisisDeDecision([reporte('2026-09-01', 'entrar')], new Date('2026-08-18'))
  assert.equal(tarde.posterior, true, 'un análisis posterior a la decisión se marca: ya no es predicción')
})

test('recomendado vs vendido: los días anteriores al cambio de logística y los quiebres no cuentan', () => {
  const dias = [...libro(5, { logistica: 'xd_drop_off', unidades: 0 }), ...libro(8).map((d, i) => ({ ...d, dia: dia(5 + i) }))]
  dias[5].cambioLogistica = true
  dias[10].stockFraccion = 0
  assert.equal(diasUtiles(dias).length, 6)
})

test('recomendado vs vendido: con pocos días con stock dice "madurando" y no pone nota', () => {
  const [g] = cruzarNicho({ nicho, propios: [propio], reportes: [reporte('2026-08-10', 'entrar')], diasPorItem: new Map([['A', libro(6)]]) })
  assert.equal(g.estado, 'madurando')
  assert.equal(g.acierto, null)
  assert.ok(g.falta.some((f) => f.includes(`de ${MIN_DIAS_CON_STOCK} días con stock`)))
})

test('recomendado vs vendido: ubica el producto en su gama, avisa si no es comparable y pone nota con muestra', () => {
  const [g] = cruzarNicho({ nicho, propios: [propio], reportes: [reporte('2026-08-10', 'entrar')], diasPorItem: new Map([['A', libro(20)]]), dejaPorItem: new Map([['A', 3000]]), ventasPorResenia: 10 })
  assert.equal(g.gama, 'alta')
  assert.equal(g.esperado.ventaDia, esperadoDeGama(gamas.gamas[2], 10).ventaDia)
  assert.equal(g.esperado.referencia, 'promedio')
  assert.equal(g.esperado.ventaDia, 0.5)
  assert.equal(g.real.ventaDia, 1)
  assert.equal(g.ratio, 2)
  assert.equal(g.lectura, 'sobre-lo-esperado')
  assert.equal(g.comparacion.mismaGama, false, 'se recomendó la gama media y se vende en la alta')
  assert.equal(g.comparacion.mismasUnidades, false, 'pack de 100 recomendado contra 60 publicado')
  assert.equal(g.comparacion.comparable, false)
  assert.equal(g.real.dejo, 60000)
  assert.equal(g.estado, 'medido')
  assert.equal(g.acierto, true)
})

test('recomendado vs vendido: un "no entrar" que no vende es acierto; vender perdiendo plata no es vender', () => {
  const sinVenta = cruzarNicho({ nicho, propios: [propio], reportes: [reporte('2026-08-10', 'no_entrar')], diasPorItem: new Map([['A', libro(20, { unidades: 0 })]]) })
  assert.equal(sinVenta[0].acierto, true)
  const aPerdida = cruzarNicho({ nicho, propios: [propio], reportes: [reporte('2026-08-10', 'entrar')], diasPorItem: new Map([['A', libro(20)]]), dejaPorItem: new Map([['A', -500]]) })
  assert.equal(aPerdida[0].acierto, false)
  const r = resumenCruce([...sinVenta, ...aPerdida])
  assert.equal(r.medidos, 2)
  assert.equal(r.tasaAcierto, 50)
  assert.equal(r.estado, 'pocos-casos')
  assert.equal(r.porVeredicto.no_entrar.ratioMediano, 0)
})

test('recomendado vs vendido: dos gamas del mismo nicho son dos grupos', () => {
  const barato = { ...propio, itemId: 'B', titulo: 'Set chico' }
  const grupos = cruzarNicho({ nicho, propios: [propio, barato], reportes: [reporte('2026-08-10', 'entrar')], diasPorItem: new Map([['A', libro(20)], ['B', libro(20, { precio: 4000 })]]) })
  assert.deepEqual(grupos.map((g) => g.gama).sort(), ['alta', 'economica'])
})

test('recomendado vs vendido: la referencia deja fuera a los 3 líderes y las unidades aceptan rangos', () => {
  const g = { publicaciones: 53, ventaHoyDia: 100, ventaHoyTop3Dia: 80 }
  assert.deepEqual(esperadoDeGama(g, 10), { ventaDia: 4, referencia: 'sin-lideres' })
  assert.equal(unidadesDePropio('60 Toallas Desechables 90x60 Cm'), 60)
  assert.equal(unidadesDePropio('Foco Solar 200w Led'), null)
  assert.deepEqual(unidadesRecomendadas({ segmento: 'Kits grandes 24-68 piezas con estuche' }), { desde: 24, hasta: 68 })
  assert.deepEqual(unidadesRecomendadas({ titular: 'Trae: packs de 100 sabanillas' }), { desde: 100, hasta: 100 })
})
