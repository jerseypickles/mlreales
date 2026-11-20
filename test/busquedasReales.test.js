import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarTexto,
  palabrasClave,
  elegirMejorSugerencia,
  UMBRAL_PARECIDO, keywordReal } from '../src/services/busquedasReales.js'

test('normalizarTexto: minúsculas, sin tildes y espacios colapsados', () => {
  assert.equal(normalizarTexto('  Lámpara   SOLAR Jardín '), 'lampara solar jardin')
  assert.equal(normalizarTexto('guirnalda navideña'), 'guirnalda navidena')
})

test('palabrasClave: ignora stopwords y empata singular/plural', () => {
  assert.deepEqual(palabrasClave('freidora de aire'), palabrasClave('freidora aire'))
  assert.deepEqual(palabrasClave('foco solares'), palabrasClave('focos solares'))
  assert.deepEqual(palabrasClave('fuente solar'), palabrasClave('fuentes solares'))
})

test('elegirMejorSugerencia: keyword inventada larga matchea la búsqueda real que la contiene', () => {
  const mejor = elegirMejorSugerencia('reflector solar exterior sensor movimiento', [
    'reflector solar',
    'reflector solar sensor movimiento',
    'reflector solar led',
  ])
  assert.equal(mejor.keyword, 'reflector solar sensor movimiento')
  assert.ok(mejor.puntaje >= UMBRAL_PARECIDO)
})

test('elegirMejorSugerencia: intención distinta queda bajo el umbral', () => {
  // "cascada solar" en Chile es luces de navidad, no fuentes de jardín
  const mejor = elegirMejorSugerencia('cascada solar jardin fuente', [
    'cascada solar navidad',
    'cascada solar blanca',
    'cascada solar 5 metros',
  ])
  assert.ok(mejor.puntaje < UMBRAL_PARECIDO)
})

// El radar abrió un nicho con una palabra suelta: la idea era de dos palabras y la sugerencia de una sola empataba
// justo en el umbral (20-nov-2026). Una palabra genérica mezcla en el buscador productos que no tienen nada que ver.
test('elegirMejorSugerencia: una sola palabra no reemplaza a una idea de varias', () => {
  // con la frase completa entre las sugerencias, gana la que conserva las dos palabras
  const completa = elegirMejorSugerencia('set de pinceles', ['set', 'set de pinceles profesionales', 'set de brochas'])
  assert.equal(completa.keyword, 'set de pinceles profesionales')
  assert.ok(completa.puntaje >= UMBRAL_PARECIDO)
  // si lo único parecido es la palabra suelta, no hay búsqueda real que valga: queda bajo el umbral o sin candidata
  const suelta = elegirMejorSugerencia('set de pinceles', ['set', 'set de destornilladores'])
  assert.notEqual(suelta?.keyword, 'set')
  assert.ok(!suelta || suelta.puntaje < UMBRAL_PARECIDO)
  assert.equal(elegirMejorSugerencia('set de pinceles', ['set']), null)
  // quitarle una característica a una idea de tres palabras sigue valiendo
  const sinAtributo = elegirMejorSugerencia('lampara de escritorio led', ['lampara de escritorio', 'lampara'])
  assert.equal(sinAtributo.keyword, 'lampara de escritorio')
  assert.ok(sinAtributo.puntaje >= UMBRAL_PARECIDO)
  // y una idea de una sola palabra puede quedarse con la búsqueda de una palabra
  assert.equal(elegirMejorSugerencia('taladro', ['taladro', 'taladro inalambrico']).keyword, 'taladro')
})

test('elegirMejorSugerencia: stopwords y plurales no restan puntaje', () => {
  const mejor = elegirMejorSugerencia('freidora de aire', ['freidora aire', 'freidora sin aceite'])
  assert.equal(mejor.keyword, 'freidora aire')
  assert.equal(mejor.puntaje, 1)
})

test('elegirMejorSugerencia: coincidencia exacta puntúa 1', () => {
  const mejor = elegirMejorSugerencia('depiladora laser', ['depiladora laser', 'depiladora facial'])
  assert.equal(mejor.keyword, 'depiladora laser')
  assert.equal(mejor.puntaje, 1)
})

test('elegirMejorSugerencia: sin sugerencias devuelve null', () => {
  assert.equal(elegirMejorSugerencia('lo que sea', []), null)
})

