import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { Snapshot } from '../src/models/Snapshot.js'
import { scanDeReferencia } from '../src/services/metricas.js'
import { scoring } from '../src/config/scoring.js'

// CONTRA QUÉ SCAN SE COMPARA UNO NUEVO (20-nov-2026).
// La venta de un nicho es lo que subieron las reseñas de las mismas publicaciones entre dos scans. Un scan que no
// leyó reseñas (el proveedor entregó las fichas sin que el sistema las reconociera) no sirve de punto de comparación:
// el siguiente quedaba sin venta medida aunque hubiera leído todo bien. La referencia tiene que haber leído reseñas.

const DIA = 86_400_000
const HOY = new Date('2026-11-27T12:00:00Z')
const hace = (dias) => new Date(HOY.getTime() - dias * DIA)
const MINIMO = scoring.umbrales.minItemsDemanda

// un scan: `publicaciones` snapshots con la misma fecha, de los cuales `conResenas` traen el conteo
async function scan(keyword, fecha, { publicaciones = 12, conResenas = publicaciones } = {}) {
  await Snapshot.insertMany(
    Array.from({ length: publicaciones }, (_, i) => ({
      sku: `MLC${i + 1}`, keyword, fecha, posicion: i + 1, precio: 9990,
      ...(i < conResenas ? { numReviews: 40 + i } : {}),
    })),
  )
}

let mongod
before(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})
beforeEach(async () => {
  await Snapshot.deleteMany({})
})
after(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

test('scanDeReferencia: lo normal es el scan más reciente con la distancia mínima', async () => {
  await scan('lampara solar', hace(14))
  await scan('lampara solar', hace(7))
  await scan('lampara solar', hace(1))
  await scan('lampara solar', HOY)
  const r = await scanDeReferencia('lampara solar', HOY)
  assert.equal(+r.fecha, +hace(7), 'el de ayer queda muy cerca: no resuelve una tasa por día')
})

test('scanDeReferencia: un scan que no leyó reseñas no sirve de referencia: se va al anterior que sí', async () => {
  await scan('lampara solar', hace(20))
  await scan('lampara solar', hace(8), { conResenas: 0 })
  await scan('lampara solar', HOY)
  const r = await scanDeReferencia('lampara solar', HOY)
  assert.equal(+r.fecha, +hace(20))
})

test('scanDeReferencia: tampoco sirve el que leyó menos de lo que un scan necesita para puntuar', async () => {
  await scan('lampara solar', hace(20))
  await scan('lampara solar', hace(8), { conResenas: MINIMO - 1 })
  await scan('lampara solar', HOY)
  assert.equal(+(await scanDeReferencia('lampara solar', HOY)).fecha, +hace(20))

  await Snapshot.deleteMany({})
  await scan('lampara solar', hace(20))
  await scan('lampara solar', hace(8), { conResenas: MINIMO })
  await scan('lampara solar', HOY)
  assert.equal(+(await scanDeReferencia('lampara solar', HOY)).fecha, +hace(8), 'con el mínimo justo, vale')
})

test('scanDeReferencia: si ninguno leyó reseñas vale la regla de antes (el más reciente con la distancia mínima)', async () => {
  await scan('lampara solar', hace(20), { conResenas: 0 })
  await scan('lampara solar', hace(8), { conResenas: 0 })
  await scan('lampara solar', HOY)
  assert.equal(+(await scanDeReferencia('lampara solar', HOY)).fecha, +hace(8))
})

test('scanDeReferencia: en una serie nueva cae al scan inmediatamente anterior, y sin scans previos no hay referencia', async () => {
  await scan('lampara solar', hace(1))
  await scan('lampara solar', HOY)
  assert.equal(+(await scanDeReferencia('lampara solar', HOY)).fecha, +hace(1))

  await Snapshot.deleteMany({})
  await scan('lampara solar', HOY)
  assert.equal(await scanDeReferencia('lampara solar', HOY), null)
})

test('scanDeReferencia: los scans de otra búsqueda no cuentan', async () => {
  await scan('pinceles acuarela', hace(8))
  await scan('lampara solar', hace(20))
  await scan('lampara solar', hace(8), { conResenas: 0 })
  await scan('lampara solar', HOY)
  assert.equal(+(await scanDeReferencia('lampara solar', HOY)).fecha, +hace(20))
})
