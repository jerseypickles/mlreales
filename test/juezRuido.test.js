import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { Reporte } from '../src/models/Reporte.js'
import { CurvaEstacional } from '../src/models/CurvaEstacional.js'
import { juzgarRuidoDemanda } from '../src/services/metricas.js'

// El juez del ruido contra Mongo: qué ancla elige, quién puede confirmar un
// salto y qué le pasa al scan que lo confirma (2-nov-2026).

let mongod
before(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})
beforeEach(async () => {
  await Promise.all([Reporte.deleteMany({}), CurvaEstacional.deleteMany({})])
  await CurvaEstacional.create({ keyword: nicho.keyword, curva: Array(12).fill(50), medidoEl: new Date() }) // año plano
})
after(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

const nicho = { _id: new mongoose.Types.ObjectId(), keyword: 'nicho de prueba' }
const dia = (s) => new Date(`2026-${s}T12:00:00Z`)
const base = (fecha, demanda) => ({ nichoId: nicho._id, keyword: nicho.keyword, fecha: dia(fecha), metricas: { demanda: { fuenteResenas: 'ficha', ...demanda } } })
const aceptado = (fecha, tasa) => base(fecha, { resenasNuevasPorDia: tasa })
const anulado = (fecha, crudo, contra) => base(fecha, {
  resenasNuevasPorDia: null,
  saltoSospechoso: { valorCrudo: crudo, contra, salto: 10, motivo: 'la curva del año está plana en ese mes' },
})
const scan = (tasa) => ({ demanda: { resenasNuevasPorDia: tasa, fuenteResenas: 'ficha' } })
const tasaDel = async (fecha) => (await Reporte.findOne({ nichoId: nicho._id, fecha: dia(fecha) }).lean()).metricas.demanda

test('juez del ruido: un salto que otro scan confirma es el nivel nuevo, y ese scan vuelve a la serie', async () => {
  await Reporte.create([aceptado('09-09', 0.5), anulado('10-19', 7.6, 0.5), anulado('10-31', 6.7, 0.5)])
  const metricas = scan(8)
  const j = await juzgarRuidoDemanda({ nicho, metricas, fechaScan: dia('11-04'), fechaReferencia: dia('10-31') })

  assert.equal(j.reanclar, true)
  assert.equal(metricas.demanda.resenasNuevasPorDia, 8, 'el scan nuevo cuenta')
  assert.equal(metricas.demanda.saltoSospechoso, undefined)
  assert.equal(metricas.demanda.reanclado.contra, 0.5)
  assert.equal(metricas.demanda.reanclado.confirmadoCon, 6.7)

  const confirmador = await tasaDel('10-31')
  assert.equal(confirmador.resenasNuevasPorDia, 6.7, 'vuelve con su crudo')
  assert.equal(confirmador.saltoSospechoso, undefined)
  assert.equal(confirmador.saltoConfirmado.valorCrudo, 6.7, 'y queda el rastro de por qué')
  assert.deepEqual(confirmador.saltoConfirmado.confirmadoPor, dia('11-04'))
  assert.equal((await tasaDel('10-19')).resenasNuevasPorDia, null, 'la historia más vieja no se toca')
})

test('juez del ruido: un scan cuya ventana se cruza con la de este no lo confirma', async () => {
  // cadencia de maduración: el delta de este scan se midió desde el 10-31 y el
  // del 11-02 también cubre ese tramo; un mismo artefacto inflaría a los dos
  await Reporte.create([aceptado('09-09', 0.5), anulado('11-02', 7, 0.5)])
  const metricas = scan(8)
  const j = await juzgarRuidoDemanda({ nicho, metricas, fechaScan: dia('11-04'), fechaReferencia: dia('10-31') })

  assert.equal(j.anular, true)
  assert.equal(metricas.demanda.resenasNuevasPorDia, null)
  assert.equal(metricas.demanda.saltoSospechoso.valorCrudo, 8, 'el crudo no se pierde')
  assert.equal(metricas.demanda.saltoSospechoso.contra, 0.5)
  assert.equal((await tasaDel('11-02')).resenasNuevasPorDia, null)
})

test('juez del ruido: un pico aislado sigue anulado, vuelva o no el nivel', async () => {
  await Reporte.create([aceptado('10-01', 118), anulado('10-08', 35063, 118)])

  // otro salto que no coincide con el pico: se anula
  const otro = scan(1500)
  assert.equal((await juzgarRuidoDemanda({ nicho, metricas: otro, fechaScan: dia('10-15'), fechaReferencia: dia('10-08') })).anular, true)

  // el nivel de siempre: se acepta contra el ancla y el pico no se rescata
  const vuelve = scan(130)
  const j = await juzgarRuidoDemanda({ nicho, metricas: vuelve, fechaScan: dia('10-15'), fechaReferencia: dia('10-08') })
  assert.deepEqual([j.anular, j.reanclar], [false, false])
  assert.equal(vuelve.demanda.resenasNuevasPorDia, 130)
  assert.equal((await tasaDel('10-08')).resenasNuevasPorDia, null)
})

test('juez del ruido: el recálculo del mismo scan no se juzga contra sí mismo y da lo mismo', async () => {
  await Reporte.create([aceptado('09-09', 0.5), anulado('10-31', 6.7, 0.5)])
  const primera = scan(8)
  await juzgarRuidoDemanda({ nicho, metricas: primera, fechaScan: dia('11-04'), fechaReferencia: dia('10-31') })
  // el scan queda guardado y el recálculo post-nivel-2 lo vuelve a juzgar
  await Reporte.create({ nichoId: nicho._id, keyword: nicho.keyword, fecha: dia('11-04'), metricas: primera })
  const segunda = scan(8)
  const j = await juzgarRuidoDemanda({ nicho, metricas: segunda, fechaScan: dia('11-04'), fechaReferencia: dia('10-31') })

  assert.deepEqual([j.anular, j.reanclar], [false, false], 'ahora el ancla es el scan que se recuperó')
  assert.equal(segunda.demanda.resenasNuevasPorDia, 8)
  assert.equal(await Reporte.countDocuments({ nichoId: nicho._id, 'metricas.demanda.resenasNuevasPorDia': { $ne: null } }), 3)
})

test('juez del ruido: un salto que solo es más canasta no se anula; uno por publicación sí, y queda dicho cómo se midió', async () => {
  // el ancla se midió con 2 publicaciones comparables (llegaron pocas fichas)
  await Reporte.create(base('10-20', { resenasNuevasPorDia: 2, reviews: { itemsComparables: 2 } }))
  const conCanasta = (tasa, comparables) => ({ demanda: { resenasNuevasPorDia: tasa, fuenteResenas: 'ficha', reviews: { itemsComparables: comparables } } })

  // ahora llegan 12: la suma es 6 veces más, por publicación es lo mismo
  const masFichas = conCanasta(12, 12)
  const j1 = await juzgarRuidoDemanda({ nicho, metricas: masFichas, fechaScan: dia('10-27'), fechaReferencia: dia('10-20') })
  assert.deepEqual([j1.anular, j1.reanclar], [false, false])
  assert.equal(masFichas.demanda.resenasNuevasPorDia, 12, 'la lectura se queda')
  assert.equal(masFichas.demanda.saltoSospechoso, undefined)

  // la misma suma con las mismas 2 publicaciones: eso sí es un salto de 6 veces
  const mismoPar = conCanasta(12, 2)
  const j2 = await juzgarRuidoDemanda({ nicho, metricas: mismoPar, fechaScan: dia('10-27'), fechaReferencia: dia('10-20') })
  assert.equal(j2.anular, true)
  assert.equal(mismoPar.demanda.resenasNuevasPorDia, null)
  assert.equal(mismoPar.demanda.saltoSospechoso.valorCrudo, 12, 'se guardan las sumas…')
  assert.equal(mismoPar.demanda.saltoSospechoso.contra, 2)
  assert.deepEqual(mismoPar.demanda.saltoSospechoso.porComparable, { actual: 6, contra: 1, comparables: [2, 2] }, '…y con qué se midió el salto')
  assert.equal(mismoPar.demanda.saltoSospechoso.salto, 6)
})

test('juez del ruido: el scan que confirma un salto también se compara por publicación', async () => {
  // ancla con 2 comparables; después dos lecturas con 10 que coinciden entre sí por publicación (y son 8 veces el ancla)
  await Reporte.create([
    base('09-09', { resenasNuevasPorDia: 1, reviews: { itemsComparables: 2 } }),
    base('10-31', { resenasNuevasPorDia: null, reviews: { itemsComparables: 10 }, saltoSospechoso: { valorCrudo: 40, contra: 1, salto: 8, motivo: 'la curva del año está plana en ese mes' } }),
  ])
  const metricas = { demanda: { resenasNuevasPorDia: 88, fuenteResenas: 'ficha', reviews: { itemsComparables: 20 } } }
  const j = await juzgarRuidoDemanda({ nicho, metricas, fechaScan: dia('11-04'), fechaReferencia: dia('10-31') })

  assert.equal(j.reanclar, true, 'por publicación: 4,4 contra 4 del que confirma')
  assert.equal(metricas.demanda.resenasNuevasPorDia, 88)
  assert.equal(metricas.demanda.reanclado.contra, 1)
  assert.equal(metricas.demanda.reanclado.confirmadoCon, 40)
  assert.equal((await tasaDel('10-31')).resenasNuevasPorDia, 40, 'el que confirma vuelve con su suma')
})

test('juez del ruido: sin tasa o sin ancla no hace nada', async () => {
  assert.equal(await juzgarRuidoDemanda({ nicho, metricas: scan(null), fechaScan: dia('11-04') }), null)
  const primera = scan(40)
  assert.equal(await juzgarRuidoDemanda({ nicho, metricas: primera, fechaScan: dia('11-04') }), null)
  assert.equal(primera.demanda.resenasNuevasPorDia, 40)
})
