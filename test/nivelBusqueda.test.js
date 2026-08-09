import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analizarFamilia,
  palabrasDeBusqueda,
  variantesDe,
  cabezaDe,
  consultasDe,
  explicar,
} from '../src/services/nivelBusqueda.js'
import { sinStopwords } from '../src/services/busquedasReales.js'

// TODAS las listas de abajo son respuestas reales del autocompletado de ML
// Chile capturadas el 9-ago-2026 sobre el tablero del importador.

test('sinStopwords: la forma que ML sí indexa', () => {
  assert.equal(sinStopwords('arbol de navidad'), 'arbol navidad')
  assert.equal(sinStopwords('freidora de aire'), 'freidora aire')
  assert.equal(sinStopwords('cama para perro'), 'cama perro')
})

test('palabrasDeBusqueda: solo las que sirven de prefijo', () => {
  assert.deepEqual(palabrasDeBusqueda('set snorkel'), ['set', 'snorkel'])
  assert.deepEqual(palabrasDeBusqueda('arbol de navidad'), ['arbol', 'navidad'])
  assert.deepEqual(palabrasDeBusqueda('tv led'), ['led'])
  assert.deepEqual(palabrasDeBusqueda(''), [])
})

test('cabezaDe: el sustantivo, saltándose la palabra que solo envuelve', () => {
  assert.equal(cabezaDe('manguera extensible'), 'manguera')
  assert.equal(cabezaDe('waflera electrica'), 'waflera')
  assert.equal(cabezaDe('set snorkel'), 'snorkel')
  assert.equal(cabezaDe('pack toallitas humedas'), 'toallitas')
  assert.equal(cabezaDe(''), null)
})

test('consultasDe: primero la frase, después el producto', () => {
  const c = consultasDe('manguera extensible')
  assert.deepEqual(c.cortas, ['manguera', 'manguera e'])
  assert.deepEqual(c.largas, ['extensible'])
  // con stopword de por medio el prefijo largo se arma sin ella
  assert.deepEqual(consultasDe('arbol de navidad').cortas, ['arbol', 'arbol n'])
})

// ---- la keyword existe ----

test('cabeza de su propia familia: alto', () => {
  const r = analizarFamilia('cosmetiquero', new Map([['cosmetiquero', ['cosmetiquero', 'cosmetiquero grande']]]))
  assert.equal(r.nivel, 'alto')
  assert.equal(r.posicion, 1)
})

test('la stopword no puede tumbar la medición (arbol de navidad, score 91)', () => {
  const r = analizarFamilia(
    'arbol de navidad',
    new Map([['arbol', ['arbol navidad', 'arbol pascua', 'arbol navidad plegable']]]),
  )
  assert.equal(r.nivel, 'alto')
  assert.equal(r.seEscribe, 'arbol navidad')
})

test('MANGUERA EXTENSIBLE: existe con el prefijo de dos palabras (era falso positivo)', () => {
  // el error que hubo que revertir: midiendo solo palabras completas, un nicho
  // de score 92 y ya cotizado salía como "keyword inventada"
  const listas = new Map([
    ['manguera', ['manguera', 'manguera jardin', 'manguera retractil', 'manguera ducha']],
    ['manguera e', ['manguera expandible', 'manguera extensible', 'manguera extensible jardin']],
  ])
  const r = analizarFamilia('manguera extensible', listas)
  assert.equal(r.nivel, 'medio')
  assert.equal(r.posicion, 2)
  assert.equal(r.colaLarga, true)
})

test('WAFLERA ELECTRICA: #1 de su prefijo de dos palabras', () => {
  const listas = new Map([
    ['waflera', ['waflera', 'wafleras', 'waflera sandwichera', 'waflera industrial']],
    ['waflera e', ['waflera electrica', 'waflera electrica 3 1', 'sandwichera waflera electrica']],
  ])
  assert.equal(analizarFamilia('waflera electrica', listas).nivel, 'medio')
})

test('ORGANIZADOR COSMETICOS y SACA PUNTOS NEGROS: existen, pero son cola larga', () => {
  const org = analizarFamilia(
    'organizador cosmeticos',
    new Map([
      ['organizador', ['organizador', 'organizador zapatos', 'organizador bano']],
      [
        'organizador c',
        ['organizador cocina', 'organizador cubiertos', 'organizador cables', 'organizador closet', 'organizador cajones', 'organizador cosmeticos'],
      ],
    ]),
  )
  assert.equal(org.nivel, 'bajo')
  assert.equal(org.posicion, 6)

  const saca = analizarFamilia(
    'saca puntos negros',
    new Map([
      ['saca', ['saca pelusas', 'saca pelos']],
      ['saca p', ['saca pelusas', 'saca pelusas electrico', 'saca pelos', 'saca pelos mascotas', 'saca pelusas ropa', 'saca pelos ropa', 'saca pelos gato', 'saca puntos negros']],
    ]),
  )
  assert.equal(saca.nivel, 'bajo')
  assert.equal(saca.posicion, 8)
})

