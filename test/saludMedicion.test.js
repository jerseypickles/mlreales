import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { Reporte } from '../src/models/Reporte.js'
import { LecturaStock } from '../src/models/SeguimientoStock.js'
import { rachaDeScans, rachaDeStock, saludMedicion, SCANS_SEGUIDOS, PASADAS_SEGUIDAS } from '../src/services/saludMedicion.js'

// ¿SE ESTÁ MIDIENDO? (20-nov-2026). Dos días sin reseñas pasaron sin que nada lo dijera: los scans terminaban, los
// reportes se guardaban sin puntaje y la mesa mostraba la venta de antes. Estas reglas son las que ahora lo avisan.

const AHORA = new Date('2026-11-20T12:00:00Z')
const hace = (horas) => new Date(+AHORA - horas * 3600e3)
const scan = (horas, conResenas) => ({ fecha: hace(horas), conResenas })

test('rachaDeScans: varios scans seguidos sin reseñas es un problema; uno suelto no', () => {
  const sano = rachaDeScans([scan(3, true), scan(5, false), scan(7, true)], { ahora: AHORA })
  assert.equal(sano.seguidos, 0)
  assert.equal(sano.problema, false)
  const unoSuelto = rachaDeScans([scan(3, false), scan(5, true), scan(7, true)], { ahora: AHORA })
  assert.equal(unoSuelto.seguidos, 1)
  assert.equal(unoSuelto.problema, false, 'un scan bloqueado es de todos los días')
  const caido = rachaDeScans([scan(3, false), scan(5, false), scan(7, false), scan(9, true), scan(11, false)], { ahora: AHORA })
  assert.equal(caido.seguidos, 3)
  assert.equal(caido.seguidos >= SCANS_SEGUIDOS, true)
  assert.equal(caido.problema, true)
  assert.equal(+caido.desde, +hace(7), 'la racha parte en el scan en blanco más viejo de los seguidos')
  assert.equal(+caido.ultimoBueno, +hace(9))
})

test('rachaDeScans: un scan recién hecho todavía está leyendo sus fichas y no cuenta', () => {
  // los tres más nuevos tienen menos de dos horas: no se sabe todavía; el resto midió bien
  const r = rachaDeScans([scan(0.2, false), scan(1, false), scan(1.9, false), scan(4, true)], { ahora: AHORA })
  assert.equal(r.seguidos, 0)
  assert.equal(r.problema, false)
  assert.equal(r.mirados, 1)
  // sin ningún scan que mirar no hay problema que afirmar
  assert.equal(rachaDeScans([], { ahora: AHORA }).problema, false)
  assert.equal(rachaDeScans(null, { ahora: AHORA }).ultimoBueno, null)
})

test('rachaDeScans: si nada midió en toda la ventana, no hay último bueno que nombrar', () => {
  const r = rachaDeScans([scan(3, false), scan(30, false), scan(60, false), scan(90, false)], { ahora: AHORA })
  assert.equal(r.problema, true)
  assert.equal(r.seguidos, 4)
  assert.equal(r.ultimoBueno, null)
})

const pasada = (horas, buenas, fallidas) => [
  ...Array.from({ length: buenas }, () => ({ fecha: hace(horas), ok: true })),
  ...Array.from({ length: fallidas }, () => ({ fecha: hace(horas), ok: false })),
]

test('rachaDeStock: dos pasadas seguidas sin leer ninguna publicación es un problema', () => {
  const sano = rachaDeStock([...pasada(2, 10, 3), ...pasada(4, 0, 12), ...pasada(6, 9, 1)])
  assert.equal(sano.seguidas, 0)
  assert.equal(sano.problema, false)
  const unaEnBlanco = rachaDeStock([...pasada(2, 0, 12), ...pasada(4, 8, 2)])
  assert.equal(unaEnBlanco.seguidas, 1)
  assert.equal(unaEnBlanco.problema, false)
  const caido = rachaDeStock([...pasada(2, 0, 12), ...pasada(4, 0, 9), ...pasada(6, 7, 2)])
  assert.equal(caido.seguidas, 2)
  assert.equal(caido.seguidas >= PASADAS_SEGUIDAS, true)
  assert.equal(caido.problema, true)
  assert.equal(caido.fallidas, 21)
  assert.equal(+caido.desde, +hace(4))
  assert.equal(+caido.ultimaBuena, +hace(6))
})

test('rachaDeStock: una pasada de una sola lectura no dice nada', () => {
  const r = rachaDeStock([...pasada(1, 0, 1), ...pasada(2, 0, 1), ...pasada(4, 5, 0)])
  assert.equal(r.seguidas, 0)
  assert.equal(r.miradas, 1)
  assert.equal(rachaDeStock([]).problema, false)
})

let mongod
before(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})
beforeEach(async () => { await Promise.all([Reporte.deleteMany({}), LecturaStock.deleteMany({})]) })
after(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

const nichoId = new mongoose.Types.ObjectId()
const reporte = (horas, itemsConDato) => ({ nichoId, keyword: 'lámpara', fecha: hace(horas),
  metricas: itemsConDato === null ? { demanda: null, sinScore: 'detalle bloqueado por ML: sin cobertura de reseñas' } : { demanda: { resenasNuevasPorDia: 3, coberturaReviews: { itemsConDato, itemsDelScan: 50 } } } })

test('saludMedicion contra Mongo: sin problemas cuando se mide; con los dos avisos cuando todo viene en blanco', async () => {
  await Reporte.create([reporte(3, 14), reporte(5, null), reporte(8, 12)])
  await LecturaStock.create([...pasada(2, 6, 2), ...pasada(4, 0, 5)].map((l, i) => ({ ...l, sku: `MLC${i}` })))
  const sano = await saludMedicion({ ahora: AHORA })
  assert.deepEqual(sano.problemas, [])

  await Promise.all([Reporte.deleteMany({}), LecturaStock.deleteMany({})])
  await Reporte.create([reporte(1, null), reporte(3, null), reporte(6, null), reporte(9, null), reporte(30, 15)])
  await LecturaStock.create([...pasada(2, 0, 8), ...pasada(4, 0, 7), ...pasada(30, 6, 1)].map((l, i) => ({ ...l, sku: `MLC${i}` })))
  const caido = await saludMedicion({ ahora: AHORA })
  assert.deepEqual(caido.problemas.map((p) => p.id), ['scans-sin-resenas', 'stock-sin-lecturas'])
  const [scans, stock] = caido.problemas
  assert.equal(scans.seguidos, 3, 'el scan de hace una hora todavía no cuenta')
  assert.equal(+scans.desde, +hace(9))
  assert.equal(+scans.ultimoBueno, +hace(30))
  assert.equal(stock.pasadas, 2)
  assert.equal(stock.lecturas, 15)
  assert.equal(+stock.ultimaBuena, +hace(30))
})
