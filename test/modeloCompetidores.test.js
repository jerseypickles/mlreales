import test from 'node:test'
import assert from 'node:assert/strict'
import { filasCompetidores, entrenarCompetidores, VARIABLES_COMPETIDORES } from '../src/services/ml/modeloCompetidores.js'

// azar reproducible
let semilla = 7
const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647 }

test('modelo de competidores: aprende que Full y buena posición venden más, y lo prueba en nichos no vistos', () => {
  const filas = []
  for (let n = 0; n < 120; n++) for (let s = 0; s < 15; s++) {
    const full = azar() < 0.5, pos = 1 + Math.floor(azar() * 48), res = Math.floor(azar() * 300)
    for (let k = 0; k < 2; k++) {
      const xs = [Math.log(pos), (azar() - 0.5) * 0.6, 0, Number(full), 0, 0, 0, Math.log1p(res), Math.log1p(100), 1, 0, 0, 1]
      const y = Math.max(0, 1.2 + 0.6 * xs[3] - 0.35 * xs[0] + 0.15 * xs[7] + (azar() - 0.5) * 0.4)
      filas.push({ grupo: `n${n}s${s}`, keyword: `nicho-${n}`, fecha: k, dias: 7, xs, y })
    }
  }
  const m = entrenarCompetidores(filas)
  assert.equal(m.estado, 'sombra')
  assert.ok(m.evaluacion.superaReferencias, 'con tres causas reales le gana a cada regla de una sola')
  assert.ok(m.pesos.full > 0.3)
  assert.ok(m.pesos.posicionLog < -0.2)
  assert.ok(m.evaluacion.orden.modelo.spearman > m.evaluacion.orden.posicion.spearman)
  assert.ok(Math.abs(m.pesos.tiendaOficial) < 1e-9 && Math.abs(m.pesos.vendidosLog) < 1e-9, 'lo que no varía no pesa')
  assert.equal(VARIABLES_COMPETIDORES.length, filas[0].xs.length)
})

test('modelo de competidores: la fila usa lo que se sabía al inicio del par y el precio frente a su propio scan', () => {
  const d = (n) => new Date(Date.UTC(2026, 8, 1 + n))
  const snaps = [
    { sku: 'A', keyword: 'k', fecha: d(0), precio: 2000, posicion: 1, numReviewsApi: 10, vendidos: 50, rating: 4.8 },
    { sku: 'A', keyword: 'k', fecha: d(7), precio: 9999, posicion: 40, numReviewsApi: 17, vendidos: 100, rating: 4.1 },
    { sku: 'B', keyword: 'k', fecha: d(0), precio: 1000, posicion: 2, numReviewsApi: 5 },
    { sku: 'B', keyword: 'k', fecha: d(7), precio: 1000, posicion: 2, numReviewsApi: 5 },
    { sku: 'C', keyword: 'k', fecha: d(0), precio: 500, posicion: 3, numReviewsApi: 0 },
  ]
  const productos = [{ sku: 'A', esFull: true, reputacionSeller: '5_green' }, { sku: 'B', esFull: false }, { sku: 'C' }]
  const filas = filasCompetidores(snaps, productos)
  const a = filas.find((f) => f.grupo === 'A')
  assert.ok(Math.abs(a.y - Math.log1p(7)) < 1e-9, '7 reseñas en 7 días')
  assert.equal(a.xs[0], 0, 'posición 1 al inicio, no la 40 del final')
  assert.ok(Math.abs(a.xs[1] - Math.log(2)) < 1e-9, 'precio 2.000 contra mediana 1.000 del scan inicial')
  assert.equal(a.xs[3], 1)
  assert.equal(a.xs[9], 1)
  assert.ok(Math.abs(a.xs[11] - 0.3) < 1e-9)
  assert.equal(filas.find((f) => f.grupo === 'B').y, 0, 'cero reseñas nuevas también es dato')
})
