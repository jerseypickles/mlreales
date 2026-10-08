import test from 'node:test'
import assert from 'node:assert/strict'
import { saltos, efectoDe, rangoDias } from '../src/services/eventosComerciales.js'

const serie = (n, f) => Array.from({ length: n }, (_, i) => ({ dia: new Date(Date.UTC(2026, 8, 10) + i * 86400e3).toISOString().slice(0, 10), ...f(i) }))

test('eventos: un salto de ventas o visitas sin evento en el calendario se detecta y se agrupan los días seguidos', () => {
  // 25 días normales (2 ventas, 50 visitas) y dos días como el CyberDay
  const s = serie(28, (i) => (i === 25 || i === 26 ? { ventas: 10, visitas: 110 } : { ventas: 2, visitas: 50 }))
  const g = saltos(s)
  assert.equal(g.length, 1)
  assert.equal(g[0].dias.length, 2)
  // si esos días ya son de un evento, no se vuelven a marcar
  assert.equal(saltos(s, new Set(rangoDias(g[0].desde, g[0].hasta))).length, 0)
})

test('eventos: un día normal con una venta más no es salto', () => {
  const s = serie(28, (i) => ({ ventas: i === 25 ? 4 : 2, visitas: 50 }))
  assert.equal(saltos(s).length, 0)
})

test('eventos: el efecto se mide contra las dos semanas anteriores normales', () => {
  const s = serie(24, (i) => (i >= 21 ? { ventas: 10, visitas: 100, impresiones: 15000, clicks: 60, gasto: 6000 } : { ventas: 2, visitas: 50, impresiones: 12000, clicks: 30, gasto: 3000 }))
  const ev = { desde: s[21].dia, hasta: s[23].dia }
  const e = efectoDe(ev, s)
  assert.equal(e.factorVentas, 5)
  assert.equal(e.factorVisitas, 2)
  assert.equal(e.factorCtr, 1.6)
  assert.equal(e.factorCpc, 1)
})
