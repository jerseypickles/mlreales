import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { CapturaNichoMl } from '../src/models/CapturaNichoMl.js'
import { SerieNichoMl } from '../src/models/SerieNichoMl.js'
import { ObservacionProductoMl } from '../src/models/ObservacionProductoMl.js'
import { ModeloMl } from '../src/models/ModeloMl.js'
import { PrediccionMl } from '../src/models/PrediccionMl.js'
import { CurvaEstacional } from '../src/models/CurvaEstacional.js'
import { registrarListadoNichoMl, registrarDetalleNichoMl, datosConContexto, estadoIntegracion } from '../src/services/ml/integracion.js'
import { construirContexto, unirFuentes, VERSION_CONTEXTO, OBJETIVO_CONTEXTO } from '../src/services/ml/contexto.js'
import { entrenarComercial, predecirComercial } from '../src/services/ml/comercial.js'
import { entrenarModelosMl } from '../src/services/ml/servicio.js'
import { ejecutarEntrenamiento } from '../src/services/ml/ejecutar.js'
import { indiceMes, periodoMes } from '../src/services/ml/series.js'
import { comercialesSinteticas } from './helpers/mlFixtures.js'
import { config, validarEnv } from '../src/config/env.js'
import { proveedorListado, proveedorDetalle } from '../src/services/scraper.js'

const DIA = 86400e3
let mongod
const modelos = [CapturaNichoMl, SerieNichoMl, ObservacionProductoMl, ModeloMl, PrediccionMl, CurvaEstacional]
before(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  await Promise.all(modelos.map((m) => m.init()))
})
beforeEach(async () => { await Promise.all(modelos.map((m) => m.deleteMany({}))) })
after(async () => { await mongoose.disconnect(); await mongod?.stop() })

function fuente({ nichoId = 'nicho-1', desde = new Date('2026-09-10T12:00:00Z'), factor = 1 } = {}) {
  const capturaEl = new Date(+desde - 2 * 3600e3)
  const ultimo = indiceMes(capturaEl.toISOString().slice(0, 7)) - 1
  return { captura: { _id: 'captura-anterior', nichoId, fuente: 'zyte', keyword: `nicho-${nichoId}`, keywordDemanda: `demanda-${nichoId}`,
    fechaScan: capturaEl, capturadoEl: capturaEl,
    productos: Array.from({ length: 12 }, (_, i) => ({ sku: `competidor-${i}`, itemId: `item-${i}`,
      precio: (10000 + i * 100) * factor, posicion: i + 1, esFull: i < 6, tipoListing: i < 3 ? 'catalogo' : 'listing', resenasZyte: i * 10 })) },
  serie: { _id: 'serie-anterior', keyword: `demanda-${nichoId}`, fuente: 'google-ads', pais: 2152, idioma: 'es', capturadoEl: capturaEl,
    meses: Array.from({ length: 48 }, (_, i) => ({ periodo: periodoMes(ultimo - 47 + i), valor: Math.round(1000 * Math.exp(i * 0.01)) })) } }
}

test('arrancar con Zyte no exige una credencial de Apify', () => {
  const proveedores = { scraperListado: config.scraperListado, scraperDetalle: config.scraperDetalle }
  const claves = ['MONGO_URI', 'REDIS_URL', 'ZYTE_API_KEY', 'APIFY_TOKEN']
  const anteriores = Object.fromEntries(claves.map((k) => [k, process.env[k]]))
  try {
    Object.assign(config, { scraperListado: 'zyte', scraperDetalle: 'zyte' })
    Object.assign(process.env, { MONGO_URI: 'mongodb://prueba', REDIS_URL: 'redis://prueba', ZYTE_API_KEY: 'prueba' })
    delete process.env.APIFY_TOKEN
    assert.equal(proveedorListado(), 'zyte')
    assert.equal(proveedorDetalle(), 'zyte')
    assert.doesNotThrow(validarEnv)
    delete process.env.ZYTE_API_KEY
    assert.throws(validarEnv, /ZYTE_API_KEY/)
  } finally {
    Object.assign(config, proveedores)
    for (const clave of claves) if (anteriores[clave] === undefined) delete process.env[clave]; else process.env[clave] = anteriores[clave]
  }
})

