import test from 'node:test'
import assert from 'node:assert/strict'
import { candidatasMecanicas, elegirCorreccion } from '../src/services/correccionKeyword.js'

test('candidatasMecanicas: restaura preposiciones y prueba plurales', () => {
  const c = candidatasMecanicas('rizador pelo')
  assert.ok(c.includes('rizador pelo'), 'la original siempre está')
  assert.ok(c.includes('rizador de pelo'), 'la que la gente teclea')
  assert.ok(c.includes('rizador para pelo'))
  assert.ok(c.includes('rizador de pelos'), 'plural de la última')

  // una sola palabra no tiene juntura donde insertar nada
  assert.deepEqual(candidatasMecanicas('hidrolavadora'), ['hidrolavadora'])
})

test('elegirCorreccion: acepta la preposición, rechaza el cambio de sustantivo', () => {
  // volúmenes REALES de Google Chile (12-ago-2026)
  const medido = new Map([
    ['rizador pelo', 50],
    ['rizador de pelo', 1900],
    ['ondulador de pelo', 9900],
  ])
  const r = elegirCorreccion('rizador pelo', medido)
  assert.equal(r.keyword, 'rizador de pelo', 'misma palabra, preposición restaurada')
  assert.equal(r.volumen, 1900)
  assert.equal(r.factor, 38)
  // "ondulador" es otro sustantivo: aunque tenga 5x más volumen, no se aplica
  // solo — podría ser otro producto. Se muestra aparte para que decida el humano.
  assert.notEqual(r.keyword, 'ondulador de pelo')
})

test('elegirCorreccion: no corrige cuando no vale la pena', () => {
  // la original ya es la buena
  assert.equal(
    elegirCorreccion('pastillas de freno', new Map([['pastillas de freno', 5400], ['pastillas freno', 390]])),
    null,
  )
  // mejora marginal: no se toca
  assert.equal(
    elegirCorreccion('cama para perro', new Map([['cama para perro', 1000], ['cama de perro', 1100]])),
    null,
  )
  assert.equal(elegirCorreccion('lo que sea', new Map()), null)
})

test('corrección mecánica: purificador aire → purificador de aire, pero nunca un sinónimo', async () => {
  const { candidatasMecanicas, elegirCorreccion } = await import('../src/services/correccionKeyword.js')
  assert.ok(candidatasMecanicas('purificador aire').includes('purificador de aire'))
  assert.ok(candidatasMecanicas('selladora vacio').includes('selladora al vacio'))
  assert.ok(candidatasMecanicas('olla presion').includes('olla a presion'))
  const vols = new Map([['purificador aire', 320], ['purificador de aire', 14800], ['purificador para aire', 50]])
  assert.equal(elegirCorreccion('purificador aire', vols).keyword, 'purificador de aire')
  const sinonimo = new Map([['aspiradora escoba', 210], ['aspiradora vertical', 12100]])
  assert.equal(elegirCorreccion('aspiradora escoba', sinonimo), null, 'otro sustantivo: eso no se corrige solo')
})
