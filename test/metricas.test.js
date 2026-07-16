import test from 'node:test'
import assert from 'node:assert/strict'
import {
  percentil,
  calcularMetricas,
  calcularDemanda,
  calcularScoreOportunidad,
} from '../src/services/metricas.js'

test('percentil: interpolación lineal', () => {
  assert.equal(percentil([], 50), null)
  assert.equal(percentil([10], 50), 10)
  assert.equal(percentil([10, 20], 50), 15)
  assert.equal(percentil([10, 20, 30], 50), 20)
  assert.equal(percentil([10, 20, 30, 40], 25), 17.5)
})

function armarDatos() {
  const snapshots = [
    { sku: 'A1', precio: 10000, descuentoPct: 20, rating: 4.6, posicion: 1 },
    { sku: 'A2', precio: 12000, descuentoPct: null, rating: 4.2, posicion: 2 },
    { sku: 'B1', precio: 12000, descuentoPct: 10, rating: null, posicion: 3 },
    { sku: 'C1', precio: 14000, descuentoPct: null, rating: null, posicion: 4 },
    { sku: 'D1', precio: 30000, descuentoPct: null, rating: null, posicion: 5 },
  ]
  const productosPorSku = new Map([
    ['A1', { sku: 'A1', vendedor: 'EOLAND', esTiendaOficial: true, esFull: true, envioRapido: true }],
    ['A2', { sku: 'A2', vendedor: 'EOLAND', esTiendaOficial: true, esFull: true, envioRapido: false }],
    ['B1', { sku: 'B1', vendedor: 'IMPORTADORA', esTiendaOficial: false, esFull: false, envioRapido: false }],
    ['C1', { sku: 'C1', vendedor: 'TIENDA C', esTiendaOficial: false, esFull: false, envioRapido: false }],
    ['D1', { sku: 'D1', vendedor: null, esTiendaOficial: false, esFull: false, envioRapido: false }],
  ])
  return { snapshots, productosPorSku }
}

test('calcularMetricas: precio y competencia', () => {
  const { snapshots, productosPorSku } = armarDatos()
  const m = calcularMetricas({
    snapshots,
    productosPorSku,
    totalResultados: { total: 9999, esMinimo: true },
  })

  assert.equal(m.universo.productosAnalizados, 5)
  assert.equal(m.universo.totalResultadosBusqueda, 9999)
  assert.equal(m.universo.totalEsMinimo, true)

  assert.equal(m.precio.mediana, 12000)
  assert.equal(m.precio.min, 10000)
  assert.equal(m.precio.max, 30000)
  assert.equal(m.precio.descuentoPromedioPct, 15)
  assert.equal(m.precio.pctConDescuento, 40)
  assert.ok(m.precio.bandaDominante.cantidad >= 2)

  assert.equal(m.competencia.sellersUnicos, 3)
  assert.equal(m.competencia.pctTiendaOficial, 40)
  // EOLAND(2) + IMPORTADORA(1) + TIENDA C(1) sobre 4 items con vendedor
  assert.equal(m.competencia.concentracionTop3Pct, 100)
  assert.equal(m.competencia.pctFull, 40)
  assert.equal(m.competencia.pctEnvioRapido, 20)
  assert.equal(m.competencia.topSellers[0].vendedor, 'EOLAND')
  assert.equal(m.competencia.topSellers[0].items, 2)

  assert.equal(m.calidad.ratingPromedio, 4.4)
  assert.equal(m.calidad.pctConRating, 40)

  assert.equal(m.demanda, null)
  assert.equal(m.scoreOportunidad, null)
})

test('calcularMetricas: respeta topN por posición', () => {
  const snapshots = Array.from({ length: 60 }, (_, i) => ({
    sku: `S${i}`,
    precio: 1000 + i,
    posicion: i + 1,
    rating: null,
    descuentoPct: null,
  }))
  const productosPorSku = new Map(snapshots.map((s) => [s.sku, { sku: s.sku, vendedor: `V${s.sku}` }]))
  const m = calcularMetricas({ snapshots, productosPorSku, topN: 50 })

  assert.equal(m.universo.productosAnalizados, 50)
  assert.equal(m.precio.max, 1049) // los items 51-60 quedan fuera
})

test('calcularMetricas: sin datos no revienta', () => {
  const m = calcularMetricas({ snapshots: [], productosPorSku: new Map() })
  assert.equal(m.universo.productosAnalizados, 0)
  assert.equal(m.precio.mediana, null)
  assert.equal(m.precio.bandaDominante, null)
  assert.equal(m.competencia.sellersUnicos, 0)
})

test('calcularDemanda: sin vendidos devuelve null', () => {
  assert.equal(calcularDemanda([{ sku: 'A', vendidos: null }]), null)
})

test('calcularDemanda: muestra bajo el mínimo no mide (mejor null que demanda falsa)', () => {
  // caso cooler portatil: el detalle aplicó a 1 de 30 por bloqueo de ML y ese
  // producto tenía 0 reseñas — sin mínimo, el nicho daba "demanda 0" con score 32
  const fecha = new Date('2026-07-16T12:00:00Z')
  const pocos = [
    { sku: 'A', numReviews: 0, fecha },
    { sku: 'B', fecha },
    { sku: 'C', fecha },
  ]
  assert.equal(calcularDemanda(pocos), null)

  const suficientes = Array.from({ length: 5 }, (_, i) => ({ sku: `S${i}`, numReviews: 10 * i, fecha }))
  const d = calcularDemanda(suficientes)
  assert.equal(d.base, 'reviews')
  assert.equal(d.reviews.itemsConDato, 5)
})