// ---- la keyword no existe ----

test('SET SNORKEL: la keyword no se busca pero el producto SÍ → renombrar', () => {
  const listas = new Map([
    ['set', ['set herramientas', 'set mancuernas', 'set maquillaje']],
    ['set s', ['set skincare', 'set sartenes', 'set servicios', 'set slime']],
    ['snorkel', ['snorkel', 'snorkel buceo', 'snorkel nino', 'snorkel natacion', 'snorkel mascara']],
  ])
  const r = analizarFamilia('set snorkel', listas)
  assert.equal(r.nivel, 'renombrar')
  assert.equal(r.cabeza, 'snorkel')
  assert.equal(r.keywordSugerida, 'snorkel')
  assert.ok(r.alternativas.includes('snorkel buceo'))
  // jamás proponer las sugerencias de "set", que hablan de otros productos
  assert.ok(!r.alternativas.some((a) => a.startsWith('set ')))
})

test('el reemplazo tiene que hablar del MISMO producto (nunca el adjetivo)', () => {
  // sin el candado de la cabeza se proponía "extensible" para manguera y
  // "electrica toothbrush" para waflera
  const listas = new Map([
    ['manguera', ['manguera jardin', 'manguera riego']],
    ['manguera z', []],
    ['extensible', ['extensible', 'extensible cortina', 'extensible microondas', 'barra extensible']],
  ])
  const r = analizarFamilia('manguera zzz extensible', listas)
  assert.equal(r.nivel, 'renombrar')
  assert.ok(r.alternativas.every((a) => a.includes('manguera')))
  assert.ok(!r.alternativas.includes('extensible'))
  assert.ok(!r.alternativas.includes('extensible cortina'))
})

test('DEPILADORA IPL CASERA: la palabra muerta es "casera", no el producto', () => {
  const listas = new Map([
    ['depiladora', ['depiladora', 'depiladora laser', 'depiladora facial']],
    ['depiladora i', ['depiladora ingle', 'depiladora indolora']],
    ['ipl', ['ipl', 'ipl philips']],
    ['casera', ['maquina pastas caseras', 'mayonesa casera']],
  ])
  const r = analizarFamilia('depiladora ipl casera', listas)
  assert.equal(r.nivel, 'renombrar')
  assert.equal(r.cabeza, 'depiladora')
  // jamás mayonesa casera como keyword de una depiladora
  assert.ok(!r.alternativas.some((a) => a.includes('mayonesa')))
  assert.ok(r.alternativas.every((a) => a.includes('depiladora')))
})

test('nada vivo por ninguna palabra: nulo de verdad', () => {
  const listas = new Map([
    ['disfraz', ['disfraz mujer', 'disfraz halloween']],
    ['disfraz f', ['disfraz frozen']],
    ['fiestas', ['fiestas infantiles']],
    ['patrias', ['banderas chilenas']],
  ])
  // ninguna sugerencia contiene la cabeza "disfraz"… salvo las de su propio
  // prefijo, que sí la contienen: el caso nulo real es cuando ML no responde
  const r = analizarFamilia('zzz qqq', new Map([['zzz', []], ['qqq', []]]))
  assert.equal(r.nivel, 'nulo')
  assert.deepEqual(r.alternativas, [])
  // el disfraz sí tiene familia viva bajo su cabeza: es renombrar, no nulo
  assert.equal(analizarFamilia('disfraz fiestas patrias', listas).nivel, 'renombrar')
})

// ---- explicaciones ----

test('explicar: el renombrar dice cuál es la búsqueda real', () => {
  const texto = explicar({
    nivel: 'renombrar',
    keywordSugerida: 'snorkel',
    posicionSugerida: 1,
    alternativas: ['snorkel', 'snorkel buceo', 'snorkel nino'],
  })
  assert.match(texto, /el producto SÍ se busca/)
  assert.match(texto, /"snorkel"/)
  assert.match(texto, /snorkel buceo/)
})

test('explicar: la cola larga avisa que hay que teclear dos palabras', () => {
  const texto = explicar({ nivel: 'bajo', prefijo: 'saca p', posicion: 8, deCuantas: 10, colaLarga: true })
  assert.match(texto, /#8 de 10/)
  assert.match(texto, /dos palabras/)
})

test('explicar: sin medición no inventa nada', () => {
  assert.equal(explicar(null), null)
  assert.match(explicar({ nivel: 'nulo' }), /no hay producto/)
})
