import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { normalizarScan } from '../src/services/normalizador.js'
import { guardarScan, aplicarDetalleScan } from '../src/services/persistencia.js'
import { Producto } from '../src/models/Producto.js'
import { Snapshot } from '../src/models/Snapshot.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/nivel1.json', import.meta.url), 'utf8'))

let mongod

before(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})

after(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

test('re-ejecutar el scan no duplica productos y sí agrega snapshots', async () => {
  const fecha1 = new Date('2026-07-15T12:00:00Z')
  const fecha2 = new Date('2026-07-16T12:00:00Z')

  const scan1 = normalizarScan(fixture, { fecha: fecha1, keyword: 'foco solares' })
  const resultado1 = await guardarScan({ items: scan1.items, fecha: fecha1 })
  assert.equal(resultado1.productosNuevos, 3)
  assert.equal(resultado1.snapshotsInsertados, 3)
  assert.equal(await Producto.countDocuments(), 3)
  assert.equal(await Snapshot.countDocuments(), 3)

  const scan2 = normalizarScan(fixture, { fecha: fecha2, keyword: 'foco solares' })
  const resultado2 = await guardarScan({ items: scan2.items, fecha: fecha2 })
  assert.equal(resultado2.productosNuevos, 0)
  assert.equal(resultado2.snapshotsInsertados, 3)

  // productos no duplicados, snapshots acumulados
  assert.equal(await Producto.countDocuments(), 3)
  assert.equal(await Snapshot.countDocuments(), 6)

  const producto = await Producto.findOne({ sku: 'MLC45499727' }).lean()
  assert.equal(producto.primeraVezVisto.toISOString(), fecha1.toISOString())
  assert.equal(producto.ultimaVezVisto.toISOString(), fecha2.toISOString())
  assert.equal(producto.esFull, true)
  assert.equal(producto.tipoListing, 'catalogo')
  assert.equal(producto.keywordOrigen, 'foco solares')

  const historia = await Snapshot.find({ sku: 'MLC45499727' }).sort({ fecha: 1 }).lean()
  assert.equal(historia.length, 2)
  assert.equal(historia[0].precio, 15990)
  assert.equal(historia[1].precio, 15990)
})

test('guardarScan con lista vacía no toca la base', async () => {
  const antes = await Producto.countDocuments()
  const resultado = await guardarScan({ items: [], fecha: new Date() })
  assert.equal(resultado.productosNuevos, 0)
  assert.equal(resultado.snapshotsInsertados, 0)
  assert.equal(await Producto.countDocuments(), antes)
})

test('aplicarDetalleScan: medido = con conteo de reseñas, no con match de SKU', async () => {
  const fecha = new Date('2026-07-20T12:00:00Z')
  await Snapshot.insertMany([
    { sku: 'MLC111', fecha, keyword: 'gua sha', posicion: 1 },
    { sku: 'MLC222', fecha, keyword: 'gua sha', posicion: 2 },
    { sku: 'MLC333', fecha, keyword: 'gua sha', posicion: 3 },
  ])

  const det = (extra) => ({
    numReviews: null, rating: null, precio: null, esFull: null, origenCrossBorder: null,
    categoriaML: null, categoriaRuta: null, preguntas: null, imagen: 'https://http2.mlstatic.com/x.jpg',
    seller: null,
    ...extra,
  })
  const porSku = new Map([
    ['MLC111', det({ numReviews: 120, rating: 4.7, precio: 5990 })],
    // página de catálogo que matcheó pero vino sin ratingCount: aporta precio,
    // NO cuenta como medición (caso rodillo facial 2026-07-20)
    ['MLC222', det({ precio: 7990 })],
    ['MLC333', det({ numReviews: 0 })], // 0 reseñas también es dato medido
  ])

  const res = await aplicarDetalleScan({ porSku, fecha })
  assert.equal(res.reviewsAplicadas, 2)

  const snaps = await Snapshot.find({ fecha }).sort({ sku: 1 }).lean()
  assert.equal(snaps[0].numReviews, 120)
  assert.equal(snaps[1].numReviews, undefined) // queda pendiente: el reintento pide solo esta URL
  assert.equal(snaps[1].precio, 7990) // pero el precio sí se aprovecha
  assert.equal(snaps[2].numReviews, 0)
})
