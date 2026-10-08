import test from 'node:test'
import assert from 'node:assert/strict'
import { semanasDelNicho, contrasteConGoogle, spearman } from '../src/services/ml/demandaPropia.js'

const semana = (lunes, { prints = 3000, clicks = 10, costo = 1000, campanaId = 1 } = {}) =>
  Array.from({ length: 7 }, (_, i) => ({ dia: new Date(Date.parse(`${lunes}T12:00:00Z`) + i * 86400e3).toISOString().slice(0, 10), prints, clicks, costo, campanaId }))

test('demanda propia: una semana que gastó el presupuesto es "limitada", no demanda', () => {
  const filas = semana('2026-10-05')
  const campanaDia = new Map(filas.map((f) => [`1|${f.dia}`, { presupuestoDiario: 1000, roasObjetivo: 2.5 }]))
  const gasto = new Map(filas.map((f) => [`1|${f.dia}`, 1000]))
  assert.equal(semanasDelNicho(filas, campanaDia, gasto)[0].lectura, 'limitada')
  const holgada = new Map(filas.map((f) => [`1|${f.dia}`, 400]))
  assert.equal(semanasDelNicho(filas, campanaDia, holgada)[0].lectura, 'limpia')
})

test('demanda propia: sin la configuración de la campaña la semana queda "sin dato"; si cambió el ROAS, "cambio de config"', () => {
  const filas = semana('2026-09-07')
  assert.equal(semanasDelNicho(filas)[0].lectura, 'sin-dato-campana')
  const campanaDia = new Map(filas.map((f, i) => [`1|${f.dia}`, { presupuestoDiario: 5000, roasObjetivo: i < 3 ? 3 : 2.5 }]))
  const gasto = new Map(filas.map((f) => [`1|${f.dia}`, 1000]))
  assert.equal(semanasDelNicho(filas, campanaDia, gasto)[0].lectura, 'cambio-config')
})

test('contraste con Google: pide 4 meses; si las impresiones siguen a Google, "google sirve"', () => {
  const semanas = ['2026-06-01', '2026-07-06', '2026-08-03', '2026-09-07'].map((s, i) => ({ semana: s, dias: 7, impresiones: (i + 1) * 7000, lectura: 'limpia' }))
  assert.equal(contrasteConGoogle(semanas.slice(0, 3), []).estado, 'pocos-meses')
  const google = [{ periodo: '2026-06', valor: 100 }, { periodo: '2026-07', valor: 200 }, { periodo: '2026-08', valor: 300 }, { periodo: '2026-09', valor: 400 }]
  assert.equal(contrasteConGoogle(semanas, google).estado, 'google-sirve')
  const alReves = google.map((g, i) => ({ ...g, valor: 400 - i * 100 }))
  assert.equal(contrasteConGoogle(semanas, alReves).estado, 'google-no-sirve')
  assert.equal(spearman([1, 2, 3], [1, 2, 3]), 1)
})
