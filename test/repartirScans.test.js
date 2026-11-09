import test from 'node:test'
import assert from 'node:assert/strict'
import { repartirScans, metaDeReposicion } from '../src/jobs/workers.js'

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

test('repartirScans: los que maduran pasan primero, hasta la mitad del cupo', () => {
  const vencidos = [
    ...Array.from({ length: 10 }, (_, i) => ({ nicho: `semanal-${i}`, madurando: false, atraso: 100 - i })),
    ...Array.from({ length: 6 }, (_, i) => ({ nicho: `nuevo-${i}`, madurando: true, atraso: 10 - i })),
  ]
  const { aEncolar, diferidos } = repartirScans({ vencidos, yaHoy: 0, techo: 8 })
  assert.equal(aEncolar.filter((v) => v.madurando).length, 4, 'la mitad del cupo es de los que maduran')
  assert.deepEqual(aEncolar.slice(0, 4).map((v) => v.nicho), ['nuevo-0', 'nuevo-1', 'nuevo-2', 'nuevo-3'])
  assert.equal(aEncolar[4].nicho, 'semanal-0', 'el resto sigue por atraso')
  assert.equal(diferidos, 8)
  const sinNuevos = repartirScans({ vencidos: vencidos.filter((v) => !v.madurando), yaHoy: 0, techo: 8 })
  assert.equal(sinNuevos.aEncolar.length, 8, 'si nadie madura, el cupo entero es de los semanales')
})

test('reposición de fichas: repone lo que falta de lo pedido, con tope, y nunca baja del mínimo para puntuar', () => {
  assert.equal(metaDeReposicion({ pedidas: 20, conDetalle: 14, minimo: 5, tope: 6 }), 20)
  assert.equal(metaDeReposicion({ pedidas: 20, conDetalle: 8, minimo: 5, tope: 3 }), 11, 'el tope acota el gasto')
  assert.equal(metaDeReposicion({ pedidas: 20, conDetalle: 20, minimo: 5, tope: 3 }), 20, 'si todo llegó no se pide nada')
  assert.equal(metaDeReposicion({ pedidas: 10, conDetalle: 2, minimo: 5, tope: 0 }), 5, 'apagada, queda el mínimo de siempre')
})

test('repartirScans: un recién creado sin puntaje pasa con prioridad aunque no esté madurando', () => {
  const vencidos = [
    ...Array.from({ length: 6 }, (_, i) => ({ nicho: `semanal-${i}`, madurando: false, prioridad: false, atraso: 100 - i })),
    { nicho: 'recien-creado', madurando: false, prioridad: true, atraso: 1 },
  ]
  const { aEncolar } = repartirScans({ vencidos, yaHoy: 0, techo: 4 })
  assert.equal(aEncolar[0].nicho, 'recien-creado')
  assert.equal(aEncolar.length, 4)
})