test('unión temporal rechaza futuro, fuentes equivocadas, huecos y scans vencidos', () => {
  const desde = new Date('2026-09-10T12:00:00Z')
  const f = fuente({ desde })
  const entrada = { ...f, desde, itemId: 'propio', precio: 15000 }
  assert.equal(construirContexto(entrada).contexto.xs.length, 9)
  assert.equal(construirContexto({ ...entrada, captura: { ...f.captura, fuente: 'apify' } }).contexto, null)
  assert.equal(construirContexto({ ...entrada, serie: { ...f.serie, pais: 2840 } }).contexto, null)
  assert.equal(construirContexto({ ...entrada, captura: { ...f.captura, capturadoEl: new Date(+desde + 1) } }).contexto, null)
  assert.equal(construirContexto({ ...entrada, captura: { ...f.captura, fechaScan: new Date(+desde - 15 * DIA) } }).contexto, null)
  assert.equal(construirContexto({ ...entrada, serie: { ...f.serie, capturadoEl: new Date(+desde + 1) } }).contexto, null)
  assert.equal(construirContexto({ ...entrada, serie: { ...f.serie, meses: f.serie.meses.filter((_, i) => i !== 35) } }).contexto, null)
  const fila = { nichoId: f.captura.nichoId, desde, itemId: 'propio', precio: 15000 }
  const antes = unirFuentes([fila], [f.captura], [f.serie])
  const conFuturo = unirFuentes([fila], [f.captura, { ...f.captura, _id: 'revision-futura', capturadoEl: new Date(+desde + 1), productos: [] }],
    [f.serie, { ...f.serie, _id: 'serie-futura', capturadoEl: new Date(+desde + 1), meses: [] }])
  assert.deepEqual(conFuturo, antes, 'ni revisiones posteriores ni una keyword corregida mañana reescriben el pasado')
  assert.equal(unirFuentes([{ ...fila, nichoId: null }], [f.captura], [f.serie]).omitidas['producto-sin-nicho-vinculado'], 1)
})

test('la comparación no duplica publicaciones ni confunde reseñas ausentes con cero', () => {
  const desde = new Date('2026-09-10T12:00:00Z')
  const f = fuente({ desde })
  const original = f.captura.productos.slice(0, 10).map((p) => ({ ...p, resenasZyte: null, esFull: null }))
  f.captura.productos = [...original, { ...original[0], sku: 'alias', posicion: 50, precio: 999999 },
    { sku: 'propio', itemId: 'propio', precio: 1, posicion: 1 }]
  const entrada = { ...f, desde, itemId: 'propio', precio: 15000 }
  const ausente = construirContexto(entrada).contexto
  assert.equal(ausente.productosComparados, 10)
  assert.equal(ausente.precioMediano, 10450)
  assert.equal(ausente.xs[8], 0)
  f.captura.productos = original.map((p) => ({ ...p, resenasZyte: 0 }))
  const cero = construirContexto(entrada).contexto
  assert.equal(cero.xs[7], 0)
  assert.equal(cero.xs[8], 1, 'cero medido conserva cobertura; desconocido no')
  f.captura.productos = Array.from({ length: 50 }, () => original[0])
  assert.equal(construirContexto(entrada).motivo, 'pocos-productos-zyte')
})

test('listado y detalle Zyte quedan congelados con sus fechas y keyword de demanda', async () => {
  const nicho = { _id: new mongoose.Types.ObjectId(), keyword: 'lampara unas', domainCode: 'CL' }
  await CurvaEstacional.create({ keyword: nicho.keyword, keywordMedida: 'lampara de uñas', medidoEl: new Date('2026-08-31') })
  const fecha = new Date('2026-09-01T10:00:00Z')
  const items = [{ producto: { sku: 'MLC1', itemId: 'MLC11', esFull: true, tipoListing: 'listing' },
    snapshot: { posicion: 1, precio: 10000, numReviews: null, numReviewsApi: 9999, vendidos: 500 } }]
  const args = { nicho, items, fecha, fuente: 'zyte', ahora: new Date(+fecha + 1000) }
  const listado = await registrarListadoNichoMl(args)
  await registrarListadoNichoMl({ ...args, ahora: new Date(+fecha + 2000) })
  assert.equal(await CapturaNichoMl.countDocuments(), 1)
  assert.equal(listado.keywordDemanda, 'lampara de uñas')
  assert.equal(listado.productos[0].resenasZyte, null, 'no atribuye a Zyte el conteo de la API')
  assert.equal(await registrarListadoNichoMl({ ...args, fuente: 'apify' }), null)
  const porSku = new Map([['MLC1', { precio: 9000, numReviews: 30, esFull: null }]])
  const detalle = await registrarDetalleNichoMl({ nichoId: nicho._id, porSku, fecha, fuente: 'zyte', ahora: new Date(+fecha + 3600e3) })
  assert.equal(await CapturaNichoMl.countDocuments(), 2)
  assert.equal(detalle.productos.length, 1)
  assert.equal(detalle.productos[0].resenasZyte, 30)
  assert.equal(detalle.productos[0].precio, 9000)
  assert.equal((await CapturaNichoMl.findById(listado._id)).productos[0].precio, 10000)
  assert.ok(+detalle.capturadoEl > +listado.capturadoEl)
})