test('palabrasSaturadas: detecta la raíz que domina el tablero', async () => {
  const { palabrasSaturadas } = await import('../src/services/sugeridor.js')
  const saturadas = palabrasSaturadas([
    'foco solares',
    'fuente agua solar',
    'lampara solar jardin',
    'guirnalda solar',
    'freidora de aire',
    'depiladora laser',
  ])
  assert.ok(saturadas.has('solar'))
  assert.ok(!saturadas.has('freidora'))
  assert.ok(!saturadas.has('depiladora'))
})

test('keywordReal: adopta la forma que la gente TECLEA, no la comprimida', async (t) => {
  // El origen de las keywords inventadas: palabrasClave bota "de", así que
  // "rizador pelo" y "rizador de pelo" empatan por raíces y antes ganaba la
  // nuestra. Medido el 12-ago-2026 en Google Chile: 50 búsquedas/mes contra
  // 9.900 de "ondulador de pelo". La preposición se llevaba el mercado.
  const global_ = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ suggested_queries: [{ q: 'rizador de pelo' }, { q: 'rizador de pelo profesional' }] }),
  })
  t.after(() => {
    globalThis.fetch = global_
  })

  const r = await keywordReal('rizador pelo', { pausaMs: 0 })
  assert.equal(r.keyword, 'rizador de pelo', 'gana la forma real del autosuggest')
  assert.equal(r.exacta, true)
})

// El buscador de pega: responde como el autocompletado real, que es por prefijo, guarda las frases sin preposiciones
// (a una consulta con «de» o «para» no le devuelve nada) y entrega solo las primeras de cada prefijo, de la más
// buscada a la menos: por eso una frase larga no aparece al preguntar por su primera palabra. Anota lo preguntado.
function buscadorDePega(t, frases, { tope = 3 } = {}) {
  const preguntas = []
  const real = globalThis.fetch
  globalThis.fetch = async (url) => {
    const q = new URL(url).searchParams.get('q')
    preguntas.push(q)
    return { ok: true, status: 200, json: async () => ({ suggested_queries: frases.filter((f) => f.startsWith(q)).slice(0, tope).map((f) => ({ q: f })) }) }
  }
  t.after(() => {
    globalThis.fetch = real
  })
  return preguntas
}

test('keywordReal: pregunta sin preposiciones y encuentra la frase completa de la idea', async (t) => {
  // 20-nov-2026: preguntando con la frase literal no respondía nada hasta llegar a la primera palabra sola, y de sus
  // sugerencias ganaba la idea recortada (una máquina portátil quedó midiendo todas las máquinas).
  const preguntas = buscadorDePega(t, ['taladro', 'taladro inalambrico', 'taladro percutor', 'taladro atornillador', 'taladro percutor inalambrico'])
  const r = await keywordReal('taladro percutor inalámbrico', { pausaMs: 0 })
  assert.equal(r.keyword, 'taladro percutor inalambrico')
  assert.equal(r.exacta, true)

  const conPreposiciones = await keywordReal('regadera de jardín para niños', { pausaMs: 0 })
  assert.equal(conPreposiciones, null, 'nadie escribe nada parecido: no hay frase real')
  assert.ok(preguntas.every((q) => !/\b(de|para|con)\b/.test(q)), `ninguna consulta lleva preposiciones: ${preguntas.join(' | ')}`)
})

test('keywordReal: una idea con preposiciones se queda con su frase completa, no con la recortada', async (t) => {
  buscadorDePega(t, ['lampara', 'lampara escritorio', 'lampara pie', 'lampara solar', 'lampara escritorio led'])
  const r = await keywordReal('lámpara de escritorio led', { pausaMs: 0 })
  assert.equal(r.keyword, 'lampara escritorio led', 'antes quedaba en «lampara escritorio»: perdía la característica')
  assert.equal(r.exacta, true)
})

test('keywordReal: si la frase completa no existe, sigue valiendo la más parecida de dos palabras o más', async (t) => {
  buscadorDePega(t, ['pinceles', 'pinceles acuarela', 'pinceles maquillaje'])
  const r = await keywordReal('pinceles de acuarela profesionales', { pausaMs: 0 })
  assert.equal(r.keyword, 'pinceles acuarela')
  assert.equal(r.exacta, false)
})
