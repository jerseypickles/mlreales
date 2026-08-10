import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  registrarGasto,
  gastoDelMes,
  gastoPorDia,
  decidirPresupuesto,
  mesActual,
  diaActual,
} from '../src/services/gastos.js'
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

  await registrarGasto(nicho._id, 0.35, 'ia')
  await registrarGasto(nicho._id, 0.4, 'apify')
  await registrarGasto(nicho._id, null, 'ia') // sin costo: no hace nada
  await registrarGasto(nicho._id, NaN, 'ia')

  const actualizado = await Nicho.findById(nicho._id).lean()
  assert.equal(Math.round(actualizado.costoUsd * 100), 75)
  assert.equal(Math.round((await gastoDelMes()) * 100), 75)
})

test('el mismo gasto queda separado por fuente en la serie diaria', async () => {
  // la pregunta que el contador mensual no podía responder: de los US$0,75
  // del test anterior, ¿cuánto fue IA y cuánto scraping?
  const { totales, serie } = await gastoPorDia({ dias: 2 })
  assert.equal(Math.round(totales.ia * 100), 35)
  assert.equal(Math.round(totales.apify * 100), 40)
  assert.equal(totales.llamadasIa, 1, 'los gastos nulos no cuentan como llamada')
  assert.equal(serie[0].dia, diaActual())
})

test('el promedio diario de IA se calcula sobre los días CON gasto', async () => {
  // con 38 nichos en frecuencia semanal hay días sin análisis: dividir por 30
  // escondería lo que cuesta un día que sí corre
  const { totales } = await gastoPorDia({ dias: 30 })
  assert.equal(totales.diasConGasto, 1)
  assert.equal(Math.round(totales.promedioIaPorDiaActivo * 100), 35)
})

test('el freno de scraping se dispara con el saldo REAL de Apify, no solo el interno', () => {
  // el caso exacto que motivó el cambio: contador interno en US$40,51 de
  // US$150 (no frena nada) mientras Apify va al 86% de su tope real
  const real = decidirPresupuesto({
    gastadoUsd: 40.51,
    techoUsd: 150,
    apify: { topeUsd: 250, gastadoUsd: 213.85, cicloHasta: '2026-08-15T23:59:59.999Z' },
  })
  assert.equal(real.ia.agotado, false, 'el interno está lejos del techo')
  assert.equal(real.scraping.agotado, false, '86% todavía no llega al 90%')

  const alTope = decidirPresupuesto({
    gastadoUsd: 40.51,
    techoUsd: 150,
    apify: { topeUsd: 250, gastadoUsd: 240, cicloHasta: '2026-08-15T23:59:59.999Z' },
  })
  assert.equal(alTope.scraping.agotado, true, 'Apify al 96% corta el scraping')
  assert.match(alTope.scraping.motivo, /Apify al 96%/)
  assert.equal(alTope.ia.agotado, false, 'el tope de Apify NO frena la IA: no gasta actor')
})

test('el contador interno agotado frena las DOS cosas', () => {
  const p = decidirPresupuesto({ gastadoUsd: 150, techoUsd: 150, apify: { topeUsd: 250, gastadoUsd: 10 } })
  assert.equal(p.ia.agotado, true)
  assert.equal(p.scraping.agotado, true)
  assert.match(p.ia.motivo, /presupuesto mensual agotado/)
})

test('sin saldo de Apify se sigue midiendo con el contador interno', () => {
  // detener el tablero porque su API no respondió sería peor que el problema
  const p = decidirPresupuesto({ gastadoUsd: 40, techoUsd: 150, apify: null })
  assert.equal(p.apify, null)
  assert.equal(p.scraping.agotado, false)
  // un tope nulo tampoco puede leerse como "agotado"
  const sinTope = decidirPresupuesto({ gastadoUsd: 40, techoUsd: 150, apify: { topeUsd: null, gastadoUsd: 999 } })
  assert.equal(sinTope.scraping.agotado, false)
})

test('registrarGasto exige clasificar la fuente', async () => {
  // sin fuente obligatoria se vuelve a mezclar scraping con IA, que es
  // exactamente lo que este cambio vino a arreglar
  await assert.rejects(() => registrarGasto(null, 1.5), /fuente debe ser/)
  await assert.rejects(() => registrarGasto(null, 1.5, 'otra'), /fuente debe ser/)
})

test('mesActual devuelve el mes calendario de Chile en formato YYYY-MM', () => {
  assert.match(mesActual(), /^\d{4}-\d{2}$/)
  assert.equal(mesActual(new Date('2026-07-16T12:00:00Z')), '2026-07')
  // 1-ago 01:30 UTC = 31-jul 21:30 en Chile: el corte va en hora local
  assert.equal(mesActual(new Date('2026-08-01T01:30:00Z')), '2026-07')
})

test('diaActual corta el día en hora de Chile, no en UTC', () => {
  // sin esto, todo lo gastado entre las 21:00 y medianoche caería al día
  // siguiente y el informe diario mostraría gasto en días sin actividad
  assert.equal(diaActual(new Date('2026-08-11T01:30:00Z')), '2026-08-10')
  assert.equal(diaActual(new Date('2026-08-10T12:00:00Z')), '2026-08-10')
})
