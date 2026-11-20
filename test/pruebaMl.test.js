import test from 'node:test'
import assert from 'node:assert/strict'
import { leerPrueba, varaDe, lugarEntre, decidirPrueba, ordenarPorPrueba, probarEnMl, TOP_PRUEBA, MIN_NICHOS_VARA } from '../src/services/pruebaMl.js'

const tarjetas = (n, vendidos, extra = {}) => Array.from({ length: n }, (_, i) => ({ itemPosition: i + 1, cantidadVendida: vendidos, esAnuncio: false, ...extra }))

test('prueba en ML: suma lo vendido de las primeras 50 publicaciones que no son anuncio', () => {
  const items = [
    ...tarjetas(60, 100),
    { itemPosition: null, cantidadVendida: 10000, esAnuncio: true }, // un anuncio puro no cuenta
  ]
  items[3].cantidadVendida = null // sin cartel: menos de lo mínimo que muestra ML
  items[4].cantidadVendida = '500'
  const p = leerPrueba(items)
  assert.equal(p.publicaciones, TOP_PRUEBA)
  assert.equal(p.conCartel, 49)
  assert.equal(p.vendidos, 48 * 100 + 500)
  assert.deepEqual(leerPrueba([]), { vendidos: 0, conCartel: 0, publicaciones: 0 })
  // el orden es el de la búsqueda, no el de llegada
  const desordenadas = [{ itemPosition: 2, cantidadVendida: 5 }, { itemPosition: 1, cantidadVendida: 1000 }]
  assert.equal(leerPrueba(desordenadas, { top: 1 }).vendidos, 1000)
})

test('prueba en ML: la vara sale de los nichos medidos, y con pocos nichos no hay vara', () => {
  const valores = Array.from({ length: 90 }, (_, i) => (i + 1) * 100)
  const v = varaDe(valores, { fraccion: 1 / 3 })
  assert.equal(v.vara, 3100, 'deja debajo al tercio más flojo')
  assert.equal(v.nichos, 90)
  assert.equal(varaDe(valores.slice(0, MIN_NICHOS_VARA - 1), { fraccion: 1 / 3 }), null)
  assert.equal(lugarEntre(4550, valores), 50)
  assert.equal(lugarEntre(null, valores), null)
})

test('prueba en ML: bajo la vara no se abre, sin medir tampoco, y sin vara se abre como antes', () => {
  const vara = { vara: 3000 }
  assert.deepEqual(decidirPrueba({ vendidos: 3000 }, vara), { pasa: true, motivo: null })
  assert.deepEqual(decidirPrueba({ vendidos: 2999 }, vara), { pasa: false, motivo: 'bajo-la-vara' })
  assert.deepEqual(decidirPrueba(null, vara), { pasa: false, motivo: 'sin-medir' })
  assert.deepEqual(decidirPrueba({ vendidos: 10 }, null), { pasa: true, motivo: 'sin-vara' })
})

test('prueba en ML: el cupo va primero a lo que más vende, y lo de una fuente que viene rindiendo mal va al final', () => {
  const candidatos = [
    { keyword: 'a', fuente: 'temporada', prueba: { vendidos: 90000 } },
    { keyword: 'b', fuente: 'ranking-ml', prueba: { vendidos: 20000 } },
    { keyword: 'c', fuente: 'intuicion', prueba: { vendidos: 50000 } },
  ]
  assert.deepEqual(ordenarPorPrueba(candidatos).map((c) => c.keyword), ['a', 'c', 'b'])
  assert.deepEqual(ordenarPorPrueba(candidatos, new Set(['temporada'])).map((c) => c.keyword), ['c', 'b', 'a'])
})

test('prueba en ML: pide una sola página de la búsqueda', async () => {
  const pedidos = []
  const buscar = async (keyword, opciones) => { pedidos.push([keyword, opciones]); return { items: tarjetas(48, 500), costoUsd: 0.008 } }
  const p = await probarEnMl('lampara de mesa', { buscar })
  assert.deepEqual(pedidos, [['lampara de mesa', { maxPaginas: 1 }]])
  assert.deepEqual(p, { vendidos: 24000, conCartel: 48, publicaciones: 48, costoUsd: 0.008 })
})
