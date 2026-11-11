import test from 'node:test'
import assert from 'node:assert/strict'
import { crearCacheVivo } from '../src/services/cacheVivo.js'

// un cálculo que cuenta cuántas veces corrió y se puede dejar a medias
function calculo() {
  let n = 0
  const pendientes = []
  const calcular = () => {
    n++
    const numero = n
    return new Promise((resolver) => pendientes.push(() => resolver(`calculo-${numero}`)))
  }
  return { calcular, veces: () => n, terminar: () => pendientes.shift()?.() }
}
const tic = () => new Promise((r) => setImmediate(r))

test('cache vivo: la primera visita espera el cálculo y las siguientes lo reciben al tiro', async () => {
  let t = 0
  const c = calculo()
  const cache = crearCacheVivo({ calcular: c.calcular, ahora: () => t, frescoMs: 100 })
  const primera = cache.leer()
  const segunda = cache.leer() // dos visitas a la vez comparten el mismo cálculo
  await tic(); c.terminar()
  assert.deepEqual([(await primera).valor, (await segunda).valor], ['calculo-1', 'calculo-1'])
  assert.equal(c.veces(), 1)
  t = 50
  const r = await cache.leer()
  assert.deepEqual([r.valor, r.refrescando, c.veces()], ['calculo-1', false, 1])
})

test('cache vivo: vieja, entrega lo guardado y rearma detrás; la visita siguiente ya trae lo nuevo', async () => {
  let t = 0
  const c = calculo()
  const cache = crearCacheVivo({ calcular: c.calcular, ahora: () => t, frescoMs: 100 })
  const p = cache.leer(); await tic(); c.terminar(); await p
  t = 500
  const vieja = await cache.leer()
  assert.deepEqual([vieja.valor, vieja.refrescando], ['calculo-1', true], 'no espera')
  assert.equal(c.veces(), 2, 'el rearmado partió detrás')
  await tic(); c.terminar(); await tic()
  assert.equal((await cache.leer()).valor, 'calculo-2')

  // envejecer hace lo mismo sin esperar el plazo: llegaron datos nuevos
  cache.envejecer()
  const r = await cache.leer()
  assert.deepEqual([r.valor, r.refrescando, c.veces()], ['calculo-2', true, 3])
})

test('cache vivo: tras un cambio del dueño se espera el cálculo nuevo, y uno que venía de antes no lo pisa', async () => {
  let t = 0
  const c = calculo()
  const cache = crearCacheVivo({ calcular: c.calcular, ahora: () => t, frescoMs: 100 })
  const p = cache.leer(); await tic(); c.terminar(); await p

  t = 500
  await cache.leer() // parte el cálculo 2 detrás, con los datos de ANTES del cambio
  cache.invalidar() // el dueño edita
  let resuelta = false
  const despues = cache.leer().then((r) => { resuelta = true; return r })
  await tic()
  assert.equal(c.veces(), 3, 'no reutiliza el cálculo que partió antes del cambio')
  c.terminar() // termina el 2 (viejo)
  await tic()
  assert.equal(resuelta, false, 'sigue esperando el suyo')
  c.terminar() // termina el 3
  assert.equal((await despues).valor, 'calculo-3')
  assert.equal((await cache.leer()).valor, 'calculo-3', 'y lo guardado es el nuevo, no el que venía de antes')
})

test('cache vivo: pedirla fresca obliga a recalcular; calentar no rompe si el cálculo falla', async () => {
  let n = 0
  const cache = crearCacheVivo({ calcular: async () => `v${++n}`, frescoMs: 1e6 })
  assert.equal((await cache.leer()).valor, 'v1')
  assert.equal((await cache.leer()).valor, 'v1')
  assert.equal((await cache.leer({ fresca: true })).valor, 'v2')

  const avisos = []
  const mala = crearCacheVivo({ calcular: async () => { throw new Error('se cayó') }, alFallar: (e) => avisos.push(e.message) })
  assert.equal(await mala.calentar(), null)
  assert.deepEqual(avisos, ['se cayó'])
  await assert.rejects(mala.leer(), /se cayó/, 'quien la pide de verdad sí se entera')
})
