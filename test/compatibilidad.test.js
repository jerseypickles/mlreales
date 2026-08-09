import test from 'node:test'
import assert from 'node:assert/strict'
import { marcaDelTitulo, desglosePorMarca, esNichoDeRepuesto } from '../src/services/compatibilidad.js'

const top = [
  { titulo: 'Pastillas Freno Delantera Y Trasera Chery Tiggo 2 2017', precio: 35990, esFull: true, numReviews: 12, ventasDia: 3 },
  { titulo: 'Pastillas De Freno Delanteras Chevrolet Sail 1.4 2010-', precio: 9990, esFull: true, numReviews: 80, ventasDia: 10 },
  { titulo: 'Pastillas Cerámica Delanteras Freno Ford Fiesta 2011/2', precio: 19990, esFull: false, numReviews: 25, ventasDia: 4 },
  { titulo: 'Pastillas De Freno Kia Rio 4 2012-2023 (korea)', precio: 19990, esFull: true, numReviews: 40, ventasDia: 6 },
  { titulo: 'Pastillas Freno Chevrolet Spark Gt 2011-2017', precio: 12990, esFull: null, numReviews: 30, ventasDia: 5 },
  { titulo: 'Kit Limpiador de Frenos en Spray', precio: 4990, esFull: false, numReviews: 5, ventasDia: 1 },
]

test('marcaDelTitulo: reconoce la marca del vehículo y devuelve null si no hay', () => {
  assert.equal(marcaDelTitulo('Pastillas Freno Chevrolet Sail'), 'Chevrolet')
  assert.equal(marcaDelTitulo('Pastillas De Freno Kia Rio 4'), 'Kia')
  assert.equal(marcaDelTitulo('Kit Limpiador de Frenos en Spray'), null)
})

test('esNichoDeRepuesto: detecta la rama de vehículos', () => {
  assert.equal(esNichoDeRepuesto('Accesorios para Vehículos > Repuestos Autos y Camionetas > Frenos'), true)
  assert.equal(esNichoDeRepuesto('Belleza y Cuidado Personal > Maquillaje'), false)
})

test('desglosePorMarca: agrupa por marca con precio, Full y reseñas, ordenado por tracción', () => {
  const d = desglosePorMarca(top)
  assert.equal(d[0].marca, 'Chevrolet') // 110 reseñas entre Sail y Spark
  assert.equal(d[0].items, 2)
  assert.equal(d[0].pctFull, 100) // Sail tiene Full, Spark es desconocido → no cuenta
  assert.equal(d[0].medianaPrecio, 12990)
  assert.ok(!d.some((x) => x.marca === null), 'el spray sin marca no debe crear grupo')
})

test('desglosePorMarca: sin marcas reconocibles devuelve null', () => {
  assert.equal(desglosePorMarca([{ titulo: 'Brochas Maquillaje Set 10', precio: 2990 }]), null)
})
