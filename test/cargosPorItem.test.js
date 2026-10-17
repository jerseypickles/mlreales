import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { CargoMl } from '../src/models/CargoMl.js'
import { cargosPorItem } from '../src/services/cargosMl.js'

let mongod
before(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})
after(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

// Caso del 17-oct-2026: las ventas de 30 días ya salían sin los días de evento,
// la comisión no. Dividir la de 30 días enteros por las ventas de días normales
// daba 24,4% al Set 8 y a la pistola; la facturada en días normales era 15,7% y 16,7%.
test('cargos por item: los días excluidos salen de la comisión igual que de las ventas', async () => {
  const hace = (dias, hora = 15) => new Date(Date.now() - dias * 86400e3 + (hora - 12) * 3600e3)
  const dia = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
  const normal = hace(10), evento = hace(5)
  await CargoMl.insertMany([
    { detalleId: '1', fecha: normal, tipo: 'CV', montoClp: 700, itemId: 'MLC1' },
    { detalleId: '2', fecha: evento, tipo: 'CV', montoClp: 700, itemId: 'MLC1' },
    { detalleId: '3', fecha: evento, tipo: 'CV', montoClp: 700, itemId: 'MLC1' },
  ])
  assert.equal((await cargosPorItem({ dias: 30 })).get('MLC1').comisionClp, 2100)
  assert.equal((await cargosPorItem({ dias: 30, excluirDias: [dia(evento)] })).get('MLC1').comisionClp, 700)
  assert.equal((await cargosPorItem({ dias: 30, excluirDias: [] })).get('MLC1').comisionClp, 2100, 'sin días que excluir, todo')
})
