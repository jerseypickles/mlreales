import test from 'node:test'
import assert from 'node:assert/strict'
import { esDeLicencia } from '../src/services/sugeridor.js'
import { detectarTramites, detectarTallas } from '../src/services/oportunidades.js'

test('radar: una franquicia se veta, el producto genérico y el regulado no', () => {
  for (const k of ['stitch peluche', 'mochila Spiderman', 'figura Pokémon', 'set lego ciudad']) assert.equal(esDeLicencia(k), true, k)
  for (const k of ['peluche gigante', 'creatina monohidratada', 'reloj inteligente', 'pistola de juguete', 'legos para armar']) assert.equal(esDeLicencia(k), false, k)
})

test('trámites: el radar etiqueta SUBTEL y SEREMI desde el texto de riesgo', () => {
  assert.deepEqual(detectarTramites(['SUBTEL: homologación por Bluetooth']), ['SUBTEL'])
  assert.deepEqual(detectarTramites(['SEREMI: suplemento alimenticio, rotulado en español']), ['SEREMI'])
  assert.deepEqual(detectarTramites(['Sin trámite. No requiere SEC ni SUBTEL']), [])
})

test('tallas: se marca cuando el riesgo las menciona, no cuando las niega ni con talla única', () => {
  assert.equal(detectarTallas(['Devoluciones por talla y riesgo de estampados']), true)
  assert.equal(detectarTallas(['El tallaje de anillo inmoviliza stock por medida']), true)
  assert.equal(detectarTallas(['Sin tallas: producto de medida estándar']), false)
  assert.equal(detectarTallas(['Se vende en talla única']), false)
  assert.equal(detectarTallas(['SEC por ser 220V', null]), false)
})

test('radar: una búsqueda con código de modelo es de una marca puntual; una medida no es un modelo', async () => {
  const { tieneCodigoDeModelo } = await import('../src/services/sugeridor.js')
  for (const t of ['carburador para desbrozadora 226r', 'carburador para motosierra ms310', 'control ps5', 'funda s24 ultra', 'tarjeta gtx1060']) assert.equal(tieneCodigoDeModelo(t), true, t)
  for (const t of ['taladro 20v', 'foco led 200w', 'cable usb 3m', 'memoria 128gb', 'pack x2 toallas', 'hojas a4', 'set 56 pinceles', 'dispensador de jabon liquido', 'bateria 10000mah', 'tv 4k']) assert.equal(tieneCodigoDeModelo(t), false, t)
})
