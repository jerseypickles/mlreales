import test from 'node:test'
import assert from 'node:assert/strict'
import { percentil, calcularMetricas } from '../src/services/metricas.js'

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