function filasSinteticasConContexto() {
  return comercialesSinteticas().map((o, j) => {
    const i = Math.floor(j / 20), w = j % 20
    const señal = Math.sin(w * 0.71 + (i % 3) * 2)
    return { ...o, unidades: Math.round(Math.expm1(1.4 + 0.5 * señal) * o.visitas / 100),
      contexto: { version: VERSION_CONTEXTO, nichoId: `nicho-${i % 4}`,
        xs: [6, 0.1, 0.2, señal, 0.5, 1, 0.2, 3, 1] } }
  })
}

test('el modelo combinado aprende contexto y lo compara con las mismas filas sin contexto', async () => {
  const datos = filasSinteticasConContexto()
  const modelo = entrenarComercial(datos, { conContexto: true })
  assert.equal(modelo.estado, 'sombra')
  assert.equal(modelo.objetivo, OBJETIVO_CONTEXTO)
  assert.ok(modelo.evaluacion.maeLog < modelo.evaluacion.referenciaSinContexto * 0.8)
  assert.equal(modelo.evaluacion.referenciaSinContexto, entrenarComercial(datos).evaluacion.maeLog)
  assert.ok(predecirComercial(modelo, datos[0]))
  assert.equal(predecirComercial(modelo, { ...datos[0], contexto: null }), null)
  assert.equal(predecirComercial(modelo, { ...datos[0], contexto: { ...datos[0].contexto, xs: Array(9).fill(99999) } }), null)
  assert.deepEqual(await ejecutarEntrenamiento(OBJETIVO_CONTEXTO, datos), modelo)
  assert.equal(entrenarComercial(datos.map((o) => ({ ...o, contexto: undefined })), { conContexto: true }).estado, 'datos-insuficientes')
})

test('ciclo de tres fuentes: datos guardados, unión, entrenamiento y cobertura auditables', async () => {
  const ahora = new Date()
  const ids = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId())
  const comerciales = comercialesSinteticas()
  const delta = +ahora - DIA - Math.max(...comerciales.map((o) => +o.hasta))
  const capturas = [], series = [], observaciones = []
  for (let n = 0; n < 4; n++) for (let w = 0; w < 20; w++) {
    const desde = new Date(+comerciales[w].desde + delta)
    const f = fuente({ nichoId: ids[n], desde, factor: Math.exp(Math.sin(w * 0.7 + n) * 0.3) })
    capturas.push({ ...f.captura, _id: new mongoose.Types.ObjectId(), huella: `zyte-${n}-${w}`, fase: 'listado' })
    series.push({ ...f.serie, _id: new mongoose.Types.ObjectId(), huella: `google-${n}-${w}` })
  }
  for (const [j, o] of comerciales.entries()) {
    const i = Math.floor(j / 20), w = j % 20, n = i % 4
    const desde = new Date(+o.desde + delta), hasta = new Date(+o.hasta + delta)
    const contexto = construirContexto({ captura: capturas[n * 20 + w], serie: series[n * 20 + w], desde, itemId: o.itemId, precio: o.precio }).contexto
    observaciones.push({ ...o, desde, hasta, nichoId: ids[n], dia: hasta.toISOString().slice(0, 10),
      unidades: Math.round(Math.expm1(1.4 + 0.4 * contexto.xs[3]) * o.visitas / 100) })
  }
  await CapturaNichoMl.insertMany(capturas)
  await SerieNichoMl.insertMany(series)
  await ObservacionProductoMl.insertMany(observaciones)
  const enlace = await datosConContexto({ ahora })
  assert.equal(enlace.datos.length, 640)
  assert.deepEqual(enlace.omitidas, {})
  assert.ok(enlace.datos.every((o) => +new Date(o.contexto.zyteDisponibleEl) <= +o.desde && +new Date(o.contexto.demandaDisponibleEl) <= +o.desde))
  const resultado = await entrenarModelosMl()
  assert.equal(resultado.modelos.find((m) => m.objetivo === OBJETIVO_CONTEXTO).estado, 'sombra')
  assert.equal(await ModeloMl.countDocuments(), 3)
  await entrenarModelosMl()
  assert.equal(await ModeloMl.countDocuments(), 3, 'las mismas fuentes no duplican versiones')
  const estado = await estadoIntegracion({ ahora })
  assert.equal(estado.nichosCapturados, 4)
  assert.equal(estado.ventanasUnidas, 640)
  assert.equal(estado.productosUnidos, 32)
})
