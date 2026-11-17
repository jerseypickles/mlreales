import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { seVendeEn } from '../src/services/nichoPropio.js'
import { ProductoPropio } from '../src/models/ProductoPropio.js'

test('nicho propio: se vende en un nicho mientras haya una publicación propia vigente ahí', async () => {
  const mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  try {
    const [conVenta, cerrado, pausadoPorStock, ajeno] = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId())
    const propio = (sku, nichoId, extra = {}) => ({ sku, url: `https://x/${sku}`, titulo: sku, nichoId, estadoMl: 'active', ...extra })
    await ProductoPropio.insertMany([
      propio('a', conVenta),
      // una publicación cerrada en Mercado Libre ya no es venta; una pausada por falta de stock sí lo sigue siendo
      propio('b', cerrado, { estadoMl: 'closed' }),
      propio('c', pausadoPorStock, { estadoMl: 'paused' }),
      // y la que el dueño sacó de su lista tampoco cuenta
      propio('d', ajeno, { estado: 'pausado' }),
    ])
    assert.deepEqual(await Promise.all([conVenta, cerrado, pausadoPorStock, ajeno, new mongoose.Types.ObjectId(), null].map(seVendeEn)), [true, false, true, false, false, false])
  } finally {
    await mongoose.disconnect()
    await mongod.stop()
  }
})
