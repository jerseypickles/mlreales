import test from 'node:test'
import assert from 'node:assert/strict'
import { fueraDeFull } from '../src/services/tablero.js'

test('silla gamer: 83x63x35 y 19 kg cabe pero al límite; con 21 kg o 0,19 m³ no cabe', () => {
  const perfil = 'Caja 83x63x35 cm (181 cm de suma, cabe en Full), ~19 kg reales al límite del tope de 20 kg'
  assert.equal(fueraDeFull({ perfilFisico: perfil }).estado, 'al-limite')
  assert.equal(fueraDeFull({ perfilFisico: perfil, volumenM3: 0.19 }).estado, 'no-cabe')
  assert.equal(fueraDeFull({ perfilFisico: perfil, pesoKg: 21 }).estado, 'no-cabe')
  assert.equal(fueraDeFull({ perfilFisico: 'caja 130x40x40, 8 kg reales' }).estado, 'no-cabe')
  assert.equal(fueraDeFull({ perfilFisico: 'caja 40x30x20, 2 kg reales, 3 kg facturables' }), null)
  assert.equal(fueraDeFull({}), null)
})

test('los perfiles reales del analista: decimales con coma y pesos facturables no engañan a la regla', () => {
  assert.equal(fueraDeFull({ perfilFisico: 'Caja retail 26x23x13 cm (7.800 cm³ → 1,95 kg volumétricos), 1,8 kg reales, ~2 kg facturables: envío ~$3.600' }), null)
  assert.equal(fueraDeFull({ perfilFisico: 'caja retail 15x10x6 cm, 0,25 kg reales, 1 kg facturable, envío $3.250' }), null)
  assert.equal(fueraDeFull({ perfilFisico: 'bolsa polybag 26x20x5 cm, 0,35 kg reales, 1 kg facturable' }), null)
  assert.equal(fueraDeFull({ perfilFisico: 'Tubo de cartón 150x13x13 cm, 4,5 kg reales, 6,3 kg facturables' }).estado, 'no-cabe')
  const silla = fueraDeFull({ perfilFisico: 'Caja 83x63x35 cm (181 cm de suma, cabe en Full), ~19 kg reales al límite del tope de 20 kg, ~46 kg facturables por volumétrico' })
  assert.equal(silla.estado, 'al-limite')
})
