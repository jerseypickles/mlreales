import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analizarFamilia,
  palabrasDeBusqueda,
  variantesDe,
  esCabeza,
  explicar,
} from '../src/services/nivelBusqueda.js'
import { sinStopwords } from '../src/services/busquedasReales.js'

// Todas las listas de abajo son respuestas REALES del autocompletado de ML
// Chile capturadas el 9-ago-2026 sobre el tablero del importador.

test('sinStopwords: la forma que ML sí indexa', () => {
  assert.equal(sinStopwords('arbol de navidad'), 'arbol navidad')
  assert.equal(sinStopwords('freidora de aire'), 'freidora aire')
  assert.equal(sinStopwords('cama para perro'), 'cama perro')
  assert.equal(sinStopwords('Gafas De Sol'), 'gafas sol')
})

test('palabrasDeBusqueda: solo las que sirven de prefijo', () => {
  assert.deepEqual(palabrasDeBusqueda('set snorkel'), ['set', 'snorkel'])
  assert.deepEqual(palabrasDeBusqueda('arbol de navidad'), ['arbol', 'navidad'])
  // menos de 3 letras no es prefijo útil
  assert.deepEqual(palabrasDeBusqueda('tv led'), ['led'])
  assert.deepEqual(palabrasDeBusqueda(''), [])
})

test('variantesDe: la keyword y su forma sin stopwords', () => {
  assert.deepEqual(variantesDe('arbol de navidad'), ['arbol de navidad', 'arbol navidad'])
  assert.deepEqual(variantesDe('cosmetiquero'), ['cosmetiquero'])
})

test('esCabeza: el autocompletado se devuelve a sí mismo cuando la palabra es una búsqueda', () => {
  assert.equal(esCabeza('snorkel', ['snorkel', 'snorkel buceo', 'snorkel nino']), true)
  assert.equal(esCabeza('set', ['set herramientas', 'set mancuernas']), false)
  assert.equal(esCabeza('casera', ['maquina pastas caseras', 'mermelada casera']), false)
  assert.equal(esCabeza('x', undefined), false)
})

test('keyword que ES cabeza de su prefijo: nivel alto', () => {
  // cosmetiquero #1 de 10; arbol navidad #1 (con la stopword de por medio)
  const r = analizarFamilia('cosmetiquero', new Map([['cosmetiquero', ['cosmetiquero', 'cosmetiquero grande']]]))
  assert.equal(r.nivel, 'alto')
  assert.equal(r.posicion, 1)
})

test('la stopword no puede tumbar la medición (arbol de navidad, score 91)', () => {
  const listas = new Map([
    ['arbol', ['arbol navidad', 'arbol pascua', 'arbol navidad plegable']],
    ['navidad', ['navidad', 'navidad decoracion']],
  ])
  const r = analizarFamilia('arbol de navidad', listas)
  assert.equal(r.nivel, 'alto')
  assert.equal(r.posicion, 1)
  assert.equal(r.seEscribe, 'arbol navidad')
})

test('aparece pero al fondo de su lista: medio', () => {
  const lista = ['piscina', 'piscina estructural', 'piscina ninos', 'piscina desmontable', 'piscina inflable']
  const r = analizarFamilia('piscina inflable', new Map([['piscina', lista]]))
  assert.equal(r.nivel, 'medio')
  assert.equal(r.posicion, 5)
})

test('SET SNORKEL: la keyword no se busca pero el producto SÍ → renombrar', () => {
  // el caso que destapó el hueco: preguntando solo por "set" el nicho salía
  // "nadie lo busca"; preguntando por "snorkel" hay 10 búsquedas vivas
  const listas = new Map([
    ['set', ['set herramientas', 'set mancuernas', 'set maquillaje', 'set bano']],
    ['snorkel', ['snorkel', 'snorkel buceo', 'snorkel nino', 'snorkel natacion', 'snorkel mascara']],
  ])
  const r = analizarFamilia('set snorkel', listas)
  assert.equal(r.nivel, 'renombrar')
  assert.equal(r.keywordSugerida, 'snorkel')
  assert.equal(r.posicionSugerida, 1)
  assert.ok(r.alternativas.includes('snorkel buceo'))
  // "set" no es cabeza: sus sugerencias no pueden proponer reemplazo
  assert.ok(!r.alternativas.some((a) => a.startsWith('set ')))
})

test('DEPILADORA IPL CASERA: la palabra muerta es "casera", no el producto', () => {
  const listas = new Map([
    ['depiladora', ['depiladora', 'depiladora laser', 'depiladora facial']],
    ['ipl', ['ipl', 'ipl philips', 'ipl laser']],
    ['casera', ['maquina pastas caseras', 'mermelada casera', 'mayonesa casera']],
  ])
  const r = analizarFamilia('depiladora ipl casera', listas)
  assert.equal(r.nivel, 'renombrar')
  assert.ok(['depiladora', 'ipl'].includes(r.keywordSugerida))
  // jamás proponer mayonesa casera como keyword de reemplazo
  assert.ok(!r.alternativas.some((a) => a.includes('mayonesa')))
  assert.deepEqual(r.cabezas.sort(), ['depiladora', 'ipl'])
})

test('FOCO SOLARES: keyword mal escrita, la familia manda', () => {
  const listas = new Map([
    ['foco', ['foco', 'foco solar', 'focos solares exterior', 'foco caza', 'focos solares potentes']],
    ['solares', ['solares', 'solares jardin', 'solares focos']],
  ])
  const r = analizarFamilia('foco solares', listas)
  assert.equal(r.nivel, 'renombrar')
  // "focos solares exterior" cubre las DOS palabras del nicho: gana a "foco"
  assert.equal(r.keywordSugerida, 'focos solares exterior')
})

test('nada vivo por ninguna palabra: nulo de verdad', () => {
  const listas = new Map([
    ['disfraz', ['disfraz mujer', 'disfraz halloween']],
    ['fiestas', ['fiestas infantiles']],
    ['patrias', ['banderas chilenas']],
  ])
  const r = analizarFamilia('disfraz fiestas patrias', listas)
  assert.equal(r.nivel, 'nulo')
  assert.deepEqual(r.alternativas, [])
})

test('sin respuesta de ML no se afirma nada', () => {
  const r = analizarFamilia('lo que sea', new Map([['que', []]]))
  assert.equal(r.nivel, 'nulo')
})

test('explicar: el renombrar dice cuál es la búsqueda real', () => {
  const texto = explicar({
    nivel: 'renombrar',
    keywordSugerida: 'snorkel',
    posicionSugerida: 1,
    alternativas: ['snorkel', 'snorkel buceo', 'snorkel nino'],
  })
  assert.match(texto, /el producto SÍ/)
  assert.match(texto, /"snorkel"/)
  assert.match(texto, /snorkel buceo/)
})

test('explicar: el nulo no propone nada porque no hay nada', () => {
  assert.match(explicar({ nivel: 'nulo' }), /no hay producto/)
  assert.equal(explicar(null), null)
})

test('explicar: la keyword sana muestra su posición', () => {
  const texto = explicar({ nivel: 'alto', prefijo: 'arbol', posicion: 1, deCuantas: 10, seEscribe: 'arbol navidad' })
  assert.match(texto, /#1 de 10/)
  assert.match(texto, /arbol navidad/)
})
