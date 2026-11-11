import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { saltos, efectoDe, rangoDias, esNivelNuevo, revisarEventos, diasDeEvento } from '../src/services/eventosComerciales.js'
import { EventoComercial } from '../src/models/EventoComercial.js'
import { DiaProductoMl } from '../src/models/DiaProductoMl.js'

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

test('eventos: saltar casi toda la semana es un nivel nuevo; un par de días, no', () => {
  const dias = (...ds) => new Set(ds.map((d) => `2026-11-${String(d).padStart(2, '0')}`))
  // el lanzamiento real: cinco de siete días marcados, con dos días "normales" entre medio
  assert.equal(esNivelNuevo(dias(4, 5, 6, 8, 9), '2026-11-10'), true)
  assert.equal(esNivelNuevo(dias(4, 5, 6, 8, 9), '2026-11-09'), true)
  // un CyberDay de tres días, o cuatro de siete, sigue siendo un evento
  assert.equal(esNivelNuevo(dias(5, 6, 7), '2026-11-09'), false)
  assert.equal(esNivelNuevo(dias(4, 5, 8, 9), '2026-11-10'), false)
  // los días viejos no cuentan: la racha se mira en la última semana
  assert.equal(esNivelNuevo(dias(1, 2, 3, 4, 5), '2026-11-10'), false)
  assert.equal(esNivelNuevo(new Set(), 'sin fecha'), false)
})

test('eventos: cuando la cuenta cambia de nivel, sus días dejan de tratarse como evento y el nivel siguiente ya no se marca', async () => {
  const mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  try {
    const dia = (i) => new Date(Date.UTC(2026, 2, 1) + i * 86400e3).toISOString().slice(0, 10)
    const fila = (i, visitas, unidades) => ({ itemId: 'A', dia: dia(i), visitas, unidades, ordenes: unidades, actualizadoEl: new Date() })
    // 30 días normales y, desde el día 30, el triple de visitas para quedarse (entraron productos nuevos)
    await DiaProductoMl.insertMany(Array.from({ length: 40 }, (_, i) => (i < 30 ? fila(i, 50, 2) : fila(i, 150, 6))))
    const correr = (i) => revisarEventos({ ahora: new Date(`${dia(i)}T15:00:00Z`) })

    // los primeros cuatro días del nivel nuevo quedan como saltos por revisar: no son días normales
    for (const i of [31, 32, 33, 34]) await correr(i)
    assert.equal(await EventoComercial.countDocuments({ estado: 'por-revisar', origen: 'detectado' }), 4)
    assert.equal((await diasDeEvento()).has(dia(33)), true)

    // al quinto día de la semana ya no es un evento: se descartan solos y vuelven a contar
    const r = await correr(35)
    assert.equal(r.nivelNuevo, 5)
    assert.equal(await EventoComercial.countDocuments({ estado: 'por-revisar', origen: 'detectado' }), 0)
    assert.equal(await EventoComercial.countDocuments({ estado: 'descartado', nivelNuevo: true }), 5)
    for (const i of [30, 31, 32, 33, 34]) assert.equal((await diasDeEvento()).has(dia(i)), false)

    // y los días siguientes del mismo nivel no vuelven a quedar fuera
    for (const i of [36, 37, 38, 39]) await correr(i)
    assert.equal(await EventoComercial.countDocuments({ estado: 'por-revisar', origen: 'detectado' }), 0)
    for (const i of [35, 36, 37, 38]) assert.equal((await diasDeEvento()).has(dia(i)), false)
  } finally {
    await mongoose.disconnect()
    await mongod.stop()
  }
})

test('eventos: un salto de dos días sigue esperando que el dueño diga qué fue', async () => {
  const mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  try {
    const dia = (i) => new Date(Date.UTC(2026, 2, 1) + i * 86400e3).toISOString().slice(0, 10)
    await DiaProductoMl.insertMany(Array.from({ length: 40 }, (_, i) => ({ itemId: 'A', dia: dia(i), visitas: i === 30 || i === 31 ? 150 : 50, unidades: i === 30 || i === 31 ? 9 : 2, ordenes: 2, actualizadoEl: new Date() })))
    for (const i of [31, 32, 33, 34, 35, 36, 37, 38]) await revisarEventos({ ahora: new Date(`${dia(i)}T15:00:00Z`) })
    const saltosGuardados = await EventoComercial.find({ origen: 'detectado' }).lean()
    assert.equal(saltosGuardados.every((e) => e.estado === 'por-revisar' && !e.nivelNuevo), true)
    // (el calendario trae además su semilla de octubre: se mira solo el tramo de la prueba)
    assert.deepEqual([...(await diasDeEvento())].filter((d) => d >= dia(0) && d <= dia(39)).sort(), [dia(30), dia(31)])
  } finally {
    await mongoose.disconnect()
    await mongod.stop()
  }
})

