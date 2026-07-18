import test from 'node:test'
import assert from 'node:assert/strict'
import { celdaCsv, aCsvExcel, fechaCsv } from '../src/services/csv.js'

test('celdaCsv: booleanos en español, decimales con coma, nulos vacíos', () => {
  assert.equal(celdaCsv(true), 'sí')
  assert.equal(celdaCsv(false), 'no')
  assert.equal(celdaCsv(4.5), '4,5')
  assert.equal(celdaCsv(15990), '15990')
  assert.equal(celdaCsv(null), '')
  assert.equal(celdaCsv(undefined), '')
  assert.equal(celdaCsv(NaN), '')
})

test('celdaCsv: escapa punto y coma, comillas y saltos de línea', () => {
  assert.equal(celdaCsv('hervidor; 1.7L'), '"hervidor; 1.7L"')
  assert.equal(celdaCsv('el "mejor" precio'), '"el ""mejor"" precio"')
  assert.equal(celdaCsv('línea\nnueva'), '"línea\nnueva"')
  assert.equal(celdaCsv('texto normal'), 'texto normal')
})

test('aCsvExcel: BOM + separador ; + CRLF + accessor de columna', () => {
  const csv = aCsvExcel(
    [{ titulo: 'Hervidor', precio: 15990, esFull: true, fecha: '2026-07-18T03:00:00Z' }],
    [
      { clave: 'titulo', titulo: 'Producto' },
      { clave: 'precio', titulo: 'Precio CLP' },
      { clave: 'esFull', titulo: 'Full' },
      { clave: 'fecha', titulo: 'Scan', valor: (f) => fechaCsv(f.fecha) },
    ],
  )
  assert.ok(csv.startsWith('\ufeff'))
  const lineas = csv.slice(1).split('\r\n')
  assert.equal(lineas[0], 'Producto;Precio CLP;Full;Scan')
  assert.equal(lineas[1], 'Hervidor;15990;sí;2026-07-18 03:00')
})

test('fechaCsv: inválidas y nulas devuelven null', () => {
  assert.equal(fechaCsv(null), null)
  assert.equal(fechaCsv('no es fecha'), null)
})
