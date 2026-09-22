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
