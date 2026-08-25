import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MongoMemoryServer } from 'mongodb-memory-server'

// LA POSICIÓN COMPLETA, NO SOLO LA FUNCIÓN PURA.
//
// codigosF29 se prueba aparte en contabilidad.test.js. Acá se verifica el
// CABLEADO, que es donde estaba el error: la cantidad de documentos sale de
// contar document_id distintos entre las líneas de cargo, y el [520] de la
// familia comisión — dos campos que existían en la base y que no leía nadie.

let mongod
let mongoose
let posicionIva
let VentaMl
let CargoMl

before(async () => {
  mongod = await MongoMemoryServer.create()
  process.env.MONGO_URI = mongod.getUri()
  mongoose = (await import('mongoose')).default
  await mongoose.connect(process.env.MONGO_URI)
  ;({ posicionIva } = await import('../src/services/contabilidad.js'))
  ;({ VentaMl } = await import('../src/models/VentaMl.js'))
  ;({ CargoMl } = await import('../src/models/CargoMl.js'))
})

after(async () => {
  await mongoose?.disconnect()
  await mongod?.stop()
})

// Un mes con: 3 órdenes cubiertas por 2 boletas, y cargos de ML repartidos en
// UN solo documento de facturación (que es como llega en la cuenta real).
async function sembrar() {
  await VentaMl.deleteMany({})
  await CargoMl.deleteMany({})
  const emitidaEl = new Date('2026-08-10T14:00:00Z')
  await VentaMl.create([
    { orderId: 'O1', fecha: emitidaEl, totalClp: 3685, items: [{ cantidad: 1 }], boleta: { invoiceId: 'A', ivaClp: 589, brutoClp: 3685, emitidaEl } },
    { orderId: 'O2', fecha: emitidaEl, totalClp: 3685, items: [{ cantidad: 1 }], boleta: { invoiceId: 'A', ivaClp: 589, brutoClp: 3685, emitidaEl } },
    { orderId: 'O3', fecha: emitidaEl, totalClp: 10922, items: [{ cantidad: 2 }], boleta: { invoiceId: 'B', ivaClp: 1743, brutoClp: 10922, emitidaEl } },
  ])
  const fecha = new Date('2026-08-10T14:00:00Z')
  await CargoMl.create([
    { detalleId: 'c1', documentoId: 'DOC-1', fecha, tipo: 'CV', montoClp: 40_000 }, // comisión
    { detalleId: 'c2', documentoId: 'DOC-1', fecha, tipo: 'CV', montoClp: 20_000 }, // comisión
    { detalleId: 'c3', documentoId: 'DOC-1', fecha, tipo: 'CXD', montoClp: 90_000 }, // envíos
    { detalleId: 'c4', documentoId: 'DOC-1', fecha, tipo: 'PADS', montoClp: 30_000 }, // publicidad
  ])
}

test('el F29 sale cableado a la base, con los cuatro casilleros', async () => {
  await sembrar()
  const r = await posicionIva({ periodo: '2026-08' })
  assert.ok(r.f29, 'la posición tiene que traer el bloque del F29')
  assert.deepEqual(r.f29.codigos.map((c) => c.codigo), [500, 501, 519, 520])
})

test('[500] cuenta UN documento de ML aunque haya 4 líneas de cargo y 2 boletas', async () => {
  await sembrar()
  const r = await posicionIva({ periodo: '2026-08' })
  assert.equal(r.f29.documentos, 1, 'los 4 cargos vienen del mismo document_id')
  assert.equal(r.f29.codigos.find((c) => c.codigo === 500).valor, 1)
  assert.equal(r.debito.documentos, 2, 'las boletas a compradores son 2: otra cosa, otro casillero')
})

test('[501] es el IVA de las boletas del mes, sin duplicar la que cubre dos órdenes', async () => {
  await sembrar()
  const r = await posicionIva({ periodo: '2026-08' })
  assert.equal(r.f29.codigos.find((c) => c.codigo === 501).valor, 589 + 1743)
})

test('[520] toma la comisión y deja fuera envíos y publicidad', async () => {
  await sembrar()
  const r = await posicionIva({ periodo: '2026-08' })
  assert.equal(r.f29.comisionClp, 60_000, 'CV: 40.000 + 20.000')
  assert.equal(r.f29.fueraDeLaComisionClp, 120_000, 'CXD 90.000 + PADS 30.000, que van por otra línea')
  const c520 = r.f29.codigos.find((c) => c.codigo === 520)
  assert.equal(c520.valor, 9580, 'IVA de 60.000 con impuesto incluido')
  assert.notEqual(c520.valor, 28_739, 'el IVA de los 180.000 completos sería otra cosa')
})

test('una anulación de comisión BAJA el crédito del [520]', async () => {
  // BV anula CV y llega con monto POSITIVO: sumarla inflaría el crédito
  await sembrar()
  await CargoMl.create({ detalleId: 'c5', documentoId: 'DOC-1', fecha: new Date('2026-08-11T14:00:00Z'), tipo: 'BV', montoClp: 10_000 })
  const r = await posicionIva({ periodo: '2026-08' })
  assert.equal(r.f29.comisionClp, 50_000, '60.000 menos la anulación de 10.000')
  assert.equal(r.f29.codigos.find((c) => c.codigo === 520).valor, 7983)
})

test('sin cargos sincronizados los casilleros de cantidad quedan vacíos', async () => {
  await VentaMl.deleteMany({})
  await CargoMl.deleteMany({})
  const r = await posicionIva({ periodo: '2026-08' })
  assert.equal(r.f29.documentos, 0)
  assert.equal(r.f29.codigos.find((c) => c.codigo === 500).valor, null)
  assert.ok(r.f29.codigos.find((c) => c.codigo === 500).falta)
})

test('la posición de agosto NO trae la DIN en juego, la de octubre sí', async () => {
  await sembrar()
  const agosto = await posicionIva({ periodo: '2026-08' })
  assert.equal(agosto.importaciones.enJuego, false, 'la primera carga llega en octubre')
  assert.equal(agosto.importaciones.desde, '2026-10', 'y la pantalla tiene que poder decir cuándo')

  const octubre = await posicionIva({ periodo: '2026-10' })
  assert.equal(octubre.importaciones.enJuego, true)
})
