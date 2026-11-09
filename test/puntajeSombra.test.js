import test from 'node:test'
import assert from 'node:assert/strict'
import { demandaMedida, puntajeAlterno, compararPuntajes, cambiosEnLaMesa, ordenConEmpates, MIN_CASOS_PUNTAJE } from '../src/services/ml/puntajeSombra.js'

const base = { demanda: 80, constancia: 70, entrada: 60, economia: 90, competencia: 50 }

test('puntaje alterno: la venta medida mueve el puntaje y sin ella no hay alterno', () => {
  assert.equal(demandaMedida(0), 0)
  assert.equal(demandaMedida(60), 100)
  assert.equal(demandaMedida(600), 100)
  const poco = puntajeAlterno({ componentes: base, reseniasDia: 1 })
  const mucho = puntajeAlterno({ componentes: base, reseniasDia: 50 })
  assert.ok(mucho > poco + 10, `con la misma búsqueda, vender más sube el puntaje (${poco} → ${mucho})`)
  assert.equal(puntajeAlterno({ componentes: base, reseniasDia: null }), null)
  assert.equal(puntajeAlterno({ componentes: { ...base, economia: null }, reseniasDia: 5 }), null)
  assert.ok(puntajeAlterno({ componentes: base, reseniasDia: 50, confianza: 0.5 }) < mucho, 'conserva el descuento por búsqueda')
})

test('puntaje alterno: contra las ventas reales pide muestra antes de dar un ganador', () => {
  const casos = Array.from({ length: MIN_CASOS_PUNTAJE }, (_, i) => ({ actual: 80 - i, alterno: 50 + i * 3, ventaDia: i }))
  assert.equal(compararPuntajes(casos.slice(0, 4)).estado, 'pocos-casos')
  const r = compararPuntajes(casos)
  assert.equal(r.ordenAlterno, 1)
  assert.equal(r.ordenActual, -1)
  assert.equal(r.estado, 'gana-alterno')
})

test('puntaje alterno: dice quién sube y quién baja en la mesa', () => {
  const r = cambiosEnLaMesa([
    { keyword: 'caro sin venta', actual: 85, alterno: 60 }, { keyword: 'parejo', actual: 75, alterno: 74 },
    { keyword: 'barato que vende', actual: 62, alterno: 80 }, { keyword: 'sin medir', actual: 70, alterno: null },
  ])
  assert.equal(r.nichos, 3)
  assert.equal(r.sinVentaMedida, 1)
  assert.equal(r.suben[0].keyword, 'barato que vende')
  assert.equal(r.bajan[0].keyword, 'caro sin venta')
})

test('puntaje alterno: los empates no dependen del orden de llegada', () => {
  // tres productos sin ventas y tres con: un puntaje que separa bien los dos grupos ordena bien, llegue como llegue
  const a = [50, 51, 52, 80, 81, 82], v = [0, 0, 0, 1, 2, 3]
  const alReves = [52, 51, 50, 80, 81, 82]
  assert.ok(ordenConEmpates(a, v) > 0.85)
  assert.equal(ordenConEmpates(a, v), ordenConEmpates(alReves, v), 'los tres empatados en cero valen lo mismo en cualquier orden')
  assert.equal(ordenConEmpates([1, 1, 1], [1, 2, 3]), null, 'sin variación no hay orden que medir')
  const m = cambiosEnLaMesa([{ keyword: 'a', actual: 70, alterno: 70 }, { keyword: 'b', actual: 70, alterno: 70 }, { keyword: 'c', actual: 60, alterno: 60 }])
  assert.equal(m.suben.length + m.bajan.length, 0, 'dos nichos empatados no se mueven de lugar')
})
