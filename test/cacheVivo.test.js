import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { crearCacheVivo, envejecerCachesVivos, invalidarVivosAlEscribir, nombresCachesVivos } from '../src/services/cacheVivo.js'

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

test('cache vivo: quien calcula con el dato no recibe uno pasado; la pantalla sí, mientras llega el nuevo', async () => {
  let t = 0
  const c = calculo()
  const cache = crearCacheVivo({ calcular: c.calcular, ahora: () => t, frescoMs: 100 })
  const p = cache.leer({ soloFresca: true }); await tic(); c.terminar()
  assert.equal((await p).valor, 'calculo-1')
  t = 50
  assert.equal((await cache.leer({ soloFresca: true })).valor, 'calculo-1', 'fresco: sirve a los dos')

  t = 500
  let resuelta = false
  const calculador = cache.leer({ soloFresca: true }).then((r) => { resuelta = true; return r })
  const pantalla = await cache.leer()
  assert.deepEqual([pantalla.valor, pantalla.refrescando], ['calculo-1', true], 'la pantalla no espera')
  await tic()
  assert.equal(resuelta, false, 'el que calcula sí espera')
  assert.equal(c.veces(), 2, 'y los dos comparten el mismo cálculo')
  c.terminar()
  assert.deepEqual([(await calculador).valor, (await calculador).refrescando], ['calculo-2', false])
})

test('cache vivo: pedirla fresca no se conforma con un cálculo que ya venía en camino', async () => {
  let t = 0
  const c = calculo()
  const cache = crearCacheVivo({ calcular: c.calcular, ahora: () => t, frescoMs: 100 })
  const p = cache.leer(); await tic(); c.terminar(); await p
  t = 500
  await cache.leer() // parte el cálculo 2 detrás
  const fresca = cache.leer({ fresca: true })
  await tic()
  assert.equal(c.veces(), 3, 'parte uno nuevo')
  c.terminar(); c.terminar()
  assert.equal((await fresca).valor, 'calculo-3')
})

test('cache vivo: una escritura del dueño invalida solo los cachés que cambian con esa ruta', async () => {
  const veces = { propios: 0, nichos: 0 }
  const dePropios = crearCacheVivo({ nombre: 'prueba-propios', cambiaCon: ['/api/propios', '/api/meli'], frescoMs: 1e6, calcular: async () => ++veces.propios })
  const deNichos = crearCacheVivo({ nombre: 'prueba-nichos', cambiaCon: ['/api/nichos'], frescoMs: 1e6, calcular: async () => ++veces.nichos })
  await dePropios.leer(); await deNichos.leer()
  assert.ok(['prueba-propios', 'prueba-nichos'].every((n) => nombresCachesVivos().includes(n)))

  const pedir = (method, originalUrl, statusCode) => {
    const res = new EventEmitter()
    res.statusCode = statusCode
    let siguio = false
    invalidarVivosAlEscribir({ method, originalUrl }, res, () => { siguio = true })
    assert.ok(siguio, 'nunca frena el pedido')
    res.emit('finish')
  }
  pedir('GET', '/api/propios', 200) // leer no invalida
  pedir('PATCH', '/api/propios/abc', 500) // una escritura que falló, tampoco
  assert.deepEqual([(await dePropios.leer()).valor, (await deNichos.leer()).valor], [1, 1])

  pedir('PATCH', '/api/propios/abc', 200)
  assert.deepEqual([(await dePropios.leer()).valor, (await deNichos.leer()).valor], [2, 1], 'solo el de propios se rearma')
  pedir('POST', '/api/meli/importar-items', 200)
  pedir('POST', '/api/nichos', 201)
  assert.deepEqual([(await dePropios.leer()).valor, (await deNichos.leer()).valor], [3, 2])
})

test('cache vivo: al llegar datos nuevos los anotados se rearman de a uno, sirviendo lo guardado mientras tanto', async () => {
  const orden = []
  let enCurso = 0, maximo = 0
  const lento = (nombre) => async () => {
    enCurso++; maximo = Math.max(maximo, enCurso)
    orden.push(`parte ${nombre}`)
    await new Promise((r) => setTimeout(r, 15))
    orden.push(`termina ${nombre}`)
    enCurso--
    return nombre
  }
  const a = crearCacheVivo({ nombre: 'prueba-a', frescoMs: 1e6, calcular: lento('a') })
  const b = crearCacheVivo({ nombre: 'prueba-b', frescoMs: 1e6, calcular: lento('b') })
  await a.leer(); await b.leer()
  orden.length = 0; maximo = 0

  const rearmado = envejecerCachesVivos()
  const mientras = await a.leer()
  assert.deepEqual([mientras.valor, mientras.refrescando], ['a', true], 'lo guardado se sigue sirviendo')
  await rearmado
  const propios = orden.filter((x) => /[ab]$/.test(x))
  assert.deepEqual(propios, ['parte a', 'termina a', 'parte b', 'termina b'])
  assert.equal(maximo, 1, 'nunca dos a la vez')
  assert.equal((await a.leer()).refrescando, false)
})

test('cache vivo: si llegan datos nuevos mientras se calcula, lo que llega se guarda ya viejo y se rearma otra vez', async () => {
  let t = 0
  const c = calculo()
  const cache = crearCacheVivo({ calcular: c.calcular, ahora: () => t, frescoMs: 100 })
  const p = cache.leer(); await tic(); c.terminar(); await p
  cache.envejecer()
  await cache.leer() // parte el cálculo 2 detrás
  await tic()
  cache.envejecer() // termina otra medición mientras el 2 viene en camino
  c.terminar(); await tic()
  const x = await cache.leer()
  assert.deepEqual([x.valor, x.refrescando, c.veces()], ['calculo-2', true, 3])
  await tic(); c.terminar(); await tic()
  const y = await cache.leer()
  assert.deepEqual([y.valor, y.refrescando], ['calculo-3', false])
})
