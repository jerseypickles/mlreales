import test from 'node:test'
import assert from 'node:assert/strict'
import { momentoDeCompra, compararPorMomento } from '../frontend/src/lib/momentoCompra.js'

const hoy = new Date('2026-09-24T12:00:00-03:00')
const plano = { score: 80, curvaAnual: { clasificacion: 'todo-el-año', busquedasMes: 5000 } }
const verano = { score: 70, curvaAnual: { clasificacion: 'estacional', periodos: { picos: [{ porque: { nombre: 'verano' } }] } }, ventana: { estado: 'ultimo-mes', pico: '2026-12' } }
const calculadora = { score: 75, curvaAnual: { clasificacion: 'todo-el-año', periodos: { picos: [{ meses: [12, 1], texto: 'dic-ene', multiplicador: 1.8, porque: { nombre: 'Navidad' } }] } } }

test('momento de compra: cada nicho dice por qué está donde está', () => {
  assert.equal(momentoDeCompra(verano, hoy).etiqueta, 'último mes · verano')
  assert.equal(momentoDeCompra(plano, hoy).etiqueta, 'todo el año')
  assert.equal(momentoDeCompra(calculadora, hoy).etiqueta, 'prepara pico dic-ene', 'faltan 2-4 meses para el pico: se prepara hoy')
  assert.equal(momentoDeCompra({ ...verano, ventana: { estado: 'futura', pico: '2027-12' } }, hoy).grupo, 'adelante')
  assert.equal(momentoDeCompra({ midiendo: true }, hoy).grupo, 'sin-medir')
})

test('lista mezclada: la temporada que se cierra sube sobre un plano parecido, no sobre uno claramente mejor', () => {
  const orden = (xs) => [...xs].sort((a, b) => compararPorMomento(a, b, hoy))
  assert.equal(orden([plano, verano])[0], verano, '70 + 25 > 80')
  const planoMuyBueno = { ...plano, score: 99 }
  assert.equal(orden([planoMuyBueno, verano])[0], planoMuyBueno, '99 > 95')
})