test('calcularDemanda: totales y delta entre scans', () => {
  const fechaPrevia = new Date('2026-07-14T12:00:00Z')
  const fechaActual = new Date('2026-07-16T12:00:00Z') // 2 días después
  const actuales = [
    { sku: 'A', vendidos: 150, fecha: fechaActual },
    { sku: 'B', vendidos: 500, fecha: fechaActual },
    { sku: 'C', vendidos: 50, fecha: fechaActual }, // nuevo, sin previo
  ]
  const previos = [
    { sku: 'A', vendidos: 100, fecha: fechaPrevia },
    { sku: 'B', vendidos: 480, fecha: fechaPrevia },
  ]

  const d = calcularDemanda(actuales, previos, { minItems: 1 })
  assert.equal(d.base, 'vendidos')
  assert.equal(d.vendidos.total, 700)
  assert.equal(d.vendidos.mediana, 150)
  assert.equal(d.vendidos.itemsComparables, 2)
  assert.equal(d.vendidos.delta, 70) // (150-100) + (500-480)
  assert.equal(d.vendidos.periodoDias, 2)
  assert.equal(d.ventasEstimadasPorDia, 35)
  assert.equal(d.volumenVentasEstimado, 700)
})

test('calcularDemanda: primer scan sin previos', () => {
  const d = calcularDemanda([{ sku: 'A', vendidos: 200, fecha: new Date('2026-07-16') }], null, { minItems: 1 })
  assert.equal(d.vendidos.total, 200)
  assert.equal(d.ventasEstimadasPorDia, null)
})

test('calcularDemanda: sin vendidos usa delta de reseñas como proxy', () => {
  const fechaPrevia = new Date('2026-07-14T12:00:00Z')
  const fechaActual = new Date('2026-07-16T12:00:00Z')
  const actuales = [
    { sku: 'A', numReviews: 930, fecha: fechaActual },
    { sku: 'B', numReviews: 110, fecha: fechaActual },
  ]
  const previos = [
    { sku: 'A', numReviews: 921, fecha: fechaPrevia },
    { sku: 'B', numReviews: 105, fecha: fechaPrevia },
  ]
  const d = calcularDemanda(actuales, previos, { minItems: 1 })
  assert.equal(d.base, 'reviews')
  assert.equal(d.reviews.total, 1040)
  assert.equal(d.reviews.delta, 14) // 9 + 5
  assert.equal(d.reviews.porDia, 7)
  assert.equal(d.ventasEstimadasPorDia, 175) // 7 reseñas/día × factor 25
  assert.equal(d.volumenVentasEstimado, 26000) // 1040 × 25
})

test('calcularScoreOportunidad: composición según pesos', () => {
  const r = calcularScoreOportunidad({
    demanda: { volumenVentasEstimado: 10000 },
    competencia: { concentracionTop3Pct: 40, pctFull: 10 },
    calidad: { ratingPromedio: 4.0 },
  })
  // demanda 20*log10(10001)≈80 · competencia 60 · calidad (4.4-4)/0.9*100≈44 · full 90
  assert.equal(r.componentes.demanda, 80)
  assert.equal(r.componentes.competencia, 60)
  assert.equal(r.componentes.calidad, 44)
  assert.equal(r.componentes.full, 90)
  // 0.4*80 + 0.25*60 + 0.2*44.4 + 0.15*90 ≈ 69
  assert.equal(r.score, 69)
})

test('calcularScoreOportunidad: sin demanda devuelve null', () => {
  assert.equal(calcularScoreOportunidad({ demanda: null, competencia: {}, calidad: {} }), null)
})

test('calcularMetricas: integra demanda y score cuando hay vendidos', () => {
  const fecha = new Date('2026-07-16T12:00:00Z')
  const snapshots = [
    { sku: 'A1', precio: 10000, vendidos: 5000, rating: 4.0, posicion: 1, fecha },
    { sku: 'A2', precio: 12000, vendidos: 3000, rating: 4.2, posicion: 2, fecha },
    { sku: 'A3', precio: 11000, vendidos: 1000, rating: 4.1, posicion: 3, fecha },
    { sku: 'A4', precio: 9000, vendidos: 500, rating: 3.9, posicion: 4, fecha },
    { sku: 'A5', precio: 13000, vendidos: 500, rating: 4.3, posicion: 5, fecha },
  ]
  const productosPorSku = new Map([
    ['A1', { sku: 'A1', vendedor: 'X', esFull: false }],
    ['A2', { sku: 'A2', vendedor: 'Y', esFull: false }],
    ['A3', { sku: 'A3', vendedor: 'Z', esFull: false }],
    ['A4', { sku: 'A4', vendedor: 'X', esFull: false }],
    ['A5', { sku: 'A5', vendedor: 'W', esFull: false }],
  ])
  const m = calcularMetricas({ snapshots, productosPorSku })
  assert.equal(m.demanda.vendidos.total, 10000)
  assert.equal(m.demanda.volumenVentasEstimado, 10000)
  assert.ok(m.scoreOportunidad > 0)
  assert.ok(m.oportunidad.componentes.demanda > 70)
})
