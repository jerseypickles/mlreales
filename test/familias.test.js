import test from 'node:test'
import assert from 'node:assert/strict'
import { solape, agruparFamilias } from '../src/services/familias.js'

const set = (...xs) => new Set(xs)

test('solape: proporción sobre el set más chico; vacíos dan 0', () => {
  assert.equal(solape(set('a', 'b', 'c'), set('b', 'c', 'd')), 2 / 3)
  assert.equal(solape(set('a', 'b'), set('a', 'b', 'c', 'd')), 1) // contenido = mismo mercado
  assert.equal(solape(set(), set('a')), 0)
  assert.equal(solape(null, set('a')), 0)
})

test('agruparFamilias: une por solape, el mayor score lidera, sin solape queda solo', () => {
  const filas = [{ keyword: 'gua sha' }, { keyword: 'rodillo facial' }, { keyword: 'sabanillas perro' }]
  const skus = new Map([
    ['gua sha', set('m1', 'm2', 'm3', 'm4')],
    ['rodillo facial', set('m2', 'm3', 'm4', 'm9')],
    ['sabanillas perro', set('s1', 's2', 's3')],
  ])
  const { deMiembro, deLider } = agruparFamilias(filas, skus)
  assert.deepEqual(deMiembro.get('rodillo facial'), { lider: 'gua sha', solapePct: 75, esJugadaDelLider: false })
  assert.equal(deMiembro.has('gua sha'), false)
  assert.equal(deMiembro.has('sabanillas perro'), false)
  assert.equal(deLider.get('gua sha').length, 1)
})

test('agruparFamilias: familiaAparte impide re-unir un falso positivo', () => {
  const filas = [{ keyword: 'a', familiaAparte: ['b'] }, { keyword: 'b' }]
  const skus = new Map([
    ['a', set('x', 'y', 'z')],
    ['b', set('x', 'y', 'z')],
  ])
  const { deMiembro } = agruparFamilias(filas, skus)
  assert.equal(deMiembro.size, 0)
})

test('agruparFamilias: hijo de jugada se une a su padre aunque no haya solape aún', () => {
  const filas = [{ keyword: 'sabanillas perro' }, { keyword: 'sabanillas perro 60x60', jugadaDeKeyword: 'sabanillas perro' }]
  const skus = new Map([['sabanillas perro', set('s1', 's2')]]) // el hijo aún no tiene scan
  const { deMiembro } = agruparFamilias(filas, skus)
  assert.equal(deMiembro.get('sabanillas perro 60x60').lider, 'sabanillas perro')
  assert.equal(deMiembro.get('sabanillas perro 60x60').esJugadaDelLider, true)
})

test('el solape real vive en el cuerpo del listado, no en el top 30', () => {
  // caso paleta maquillaje ↔ paleta de sombras: el mismo mercado, con 23% de
  // solape mirando el top 30 y 60% mirando el listado completo. El ranking de
  // dos búsquedas distintas diverge en la cabeza aunque el mercado sea idéntico.
  const cabezaA = new Set(['a1', 'a2', 'a3', 'a4', 'a5'])
  const cabezaB = new Set(['b1', 'b2', 'b3', 'b4', 'b5'])
  assert.equal(solape(cabezaA, cabezaB), 0, 'las cabezas no se tocan')

  const completoA = new Set([...cabezaA, 'c1', 'c2', 'c3', 'c4', 'c5'])
  const completoB = new Set([...cabezaB, 'c1', 'c2', 'c3', 'c4', 'c5'])
  assert.equal(solape(completoA, completoB), 0.5, 'el cuerpo comparte la mitad')
})
