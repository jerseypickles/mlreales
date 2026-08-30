import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizar,
  cabeza,
  evaluarKeyword,
  medirCandidatas,
  mereceRevision,
} from '../src/services/cruceKeywords.js'

// Tendencias REALES que publica ML por categoría, medidas el 30-ago-2026.
const TENDENCIAS = {
  manguera: ['manguera de jardin', 'mangueras jardin', 'mangera', 'mangueras agua', 'manguera 1 pulgada'],
  cooler: ['cooler 60 litros', 'cooler', 'cooler electrico', 'alpicool', 'mini refrigerador'],
  espejo: ['espejos de bolsillo por mayor', 'espejo de aumento 20x', 'espejo triple', 'espejo de bolsillo'],
  cortina: ['cortina roller doble', 'cortinas para cocina', 'persianas', 'cortina blackout 200x200'],
}

test('normalizar iguala acentos, mayúsculas y plurales simples', () => {
  assert.deepEqual(normalizar('Mangueras de Jardín'), ['manguera', 'jardin'])
  assert.deepEqual(normalizar('manguera jardin'), ['manguera', 'jardin'])
  // no se tocan las palabras cortas: "gas" no es plural de "ga"
  assert.deepEqual(normalizar('gas'), ['gas'])
  assert.deepEqual(normalizar(''), [])
  assert.deepEqual(normalizar(null), [])
})

test('la cabeza es el sustantivo, que en español va primero', () => {
  assert.equal(cabeza('manguera extensible'), 'manguera')
  assert.equal(cabeza('cortina blackout'), 'cortina')
  assert.equal(cabeza(''), null)
})

// El caso que motivó todo: manguera venía de ser un ENTRAR con score 89 y hoy
// mide 260 búsquedas al mes. El nicho no se murió — nadie escribe "manguera
// extensible", escriben "manguera de jardin".
test('detecta la variante: mismo producto, otra forma de nombrarlo', () => {
  const e = evaluarKeyword('manguera extensible', TENDENCIAS.manguera)
  assert.equal(e.estado, 'variante')
  assert.equal(e.sugerida, 'manguera de jardin')
  assert.ok(e.alternativas.length > 1, 'ofrece más de una para poder elegir')
})

test('una keyword que sí se busca no se marca', () => {
  const e = evaluarKeyword('cortina blackout', TENDENCIAS.cortina)
  assert.equal(e.estado, 'coincide')
  assert.equal(e.sugerida, null)
})

test('sin tendencias no se opina, y sin keyword tampoco', () => {
  assert.equal(evaluarKeyword('lo que sea', []).estado, 'sin-datos')
  assert.equal(evaluarKeyword('', TENDENCIAS.manguera).estado, 'sin-datos')
})

test('si ni la cabeza aparece, el nicho es de otra cosa', () => {
  const e = evaluarKeyword('taladro percutor', TENDENCIAS.manguera)
  assert.equal(e.estado, 'ajena')
})

// LA SUGERENCIA SE MIDE, NO SE ADIVINA.
//
// Por orden de ML ganaba "espejos de bolsillo por mayor" —un aviso mayorista— y
// por longitud ganaba "mangera", que es un error de tipeo. Preguntarle el
// volumen a Google resuelve las dos.
test('gana la candidata más buscada, no la primera ni la más corta', async () => {
  const volumenes = {
    'manguera extensible': 260, 'manguera de jardin': 8100, 'mangueras jardin': 1900,
    mangera: 50, 'mangueras agua': 390,
  }
  const volumenMensual = async (ks) => new Map(ks.map((k) => [k, { busquedasMes: volumenes[k] ?? null }]))
  const e = await medirCandidatas('manguera extensible', evaluarKeyword('manguera extensible', TENDENCIAS.manguera), { volumenMensual })
  assert.equal(e.sugerida, 'manguera de jardin')
  assert.equal(e.vecesMas, 31.2)
  assert.match(e.motivo, /8\.100/)
})

test('si la nuestra ya es la más buscada, no hay nada que sugerir', async () => {
  const volumenMensual = async (ks) =>
    new Map(ks.map((k) => [k, { busquedasMes: k === 'manguera extensible' ? 9000 : 100 }]))
  const e = await medirCandidatas('manguera extensible', evaluarKeyword('manguera extensible', TENDENCIAS.manguera), { volumenMensual })
  assert.equal(e.estado, 'coincide')
  assert.equal(e.sugerida, null)
})

test('si no se puede medir, la señal sigue sirviendo sin volumen', async () => {
  const rompe = async () => { throw new Error('sin credenciales') }
  const e = await medirCandidatas('manguera extensible', evaluarKeyword('manguera extensible', TENDENCIAS.manguera), { volumenMensual: rompe })
  assert.equal(e.estado, 'variante')
  assert.equal(e.sugerida, 'manguera de jardin', 'cae al orden de ML')
})

// Una keyword específica NO es un problema por sí sola: muchas búsquedas
// específicas son legítimas. Lo que enciende la alarma es variante CON VOLUMEN
// BAJO, porque ahí el número probablemente sea de la palabra y no del producto.
test('solo alarma la variante con volumen bajo', () => {
  const variante = { estado: 'variante' }
  assert.equal(mereceRevision({ evaluacion: variante, busquedasMes: 260 }), true)
  assert.equal(mereceRevision({ evaluacion: variante, busquedasMes: 22_200 }), false)
  assert.equal(mereceRevision({ evaluacion: { estado: 'coincide' }, busquedasMes: 100 }), false)
  assert.equal(mereceRevision({ evaluacion: variante, busquedasMes: null }), false)
})
