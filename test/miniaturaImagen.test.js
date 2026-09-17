import { test } from 'node:test'
import assert from 'node:assert/strict'
import { miniatura } from '../frontend/src/lib/imagen.js'

// Medido el 17-sep: "Competidores por nicho" bajaba 6,5 MB de fotos de 500 px para
// pintarlas a 44 px. La miniatura pide la variante -I a 2X (0,9 MB en total).
test('miniatura: cambia la foto de 500 px de ML por la variante chica a 2X', () => {
  assert.equal(miniatura('https://http2.mlstatic.com/D_NQ_NP_800631-MLA96099595841_102025-O.webp'), 'https://http2.mlstatic.com/D_NQ_NP_2X_800631-MLA96099595841_102025-I.webp')
  assert.equal(miniatura('http://http2.mlstatic.com/D_NQ_NP_603007-MLA85184161315_052025-O.jpg'), 'https://http2.mlstatic.com/D_NQ_NP_2X_603007-MLA85184161315_052025-I.webp')
  assert.equal(miniatura('https://http2.mlstatic.com/D_Q_NP_2X_649363-MLC97802594558_112025-F.webp'), 'https://http2.mlstatic.com/D_Q_NP_2X_649363-MLC97802594558_112025-I.webp')
})

test('miniatura: lo que no es una foto de ML se deja igual (solo pasa a https)', () => {
  assert.equal(miniatura('http://otro.cdn.com/foto-O.jpg'), 'https://otro.cdn.com/foto-O.jpg')
  assert.equal(miniatura('https://http2.mlstatic.com/resources/logo.png'), 'https://http2.mlstatic.com/resources/logo.png')
  assert.equal(miniatura(null), null)
  assert.equal(miniatura(''), null)
})
