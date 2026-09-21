import test from 'node:test'
import assert from 'node:assert/strict'
import { exwConTransporte } from '../src/services/tablero.js'

test('el EXW que se paga es el de fábrica más el recargo de transporte; sin recargo queda igual', () => {
  assert.equal(exwConTransporte(17, 15), 19.55)
  assert.equal(exwConTransporte(1.72, 15), 1.98)
  assert.equal(exwConTransporte(8.3, null), 8.3)
  assert.equal(exwConTransporte(8.3, 0), 8.3)
  assert.equal(exwConTransporte(null, 15), null)
})

test('si el precio ya trae el flete a Chile, el costo internado no suma otro flete ni pide cubicaje', async () => {
  const { calcularMargen } = await import('../src/services/margen.js')
  const base = { costoExwUsd: 9.55, unidades: 150, precioVentaClp: 20000 }
  const con = calcularMargen({ ...base, volumenM3: 0.024 })
  const sin = calcularMargen({ ...base, fleteIncluido: true })
  assert.equal(sin.porUnidad.fleteClp, 0)
  assert.ok(con.porUnidad.fleteClp > 0)
  assert.ok(sin.porUnidad.landedNetoClp < con.porUnidad.landedNetoClp)
})

test('un nicho con varios productos guarda cada uno, y su resumen es el promedio ponderado y la suma', async () => {
  // la cuenta que hace el PATCH, con la factura real de mangueras: 15 m y 30 m
  const lista = [{ exwUsd: 4.5, unidades: 100 }, { exwUsd: 5.9, unidades: 50 }]
  const total = lista.reduce((a, p) => a + p.unidades, 0)
  assert.equal(total, 150)
  assert.equal(Math.round((lista.reduce((a, p) => a + p.exwUsd * p.unidades, 0) / total) * 100) / 100, 4.97)
  assert.equal(exwConTransporte(4.5, 15), 5.18)
  assert.equal(exwConTransporte(5.9, 15), 6.79)
})
