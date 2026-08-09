import test from 'node:test'
import assert from 'node:assert/strict'
import { clasificarPeso, explicar } from '../src/services/nivelBusqueda.js'
import { variantesDe } from '../src/services/pesoKeyword.js'
import { sinStopwords } from '../src/services/busquedasReales.js'

// Casos medidos en vivo contra el autocompletado de ML el 9-ago-2026 sobre el
// tablero real: son la referencia de que el nivel discrimina.

test('sinStopwords: la forma que ML sí indexa', () => {
  assert.equal(sinStopwords('arbol de navidad'), 'arbol navidad')
  assert.equal(sinStopwords('freidora de aire'), 'freidora aire')
  assert.equal(sinStopwords('cama para perro'), 'cama perro')
  assert.equal(sinStopwords('Gafas De Sol'), 'gafas sol')
  assert.equal(sinStopwords('cosmetiquero'), 'cosmetiquero')
})

test('variantesDe: mide la keyword y su forma sin stopwords', () => {
  // el bug: "arbol de navidad" daba NULO y "arbol navidad" es #1 de su prefijo
  assert.deepEqual(variantesDe('arbol de navidad'), ['arbol de navidad', 'arbol navidad'])
  assert.deepEqual(variantesDe('freidora de aire'), ['freidora de aire', 'freidora aire'])
  // sin stopwords que sacar, no se duplica la variante
  assert.deepEqual(variantesDe('cosmetiquero'), ['cosmetiquero'])
  assert.deepEqual(variantesDe('  Saca   Puntos Negros '), ['saca puntos negros'])
})

test('clasificarPeso: cabeza de familia = alto', () => {
  // cosmetiquero #1 de 10 en "cosmetiquero"; sabanillas perro #2; rizador pelo #3
  assert.equal(clasificarPeso({ peso: 'alto', posicion: 1 }).nivel, 'alto')
  assert.equal(clasificarPeso({ peso: 'alto', posicion: 3 }).nivel, 'alto')
  assert.equal(clasificarPeso({ peso: 'alto', posicion: 1 }).puntaje, 3)
})

test('clasificarPeso: aparece en su prefijo pero al fondo = medio', () => {
  // climatizador evaporativo #5 de 10, piscina inflable #5 de 10
  assert.equal(clasificarPeso({ peso: 'alto', posicion: 5 }).nivel, 'medio')
  assert.equal(clasificarPeso({ peso: 'alto', posicion: 10 }).nivel, 'medio')
})

test('clasificarPeso: raíz viva sin posición propia = medio', () => {
  // rascador gato: no está en la lista pero sí "rascador gato sillon"
  const r = clasificarPeso({ peso: 'alto', posicion: null, derivadas: ['rascador gato sillon'] })
  assert.equal(r.nivel, 'medio')
})

test('clasificarPeso: solo asoma con dos palabras = bajo (cola larga)', () => {
  // saca puntos negros #8 en "saca p"; organizador cosmeticos #6 en "organizador c"
  assert.equal(clasificarPeso({ peso: 'medio', posicion: 8 }).nivel, 'bajo')
  assert.equal(clasificarPeso({ peso: 'medio', posicion: 1 }).nivel, 'bajo')
})

test('clasificarPeso: nadie la escribe = nulo', () => {
  // set snorkel, cascada solar jardin fuente, disfraz fiestas patrias niño
  assert.equal(clasificarPeso({ peso: 'nulo' }).nivel, 'nulo')
  assert.equal(clasificarPeso({ peso: 'nulo' }).puntaje, 0)
  assert.equal(clasificarPeso(null).nivel, 'nulo')
  assert.equal(clasificarPeso(undefined).nivel, 'nulo')
})

test('explicar: el nulo dice qué SÍ se busca con ese prefijo', () => {
  const texto = explicar({
    nivel: 'nulo',
    prefijo: 'cascada',
    alternativas: ['cascada chocolate', 'cascada solar', 'cascada luces'],
  })
  assert.match(texto, /Nadie escribe/)
  assert.match(texto, /cascada solar/)
})

test('explicar: cuando la keyword difiere de lo que la gente teclea, lo dice', () => {
  const texto = explicar({ nivel: 'alto', prefijo: 'arbol', posicion: 1, deCuantas: 10, seEscribe: 'arbol navidad' })
  assert.match(texto, /#1 de 10/)
  assert.match(texto, /arbol navidad/)
})

test('explicar: sin medición no inventa nada', () => {
  assert.equal(explicar(null), null)
})
