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
