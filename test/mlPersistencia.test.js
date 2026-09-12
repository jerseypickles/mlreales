import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../src/config/env.js'
import { sugerirNichos } from '../src/services/sugeridor.js'
import { SerieNichoMl } from '../src/models/SerieNichoMl.js'
import { ModeloMl } from '../src/models/ModeloMl.js'
import { PrediccionMl } from '../src/models/PrediccionMl.js'
import { ObservacionProductoMl } from '../src/models/ObservacionProductoMl.js'
import { guardarSeriesMl, huellaDe } from '../src/services/ml/registro.js'
import { entrenarModelosMl, estadoMl, seriesActuales, evaluarPrediccionesMl, registrarPronosticosMl, perfilesPropiosMl } from '../src/services/ml/servicio.js'
import { indiceMes, periodoMes } from '../src/services/ml/series.js'
import { seriesSinteticas } from './helpers/mlFixtures.js'

let mongod
before(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  await Promise.all([SerieNichoMl.init(), ModeloMl.init(), PrediccionMl.init(), ObservacionProductoMl.init()])
})
beforeEach(async () => {
  await Promise.all([SerieNichoMl.deleteMany({}), ModeloMl.deleteMany({}), PrediccionMl.deleteMany({}), ObservacionProductoMl.deleteMany({})])
})
after(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

test('capturas idempotentes conservan revisiones, fuentes y ceros; no inventan meses futuros', async () => {
  const ahora = new Date('2026-09-11T12:00:00Z')
  const r = [{ keyword: 'x', monthly_searches: [
    { year: 2026, month: 7, search_volume: 0 }, { year: 2026, month: 9, search_volume: 99 },
  ] }]
  const opciones = { pais: 2152, idioma: 'es', ahora }
  await guardarSeriesMl(r, opciones)
  await guardarSeriesMl(r, opciones)
  assert.equal(await SerieNichoMl.countDocuments(), 1)
  assert.equal((await seriesActuales())[0].meses.length, 1)
  assert.equal((await seriesActuales())[0].meses[0].valor, 0)
  r[0].monthly_searches[0].search_volume = 10
  await guardarSeriesMl(r, { ...opciones, ahora: new Date(+ahora + 1000) })
  assert.equal(await SerieNichoMl.countDocuments(), 2)
  assert.equal((await seriesActuales())[0].meses[0].valor, 10)
  await guardarSeriesMl(r, { ...opciones, pais: 2840 })
  assert.equal((await seriesActuales()).length, 1, 'no mezcla países')
})

test('sin datos se registra el motivo y no nace un modelo ficticio', async () => {
  const r = await entrenarModelosMl()
  assert.ok(r.modelos.every((m) => m.estado === 'datos-insuficientes'))
  assert.equal((await estadoMl()).usaParaDecidir, false)
  assert.equal(await PrediccionMl.countDocuments(), 0)
  await entrenarModelosMl()
  assert.equal(await ModeloMl.countDocuments(), 3, 'un intento por versión y dataset')
})

test('seguimiento informa continuidad real, fechas y ceros sin contar observaciones futuras ni vencidas', async () => {
  const ahora = new Date('2026-09-11T12:00:00Z')
  const inicio = indiceMes('2024-08')
  const meses = Array.from({ length: 25 }, (_, i) => ({ periodo: periodoMes(inicio + i), valor: 100 }))
  await guardarSeriesMl([
    { keyword: 'continua', monthly_searches: meses },
    { keyword: 'con hueco', monthly_searches: meses.filter((_, i) => i !== 15) },
  ], { pais: 2152, idioma: 'es', ahora })
  const semana = (itemId, hasta) => ({ itemId, titulo: itemId, categoria: 'MLC1',
    desde: new Date(+hasta - 7 * 86400e3), hasta, dia: hasta.toISOString().slice(0, 10),
    visitas: 100, unidades: 0, precio: 15000, full: true })
  await ObservacionProductoMl.insertMany([
    semana('stock-anterior', ahora),
    semana('dato-futuro', new Date(+ahora + 8 * 86400e3)),
    semana('fuera-del-historial', new Date(+ahora - 731 * 86400e3)),
  ])
  await ModeloMl.create({ huella: 'modelo-vencido-prueba', objetivo: 'busquedas-google',
    creadoEl: new Date(+ahora - 91 * 86400e3), resultado: { estado: 'sombra', cobertura: {} } })
  const estado = await estadoMl({ ahora })
  assert.deepEqual(estado.alcance, { usaCostoCompra: false, estimaRentabilidad: false })
  assert.equal(estado.cobertura.keywords, 2)
  assert.equal(estado.cobertura.con24Meses, 1, '24 meses dispersos no cuentan como continuidad')
  assert.equal(estado.cobertura.productos, 1)
  assert.equal(estado.cobertura.ventanasIndependientes, 1)
  assert.equal(+estado.fuentes.demanda.ultimaCapturaEl, +ahora)
  assert.equal(+estado.fuentes.comercial.ultimaVentanaEl, +ahora)
  assert.equal(estado.modelos[0].vigente, false)
  const perfiles = await perfilesPropiosMl({ ahora })
  assert.equal(perfiles.length, 1)
  assert.equal(perfiles[0].itemId, 'stock-anterior')
  assert.equal(perfiles[0].unidadesPor100Visitas, 0)
  assert.equal(+perfiles[0].desde, +ahora - 7 * 86400e3)
})

test('el modo observación no cambia el prompt ni las sugerencias aunque existan resultados propios ML', async (t) => {
  const original = { mlActivo: config.mlActivo, anthropicApiKey: config.anthropicApiKey,
    dataForSeoLogin: config.dataForSeoLogin, dataForSeoPassword: config.dataForSeoPassword }
  const solicitudes = []
  t.mock.method(Anthropic.Messages.prototype, 'create', async (solicitud) => {
    solicitudes.push(solicitud)
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
      sugerencias: [{ keyword: 'organizador cocina', categoria: 'hogar', razon: 'Ejemplo de prueba' }],
    }) }] }
  })
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('La prueba no debe llamar a servicios externos') })
  try {
    Object.assign(config, { mlActivo: false, anthropicApiKey: 'clave-local-de-prueba',
      dataForSeoLogin: null, dataForSeoPassword: null })
    const base = await sugerirNichos()
    const hasta = new Date(), desde = new Date(+hasta - 7 * 86400e3)
    await ObservacionProductoMl.create({ itemId: 'MLC-PRUEBA', titulo: 'PERFIL SOLO PARA OBSERVACION',
      categoria: 'MLC-PRUEBA', desde, hasta, dia: hasta.toISOString().slice(0, 10),
      visitas: 100, unidades: 20, precio: 15000, full: true })
    config.mlActivo = true
    const { aprendizajeMl, ...observado } = await sugerirNichos()
    assert.deepEqual(solicitudes[1], solicitudes[0], 'la evidencia ML no influye en el generador actual')
    assert.deepEqual(observado, base, 'la captura ML no altera contenido, filtros ni orden')
    assert.equal(aprendizajeMl.estado, 'sin-modelo-entrenado')

    t.mock.method(ModeloMl, 'findOne', () => { throw new Error('Fallo de registro ML simulado') })
    const avisos = t.mock.method(console, 'warn', () => {})
    assert.deepEqual(await sugerirNichos(), base, 'el radar sigue entregando sugerencias si falla la observación')
    assert.deepEqual(solicitudes[2], solicitudes[0])
    assert.equal(avisos.mock.callCount(), 1)
  } finally {
    Object.assign(config, original)
  }
})

