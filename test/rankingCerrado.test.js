import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { CategoriaMl, PasadaPanorama } from '../src/models/CategoriaMl.js'
import { pasadaPanorama, rankingCerrado, MUESTRA_CIERRE } from '../src/services/panoramaMl.js'

// El 14-oct-2026 ML cerró `/highlights` a la app: 403 "At least one policy
// returned UNAUTHORIZED" en toda categoría. La pasada seguía pidiendo ~220 por
// hora, capturaba 0 y no lo decía en ninguna parte.
const DENEGADO = (ruta) => new Error(`${ruta} → 403: At least one policy returned UNAUTHORIZED.`)

let mongod
before(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})
after(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

test('panorama: 8 de 8 con 403 es el ranking cerrado; una muestra corta, mezclada o con 404 no', () => {
  const no = { denegado: true, error: '403: At least one policy returned UNAUTHORIZED.' }
  assert.equal(rankingCerrado(Array(MUESTRA_CIERRE).fill(no)), true)
  assert.equal(rankingCerrado(Array(MUESTRA_CIERRE - 1).fill(no)), false, 'muestra corta')
  assert.equal(rankingCerrado([...Array(MUESTRA_CIERRE - 1).fill(no), { datos: { content: [] } }]), false, 'una respondió')
  assert.equal(rankingCerrado(Array(MUESTRA_CIERRE).fill({ error: '404: Not found' })), false, '404 es "no publica", no cierre')
})

test('panorama: con el ranking cerrado la pasada para a las 8, lo anota y no vuelve a pedirlo hasta reprobar a las 24 h', async () => {
  const ahora = new Date('2026-10-17T12:00:00Z')
  // sin árbol por leer ni tendencias pendientes: la pasada va directo al ranking
  await CategoriaMl.insertMany(Array.from({ length: 30 }, (_, i) => ({ id: `MLC${i}`, hoja: true, totalItems: 10_000 - i, actualizadoEl: ahora, sinTendenciasHasta: new Date('2026-12-01') })))
  const pedidos = []
  const obtener = async (ruta) => {
    pedidos.push(ruta)
    if (ruta.startsWith('/highlights')) throw DENEGADO(ruta)
    return []
  }
  const ranking = () => pedidos.filter((p) => p.startsWith('/highlights')).length

  const r = await pasadaPanorama({ ahora, obtener })
  assert.equal(ranking(), MUESTRA_CIERRE, 'para apenas confirma el cierre')
  assert.equal(r.denegadas, MUESTRA_CIERRE)
  assert.equal(r.capturadas, 0)
  assert.equal(r.sinRanking, 0, 'un 403 no es "no publica": la categoría no se marca por 14 días')
  assert.ok(r.rankingCerrado && +r.rankingCerrado.hasta > +ahora)
  const guardada = await PasadaPanorama.findOne().sort({ en: -1 }).lean()
  assert.ok(guardada.resultado.rankingCerrado, 'la API (otro proceso) lo ve en la pasada guardada')

  pedidos.length = 0
  const r2 = await pasadaPanorama({ ahora: new Date(+ahora + 3600e3), obtener })
  assert.equal(ranking(), 0, 'en pausa ni se pide')
  assert.ok(r2.rankingCerrado)

  pedidos.length = 0
  const r3 = await pasadaPanorama({ ahora: new Date(+ahora + 25 * 3600e3), obtener })
  assert.equal(ranking(), MUESTRA_CIERRE, 'vencida la pausa, se reprueba con la muestra')
  assert.equal(+r3.rankingCerrado.desde, +r.rankingCerrado.desde, 'el cierre conserva desde cuándo')
})
