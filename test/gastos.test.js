import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registrarGasto, gastoDelMes, mesActual } from '../src/services/gastos.js'
import { Nicho } from '../src/models/Nicho.js'

let mongod

before(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})

after(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

test('registrarGasto acumula en el nicho y en el mes; gastoDelMes lo refleja', async () => {
  const nicho = await Nicho.create({ keyword: 'freidora de aire' })

  assert.equal(await gastoDelMes(), 0)

  await registrarGasto(nicho._id, 0.35)
  await registrarGasto(nicho._id, 0.4)
  await registrarGasto(nicho._id, null) // sin costo: no hace nada
  await registrarGasto(nicho._id, NaN)

  const actualizado = await Nicho.findById(nicho._id).lean()
  assert.equal(Math.round(actualizado.costoUsd * 100), 75)
  assert.equal(Math.round((await gastoDelMes()) * 100), 75)
})

test('mesActual devuelve el mes calendario de Chile en formato YYYY-MM', () => {
  assert.match(mesActual(), /^\d{4}-\d{2}$/)
  assert.equal(mesActual(new Date('2026-07-16T12:00:00Z')), '2026-07')
})
