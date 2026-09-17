import test from 'node:test'
import assert from 'node:assert/strict'
import { visitasPorDia, diasDelLibro, semanasDelLibro } from '../src/services/ml/libro.js'
import { ventanasIndependientes } from '../src/services/ml/comercial.js'

// Datos SINTÉTICOS: comprueban el contrato del libro, no el negocio.
const ahora = new Date('2026-09-17T05:00:00Z')
const respuesta = { total_visits: 60, results: [
  ...Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(7 + i).padStart(2, '0')}T00:00:00Z`, total: 6 })),
  { date: '2026-09-17T00:00:00Z', total: 3 }, // hoy: día abierto
].filter((r) => r.date.slice(8, 10) !== '12') } // el 12 no viene: ML omite los ceros
const propio = { sku: 'MLC1', titulo: 'Sintético', categoriaMl: 'CAT', nichoId: 'n1', envioMl: { logistica: 'fulfillment' },
  mediciones: [{ fecha: ahora, precioEfectivo: 9000 }],
  historialPrecios: [{ fecha: new Date('2026-09-10T12:00:00Z'), anterior: 10000, nuevo: 9000 }],
  stockDiario: Array.from({ length: 12 }, (_, i) => ({ dia: `2026-09-${String(6 + i).padStart(2, '0')}`, mediciones: 24, conStock: 24 })) }
const ventas = [
  { orderId: 'a', estado: 'paid', fecha: new Date('2026-09-11T15:00:00Z'), items: [{ itemId: 'MLC1', cantidad: 2 }, { itemId: 'OTRO', cantidad: 5 }] },
  { orderId: 'b', estado: 'cancelled', fecha: new Date('2026-09-11T16:00:00Z'), items: [{ itemId: 'MLC1', cantidad: 9 }] },
]

test('el libro guarda cada día cerrado: ceros, ventas del día y precio ponderado, sin el día abierto', () => {
  const dias = diasDelLibro(propio, visitasPorDia(respuesta), ventas, { ahora })
  assert.deepEqual([dias[0].dia, dias.at(-1).dia, dias.length], ['2026-09-07', '2026-09-16', 10])
  const d = Object.fromEntries(dias.map((x) => [x.dia, x]))
  assert.equal(d['2026-09-12'].visitas, 0, 'día omitido por ML dentro del rango = cero visitas')
  assert.deepEqual([d['2026-09-11'].unidades, d['2026-09-11'].ordenes], [2, 1], 'solo órdenes pagadas de este item')
  assert.deepEqual([d['2026-09-10'].precio, d['2026-09-10'].precioMin, d['2026-09-10'].precioMax, d['2026-09-10'].cambiosPrecio], [9500, 9000, 10000, 1])
  assert.deepEqual([d['2026-09-09'].precio, d['2026-09-09'].precioInferido], [10000, true], 'antes del primer cambio conservado el precio es inferido')
  assert.equal(d['2026-09-11'].precio, 9000)
  assert.equal(d['2026-09-16'].nichoId, 'n1')
  assert.equal(d['2026-09-10'].nichoId, null, 'a la historia recuperada no se le atribuye el nicho de hoy')
  assert.equal(d['2026-09-16'].stockFraccion, 1)
})

test('del libro salen semanas con el contrato del registro en vivo, y un día sin stock o inferido las corta', () => {
  const dias = diasDelLibro(propio, visitasPorDia(respuesta), ventas, { ahora })
  const semanas = semanasDelLibro(dias)
  // la única semana sin días inferidos es 10→16 de septiembre
  assert.equal(semanas.length, 1)
  const s = semanas[0]
  assert.deepEqual([s.desde.toISOString(), s.hasta.toISOString(), s.dia], ['2026-09-10T00:00:00.000Z', '2026-09-17T00:00:00.000Z', '2026-09-16'])
  assert.deepEqual([s.visitas, s.unidades, s.full, s.cambiosPrecio, s.fuente], [36, 2, true, 1, 'libro-diario'])
  assert.equal(ventanasIndependientes([s]).length, 1)
  const quebrado = dias.map((x) => x.dia === '2026-09-13' ? { ...x, stockFraccion: 0.5 } : x)
  assert.equal(semanasDelLibro(quebrado).length, 0)
  assert.equal(semanasDelLibro(dias.map((x) => ({ ...x, stockFraccion: null }))).length, 0, 'stock sin medir no es stock')
})
