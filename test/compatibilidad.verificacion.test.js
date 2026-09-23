import test from 'node:test'
import assert from 'node:assert/strict'
import { aniosDe, verificarFilaRepuesto, verificarPlanRepuestos } from '../src/services/compatibilidad.js'

test('años del título: completos, rangos y abreviados', () => {
  assert.deepEqual([...aniosDe('Pastillas Kia Rio 4 2012-2023 (korea)')].sort(), [2012, 2023])
  assert.deepEqual([...aniosDe('Pastillas Para Hyundai Accent Rb Delant 12/20 Bencinero')].sort(), [2012, 2020])
  assert.deepEqual([...aniosDe('Pastilla Freno Chevrolet Spark Lt-ls')], [])
  assert.deepEqual([...aniosDe('Motor 1.4/1.6 set 4')], [], 'una cilindrada no es un año')
})

test('verificación de una fila del plan contra el título que la IA citó', () => {
  const rio = { posicion: 7, titulo: 'Pastillas De Freno Kia Rio 4 2012-2023 (korea) Envío Gratis', url: 'u', sku: 'MLC1', precio: 19990 }
  assert.equal(verificarFilaRepuesto({ modelos: 'Rio 4 (UB) 1.4/1.6 2012-2023' }, rio).estado, 'verificada')
  assert.equal(verificarFilaRepuesto({ modelos: 'Rio 4 2011-2024' }, rio).estado, 'parcial', 'la IA estiró los años')
  assert.equal(verificarFilaRepuesto({ modelos: 'Accent RB 2012-2020' }, rio).estado, 'no-calza', 'citó el título de otro auto')
  assert.equal(verificarFilaRepuesto({ modelos: 'Hilux 2016-2024' }, null).estado, 'sin-fuente')
  const spark = { posicion: 3, titulo: 'Pastilla Freno Chevrolet Spark Lt-ls' }
  assert.equal(verificarFilaRepuesto({ modelos: 'Spark LT / LS 2004-2016' }, spark).estado, 'parcial', 'modelo sí, años no escritos')
  const plan = verificarPlanRepuestos([{ modelos: 'Rio 4 2012-2023', fuentePos: 7 }, { modelos: 'Hilux 2016-2024', fuentePos: null }], [rio])
  assert.deepEqual(plan.map((f) => f.verificacion), ['verificada', 'sin-fuente'])
  assert.equal(plan[0].fuente.url, 'u')
})

test('las notas entre paréntesis no se le exigen al título citado', () => {
  const l200 = { posicion: 16, titulo: 'Pastillas Freno Delanteras Mitsubishi New L200 2.4 2016-2023' }
  assert.equal(verificarFilaRepuesto({ modelos: 'New L200 2.4 2016-2023 (el mismo SKU aparece declarado 2016-2024 en pos 25)' }, l200).estado, 'verificada')
  assert.equal(verificarFilaRepuesto({ modelos: 'New L200 2.4 2016-2024' }, l200).estado, 'parcial')
})
