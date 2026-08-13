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
