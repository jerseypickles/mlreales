import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { SeguimientoStock, LecturaStock } from '../src/models/SeguimientoStock.js'
import { leerPendientes } from '../src/services/seguimientoStock.js'

// LA LECTURA DE STOCK CONTRA MONGO: a quién se le anota un fallo (20-nov-2026).
// Tres fallos seguidos dan de baja una publicación. El 18-nov el proveedor empezó a entregar las fichas con su
// indicador de confianza en cero y el lector las botó todas: cada pasada le anotaba un fallo a cada publicación y en
// dos días decenas quedaron a un fallo de la baja. La regla: si de varias fichas que llegaron no se leyó ninguna, el
// fallo es del lector; una publicación solo acumula fallos en una pasada donde otra sí se leyó.

let mongod
before(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})
beforeEach(async () => {
  await Promise.all([SeguimientoStock.deleteMany({}), LecturaStock.deleteMany({})])
})
after(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

const AHORA = new Date('2026-11-20T15:00:00Z')
const HORA = 3600e3
const NO_ES_FICHA = 'la extraccion no reconocio una ficha de producto'
const url = (n) => `https://articulo.mercadolibre.cl/MLC-10000000${n}-lampara-de-prueba-_JM`
const sku = (n) => `MLC10000000${n}`
const seguida = (n, extra = {}) => ({ sku: sku(n), url: url(n), keyword: 'lámpara', titulo: `Lámpara ${n}`, vendedor: `vendedor ${n}`,
  agregadoEl: new Date(+AHORA - 10 * 24 * HORA), proximaLecturaEl: new Date(+AHORA - HORA), ...extra })
const ficha = (n, stock = 7) => ({ sku: sku(n), url: url(n), stockQuantity: stock, stockTopado: false, price: 9990, sellerId: `v${n}`, sellerName: `vendedor ${n}` })
// el lector de prueba: devuelve las fichas que se le indiquen y marca el resto como no reconocidas o caídas
const lector = ({ buenas = [], caidas = [] } = {}) => async (urls) => ({
  items: buenas.map((n) => ficha(n)),
  costoUsd: urls.length * 0.006,
  fallidos: urls.filter((u) => !buenas.some((n) => url(n) === u)).map((u) => ({ url: u, motivo: caidas.some((n) => url(n) === u) ? 'Zyte HTTP 520: Website Ban' : NO_ES_FICHA })),
})

test('si de varias fichas no se leyó ninguna, el fallo es del lector: nadie acumula fallos ni se da de baja', async () => {
  await SeguimientoStock.create([seguida(1, { fallosSeguidos: 2 }), seguida(2, { fallosSeguidos: 2 }), seguida(3)])
  const r = await leerPendientes({ ahora: AHORA, leer: lector() })
  assert.equal(r.leidas, 0)
  assert.equal(r.bajas, 0)
  assert.equal(r.sinReconocer, 3)
  const docs = await SeguimientoStock.find({}).sort({ sku: 1 }).lean()
  assert.deepEqual(docs.map((d) => d.activo), [true, true, true], 'ninguna se da de baja')
  assert.deepEqual(docs.map((d) => d.fallosSeguidos), [2, 2, 0], 'los fallos quedan como estaban')
  // se vuelven a leer mañana, no cada dos horas: cada intento se paga
  for (const d of docs) assert.equal(+d.proximaLecturaEl, +AHORA + 24 * HORA)
  // la lectura fallida queda anotada igual, con su costo y su motivo
  const lecturas = await LecturaStock.find({}).lean()
  assert.equal(lecturas.length, 3)
  assert.ok(lecturas.every((l) => l.ok === false && l.motivoFallo === 'el proveedor no devolvió fichas'))
})

test('cuando otra ficha sí se leyó, el fallo es de la publicación: acumula y a la tercera se da de baja', async () => {
  await SeguimientoStock.create([seguida(1, { fallosSeguidos: 2 }), seguida(2, { fallosSeguidos: 0 }), seguida(3)])
  const r = await leerPendientes({ ahora: AHORA, leer: lector({ buenas: [3] }) })
  assert.equal(r.leidas, 1)
  assert.equal(r.bajas, 1)
  assert.equal(r.sinReconocer, undefined)
  const docs = await SeguimientoStock.find({}).sort({ sku: 1 }).lean()
  assert.equal(docs[0].activo, false)
  assert.equal(docs[0].motivoBaja, 'la ficha dejó de responder')
  assert.equal(docs[1].activo, true)
  assert.equal(docs[1].fallosSeguidos, 1)
  assert.equal(docs[2].fallosSeguidos, 0)
  assert.equal(docs[2].ultima.stock, 7)
})

test('una sola ficha en la pasada que no se lee cuenta como fallo suyo: no hay con qué comparar', async () => {
  await SeguimientoStock.create([seguida(1, { fallosSeguidos: 2 })])
  const r = await leerPendientes({ ahora: AHORA, leer: lector() })
  assert.equal(r.bajas, 1)
  const [d] = await SeguimientoStock.find({}).lean()
  assert.equal(d.activo, false)
})

test('las que el proveedor no sirvió no cuentan ni para un lado ni para el otro', async () => {
  // dos caídas (no se cobran) y una que llegó sin reconocerse: llegó una sola, así que su fallo sí se anota
  await SeguimientoStock.create([seguida(1), seguida(2), seguida(3, { fallosSeguidos: 1 })])
  const r = await leerPendientes({ ahora: AHORA, leer: lector({ caidas: [1, 2] }) })
  assert.equal(r.leidas, 0)
  const docs = await SeguimientoStock.find({}).sort({ sku: 1 }).lean()
  assert.deepEqual(docs.map((d) => d.fallosSeguidos), [0, 0, 2])
  assert.equal(+docs[0].proximaLecturaEl, +AHORA + 2 * HORA, 'la caída se reintenta pronto')
})
