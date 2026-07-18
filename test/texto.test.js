import test from 'node:test'
import assert from 'node:assert/strict'
import { decodificarEscapes } from '../src/services/texto.js'

test('decodificarEscapes: repara unicode y saltos de línea doble-codificados', () => {
  assert.equal(decodificarEscapes('Depilaci\\u00f3n l\\u00e1ser'), 'Depilación láser')
  assert.equal(decodificarEscapes('QUE INCLUYE\\n- 1 depiladora\\n- Lentes'), 'QUE INCLUYE\n- 1 depiladora\n- Lentes')
  assert.equal(decodificarEscapes('S\\u00ed'), 'Sí')
})

test('decodificarEscapes: texto limpio pasa intacto (idempotente)', () => {
  assert.equal(decodificarEscapes('Depilación láser, 5 niveles'), 'Depilación láser, 5 niveles')
  const dosVeces = decodificarEscapes(decodificarEscapes('Gen\\u00e9rica'))
  assert.equal(dosVeces, 'Genérica')
})

test('decodificarEscapes: recorre objetos y arrays anidados sin tocar números/booleanos', () => {
  const sucio = {
    titulo: 'Modelo IPL-999 autom\\u00e1tico',
    precio: 42990,
    activo: true,
    ficha: [{ campo: 'Alimentaci\\u00f3n', valor: 'Recargable' }],
  }
  assert.deepEqual(decodificarEscapes(sucio), {
    titulo: 'Modelo IPL-999 automático',
    precio: 42990,
    activo: true,
    ficha: [{ campo: 'Alimentación', valor: 'Recargable' }],
  })
})
