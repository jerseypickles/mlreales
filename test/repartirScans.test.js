import test from 'node:test'
import assert from 'node:assert/strict'
import { repartirScans } from '../src/jobs/workers.js'

// Caso real del 10-ago-2026: 78 nichos maduraron juntos entre el 6 y el 8 de
// agosto, así que su semana venció junta — 46 de 50 scans caían en 3 días,
// justo los últimos del ciclo de Apify (US$213,85 de US$250).

const nicho = (nombre, atraso, madurando = false) => ({ nicho: { _id: nombre }, madurando, atraso })

test('con cupo de sobra pasan todos', () => {
  const vencidos = [nicho('a', 100), nicho('b', 200)]
  const r = repartirScans({ vencidos, yaHoy: 0, techo: 12 })
  assert.equal(r.aEncolar.length, 2)
  assert.equal(r.diferidos, 0)
})

test('la manada se recorta al techo y el resto espera turno', () => {
  const vencidos = Array.from({ length: 46 }, (_, i) => nicho(`n${i}`, i * 1000))
  const r = repartirScans({ vencidos, yaHoy: 0, techo: 12 })
  assert.equal(r.aEncolar.length, 12)
  assert.equal(r.diferidos, 34, 'los 34 restantes NO se pierden: vuelven en la próxima pasada')
})

test('pasa primero el que más tiempo lleva esperando', () => {
  const vencidos = [nicho('reciente', 10), nicho('viejo', 90_000), nicho('medio', 500)]
  const { aEncolar } = repartirScans({ vencidos, yaHoy: 0, techo: 2 })
  assert.deepEqual(aEncolar.map((v) => v.nicho._id), ['viejo', 'medio'])
})

test('lo ya escaneado en las últimas 24 h consume cupo', () => {
  const vencidos = Array.from({ length: 10 }, (_, i) => nicho(`n${i}`, i))
  const r = repartirScans({ vencidos, yaHoy: 9, techo: 12 })
  assert.equal(r.aEncolar.length, 3)
  assert.equal(r.diferidos, 7)
})

test('con el cupo consumido no se encola nada, y nunca queda negativo', () => {
  const vencidos = [nicho('a', 1), nicho('b', 2)]
  const r = repartirScans({ vencidos, yaHoy: 30, techo: 12 })
  assert.equal(r.aEncolar.length, 0)
  assert.equal(r.diferidos, 2)
})

test('no muta la lista que recibe', () => {
  const vencidos = [nicho('a', 1), nicho('b', 900)]
  const copia = [...vencidos]
  repartirScans({ vencidos, yaHoy: 0, techo: 1 })
  assert.deepEqual(vencidos, copia, 'ordenar in-place rompería al llamador')
})
