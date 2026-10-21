import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { crearCacheTablero, crearInvalidador } from '../src/services/tableroCache.js'

// Un cálculo de mesa falso: cuenta las veces y se resuelve a mano, como el de
// producción que tardaba 6,5-16 s por pedido (21-oct-2026).
function calculoFalso() {
  const pendientes = []
  let veces = 0
  const calcular = ({ todos }) => {
    veces++
    const n = veces
    return new Promise((resolver, rechazar) => pendientes.push({ resolver: () => resolver([{ mesa: n, todos }]), rechazar }))
  }
  return { calcular, pendientes, veces: () => veces }
}
const reloj = () => {
  let t = 1_000_000
  return { ahora: () => t, avanzar: (ms) => { t += ms } }
}
const vuelta = () => new Promise((r) => setImmediate(r))

test('mesa guardada: fresca se entrega sin recalcular y dos pedidos a la vez esperan el mismo cálculo', async () => {
  const f = calculoFalso(), r = reloj()
  const c = crearCacheTablero({ calcular: f.calcular, ahora: r.ahora, frescoMs: 1000, viejoMs: 10_000 })
  const a = c.leer(), b = c.leer()
  await vuelta()
  assert.equal(f.veces(), 1, 'un solo cálculo para los dos pedidos')
  f.pendientes[0].resolver()
  const [ra, rb] = await Promise.all([a, b])
  assert.equal(ra.oportunidades, rb.oportunidades)
  assert.equal(ra.refrescando, false)
  r.avanzar(500)
  const fresca = await c.leer()
  assert.equal(fresca.oportunidades[0].mesa, 1)
  assert.equal(f.veces(), 1, 'fresca: sin recalcular')
})

test('mesa vieja: se entrega al tiro y se rearma atrás; el pedido siguiente trae la nueva', async () => {
  const f = calculoFalso(), r = reloj()
  const c = crearCacheTablero({ calcular: f.calcular, ahora: r.ahora, frescoMs: 1000, viejoMs: 10_000 })
  const p = c.leer(); await vuelta(); f.pendientes[0].resolver(); await p
  r.avanzar(2000)
  const vieja = await c.leer()
  assert.equal(vieja.oportunidades[0].mesa, 1)
  assert.equal(vieja.refrescando, true)
  await vuelta()
  assert.equal(f.veces(), 2, 'rearmando atrás')
  const otra = await c.leer()
  assert.equal(otra.refrescando, true)
  assert.equal(f.veces(), 2, 'el rearmado en curso no se duplica')
  f.pendientes[1].resolver(); await vuelta(); await vuelta()
  const nueva = await c.leer()
  assert.equal(nueva.oportunidades[0].mesa, 2)
  assert.equal(nueva.refrescando, false)
})

test('un cambio del importador invalida: el pedido siguiente espera el cálculo nuevo, nunca la mesa de antes', async () => {
  const f = calculoFalso(), r = reloj()
  const c = crearCacheTablero({ calcular: f.calcular, ahora: r.ahora, frescoMs: 1000, viejoMs: 10_000 })
  const p = c.leer(); await vuelta(); f.pendientes[0].resolver(); await p
  c.invalidar() // ej: cotizar
  let listo = false
  const despues = c.leer().then((x) => { listo = true; return x })
  await vuelta(); await vuelta()
  assert.equal(listo, false, 'no se entrega la mesa de antes del cambio')
  assert.equal(f.veces(), 2)
  f.pendientes[1].resolver()
  assert.equal((await despues).oportunidades[0].mesa, 2)
})

test('si se invalida mientras se calcula, ese resultado no queda guardado', async () => {
  const f = calculoFalso(), r = reloj()
  const c = crearCacheTablero({ calcular: f.calcular, ahora: r.ahora, frescoMs: 1000, viejoMs: 10_000 })
  const enCurso = c.leer(); await vuelta()
  c.invalidar() // el cambio llegó con el cálculo a medias
  f.pendientes[0].resolver()
  assert.equal((await enCurso).oportunidades[0].mesa, 1, 'quien lo pidió antes del cambio lo recibe')
  const siguiente = c.leer(); await vuelta()
  assert.equal(f.veces(), 2, 'pero no se guardó: el siguiente recalcula')
  f.pendientes[1].resolver()
  assert.equal((await siguiente).oportunidades[0].mesa, 2)
})

test('un scan o un análisis envejecen la mesa: se sigue entregando mientras se rearma', async () => {
  const f = calculoFalso(), r = reloj()
  const c = crearCacheTablero({ calcular: f.calcular, ahora: r.ahora, frescoMs: 1000, viejoMs: 10_000 })
  const p = c.leer(); await vuelta(); f.pendientes[0].resolver(); await p
  c.envejecer()
  const x = await c.leer()
  assert.equal(x.oportunidades[0].mesa, 1)
  assert.equal(x.refrescando, true)
  await vuelta()
  assert.equal(f.veces(), 2)
})

test('activos y todos se guardan aparte; demasiado vieja se espera; si el rearmado atrás falla sigue la guardada', async () => {
  const f = calculoFalso(), r = reloj()
  const errores = []
  const c = crearCacheTablero({ calcular: f.calcular, ahora: r.ahora, frescoMs: 1000, viejoMs: 10_000, alFallar: (e) => errores.push(e.message) })
  const a = c.leer(); const t = c.leer({ todos: true }); await vuelta()
  assert.equal(f.veces(), 2, 'una por cada vista')
  f.pendientes[0].resolver(); f.pendientes[1].resolver()
  assert.equal((await t).oportunidades[0].todos, true)
  await a
  r.avanzar(2000)
  await c.leer(); await vuelta()
  f.pendientes[2].rechazar(new Error('mongo caído'))
  await vuelta(); await vuelta()
  assert.deepEqual(errores, ['mongo caído'])
  assert.equal((await c.leer()).oportunidades[0].mesa, 1, 'sigue la guardada')
  r.avanzar(20_000)
  let listo = false
  const lenta = c.leer().then(() => { listo = true })
  await vuelta(); await vuelta()
  assert.equal(listo, false, 'más vieja que viejoMs: se espera el cálculo')
  f.pendientes.at(-1).resolver()
  await lenta
})

test('invalidador: solo las escrituras que respondieron bien, y al terminar la respuesta', () => {
  let invalidaciones = 0
  const mw = crearInvalidador(() => { invalidaciones++ })
  const pedir = (method, statusCode) => {
    const res = Object.assign(new EventEmitter(), { statusCode })
    let siguio = false
    mw({ method }, res, () => { siguio = true })
    assert.equal(siguio, true)
    return res
  }
  const patch = pedir('PATCH', 200)
  assert.equal(invalidaciones, 0, 'el cambio todavía no llegó a la base')
  patch.emit('finish')
  assert.equal(invalidaciones, 1)
  pedir('POST', 400).emit('finish')
  pedir('GET', 200).emit('finish')
  pedir('OPTIONS', 204).emit('finish')
  assert.equal(invalidaciones, 1, 'ni errores ni lecturas')
  pedir('DELETE', 204).emit('finish')
  assert.equal(invalidaciones, 2)
})
