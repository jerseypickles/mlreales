import test from 'node:test'
import assert from 'node:assert/strict'
import { elegirPanel } from '../src/services/reseniasDiarias.js'

test('panel de reseñas: una vez por publicación de ML, con su mejor posición, y solo lo que tiene item', () => {
  const vistas = [
    { sku: 'MLC1', posicion: 30 }, { sku: 'CAT9', posicion: 2 }, // CAT9 es un catálogo cuyo item es MLC1
    { sku: 'MLC5', posicion: 10 }, { sku: 'MLCU7', posicion: 1 }, { sku: 'MLC8', posicion: null },
  ]
  const productos = [{ sku: 'MLC1', itemId: 'MLC1' }, { sku: 'CAT9', itemId: 'MLC1' }, { sku: 'MLC5', itemId: 'MLC5' },
    { sku: 'MLCU7', itemId: null }, { sku: 'MLC8', itemId: 'MLC8' }]
  const panel = elegirPanel(vistas, productos)
  assert.deepEqual(panel.map((p) => [p.itemId, p.posicion]), [['MLC1', 2], ['MLC5', 10], ['MLC8', 999]])
  assert.equal(elegirPanel(vistas, productos, { max: 1 }).length, 1)
})

test('saltos que no son ventas: trayectoria compartida y salto de fuente se descartan; el crecimiento normal no', async () => {
  const { saltosSospechosos } = await import('../src/services/reseniasDiarias.js')
  const fuera = saltosSospechosos([
    { itemId: 'A', antes: 397, ahora: 1816 }, { itemId: 'B', antes: 397, ahora: 1816 }, // agrupadas por ML
    { itemId: 'C', antes: 100, ahora: 938 }, // salto de fuente
    { itemId: 'D', antes: 2000, ahora: 2030 }, // +30 en un top: normal
    { itemId: 'E', antes: 3, ahora: 5 }, { itemId: 'F', antes: 3, ahora: 5 }, // cifras chicas iguales: azar, no se castiga
  ])
  assert.equal(fuera.get('A'), 'compartida')
  assert.equal(fuera.get('B'), 'compartida')
  assert.equal(fuera.get('C'), 'salto')
  assert.equal(fuera.has('D'), false)
  assert.equal(fuera.has('E'), false)
})