test('ciclo completo: entrenar, congelar, volver a entrenar sin duplicar y evaluar un resultado futuro', async () => {
  const ahora = new Date()
  const inicio = indiceMes(ahora.toISOString().slice(0, 7)) - 48
  const series = seriesSinteticas().map((s) => ({ ...s,
    meses: s.meses.map((m, i) => ({ ...m, periodo: periodoMes(inicio + i) })) }))
  const crudos = series.map((s) => ({ keyword: s.keyword, monthly_searches: s.meses }))
  await guardarSeriesMl(crudos, { pais: 2152, idioma: 'es', ahora: new Date(+ahora - 1000) })
  const r = await entrenarModelosMl()
  assert.equal(r.modelos.find((m) => m.objetivo === 'busquedas-google').estado, 'sombra')
  assert.equal(await PrediccionMl.countDocuments(), 15)
  const antes = await PrediccionMl.findOne().lean()
  const huellaAntes = huellaDe(antes.datos)
  await entrenarModelosMl()
  assert.equal(await PrediccionMl.countDocuments(), 15)
  assert.equal(await ModeloMl.countDocuments(), 3)
  const [a, m] = antes.periodo.split('-').map(Number)
  const capturaFutura = new Date(Date.UTC(a, m, 10))
  await guardarSeriesMl([{ keyword: antes.keyword, monthly_searches: [{ periodo: antes.periodo, valor: 0 }] }],
    { pais: 2152, idioma: 'es', ahora: capturaFutura })
  assert.equal((await evaluarPrediccionesMl()).evaluadas, 1)
  const despues = await PrediccionMl.findById(antes._id).lean()
  assert.equal(huellaDe(despues.datos), huellaAntes, 'el resultado no reescribe la predicción')
  assert.equal(despues.evaluacion.real, 0)
  assert.equal((await evaluarPrediccionesMl()).evaluadas, 0)
  const pred = await registrarPronosticosMl([antes.keyword], { ahora })
  assert.equal(pred.pronosticos.length, 0, 'una captura futura no entra a inferencia pasada')
})
