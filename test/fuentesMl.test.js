import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { frescuraFuente, masReciente, saludFuentesMl } from '../src/services/ml/fuentes.js'
import { SerieNichoMl } from '../src/models/SerieNichoMl.js'
import { CurvaEstacional } from '../src/models/CurvaEstacional.js'

test('la frescura depende de datos persistidos y distingue ausencia, atraso y fecha futura', () => {
  const opciones = { ahora: new Date('2025-02-20T12:00:00Z'), maxDias: 7 }
  assert.equal(frescuraFuente('2025-02-19T12:00:00Z', opciones).estado, 'al-dia')
  assert.equal(frescuraFuente('2025-02-01T12:00:00Z', opciones).estado, 'atrasada')
  assert.equal(frescuraFuente('2025-02-01T12:00:00Z', opciones).diasSinDatos, 19)
  for (const fecha of [null, 'inválida', '2025-02-21']) assert.equal(frescuraFuente(fecha, opciones).estado, 'sin-datos')
})

test('masReciente: la fecha más nueva entre las que sirven', () => {
  assert.deepEqual(masReciente('2025-02-01T00:00:00Z', null, new Date('2025-02-03T00:00:00Z'), 'inválida'), new Date('2025-02-03T00:00:00Z'))
  assert.equal(masReciente(null, undefined), null)
})

test('la fuente de búsquedas avisa cuando lleva dos días sin entregar: es de pago y se corta sin decirlo', async () => {
  const mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  try {
    const ahora = new Date('2025-02-20T12:00:00Z')
    const busquedas = async () => (await saludFuentesMl({ ahora })).find((f) => f.id === 'busquedas')
    assert.equal((await busquedas()).estado, 'sin-datos')

    // el último dato es la curva de hace tres días: la serie más vieja no la salva
    await SerieNichoMl.create({ huella: 'a', keyword: 'una', pais: 2152, idioma: 'es', capturadoEl: new Date('2025-02-10T12:00:00Z') })
    await CurvaEstacional.create({ keyword: 'una', curva: Array(12).fill(50), medidoEl: new Date('2025-02-17T11:00:00Z') })
    const cortada = await busquedas()
    assert.deepEqual([cortada.estado, cortada.diasSinDatos], ['atrasada', 3])
    assert.match(cortada.uso, /saldo/)

    // volvió a entrar una serie ayer: al día
    await SerieNichoMl.create({ huella: 'b', keyword: 'otra', pais: 2152, idioma: 'es', capturadoEl: new Date('2025-02-19T14:00:00Z') })
    assert.equal((await busquedas()).estado, 'al-dia')
  } finally {
    await mongoose.disconnect()
    await mongod.stop()
  }
})

