import test from 'node:test'
import assert from 'node:assert/strict'
import { esDeLicencia } from '../src/services/sugeridor.js'
import { detectarTramites } from '../src/services/oportunidades.js'

test('radar: una franquicia se veta, el producto genérico y el regulado no', () => {
  for (const k of ['stitch peluche', 'mochila Spiderman', 'figura Pokémon', 'set lego ciudad']) assert.equal(esDeLicencia(k), true, k)
  for (const k of ['peluche gigante', 'creatina monohidratada', 'reloj inteligente', 'pistola de juguete', 'legos para armar']) assert.equal(esDeLicencia(k), false, k)
})

test('trámites: el radar etiqueta SUBTEL y SEREMI desde el texto de riesgo', () => {
  assert.deepEqual(detectarTramites(['SUBTEL: homologación por Bluetooth']), ['SUBTEL'])
  assert.deepEqual(detectarTramites(['SEREMI: suplemento alimenticio, rotulado en español']), ['SEREMI'])
  assert.deepEqual(detectarTramites(['Sin trámite. No requiere SEC ni SUBTEL']), [])
})
