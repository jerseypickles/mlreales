import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MongoMemoryServer } from 'mongodb-memory-server'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/nivel1.json', import.meta.url), 'utf8'))

let mongod
let mongoose
let servidor
let baseUrl
let cerrarColas
let modelos
let servicios

before(async () => {
  mongod = await MongoMemoryServer.create()
  process.env.MONGO_URI = mongod.getUri()
  process.env.REDIS_URL = 'redis://127.0.0.1:6390' // puerto sin servicio: la API debe funcionar igual salvo encolar
  process.env.APIFY_TOKEN = 'token-de-prueba'

  // imports dinámicos para que config/env.js lea las variables ya seteadas
  mongoose = (await import('mongoose')).default
  await mongoose.connect(process.env.MONGO_URI)
  const { crearApp } = await import('../src/api/app.js')
  ;({ cerrarColas } = await import('../src/jobs/queues.js'))
  modelos = {
    Nicho: (await import('../src/models/Nicho.js')).Nicho,
  }
  servicios = {
    normalizarScan: (await import('../src/services/normalizador.js')).normalizarScan,
    guardarScan: (await import('../src/services/persistencia.js')).guardarScan,
  }

  servidor = crearApp().listen(0)
  await new Promise((resolver) => servidor.on('listening', resolver))
  baseUrl = `http://127.0.0.1:${servidor.address().port}`
})

after(async () => {
  servidor?.close()
  await cerrarColas?.()
  await mongoose?.disconnect()
  await mongod?.stop()
})

test('GET /api/salud reporta mongo ok y redis desconectado', async () => {
  const resp = await fetch(`${baseUrl}/api/salud`)
  const cuerpo = await resp.json()
  assert.equal(resp.status, 200)
  assert.equal(cuerpo.mongo, 'ok')
  assert.equal(cuerpo.redis, 'desconectado')
  assert.equal(cuerpo.ok, false)
})

test('POST /api/nichos valida keyword y frecuencia', async () => {
  const sinKeyword = await fetch(`${baseUrl}/api/nichos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(sinKeyword.status, 400)

  const frecuenciaMala = await fetch(`${baseUrl}/api/nichos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: 'foco solares', frecuenciaScan: 'mensual' }),
  })
  assert.equal(frecuenciaMala.status, 400)
})

test('GET /api/nichos con base vacía', async () => {
  const resp = await fetch(`${baseUrl}/api/nichos`)
  const cuerpo = await resp.json()
  assert.equal(resp.status, 200)
  assert.deepEqual(cuerpo.nichos, [])
})

test('reporte e historia sobre datos de un scan', async () => {
  const fecha = new Date('2026-07-16T12:00:00Z')
  const scan = servicios.normalizarScan(fixture, { fecha, keyword: 'foco solares' })
  await servicios.guardarScan({ items: scan.items, fecha })
  const nicho = await modelos.Nicho.create({
    keyword: 'foco solares',
    ultimoScanEl: fecha,
    ultimoTotalResultados: scan.totalResultados,
  })

  // el reporte se calcula al vuelo cuando el job de métricas aún no corrió
  const reporteResp = await fetch(`${baseUrl}/api/nichos/${nicho._id}/reporte`)
  assert.equal(reporteResp.status, 200)
  const { reporte } = await reporteResp.json()
  assert.equal(reporte.metricas.universo.productosAnalizados, 3)
  assert.equal(reporte.metricas.universo.totalResultadosBusqueda, 9999)
  assert.equal(reporte.metricas.competencia.sellersUnicos, 2)
  assert.equal(reporte.topProductos.length, 3)
  assert.equal(reporte.topProductos[0].sku, 'MLC45499727')
  assert.equal(reporte.topProductos[0].esFull, true)

  // segunda llamada devuelve el reporte ya persistido
  const segunda = await fetch(`${baseUrl}/api/nichos/${nicho._id}/reporte`)
  const cuerpo2 = await segunda.json()
  assert.equal(String(cuerpo2.reporte._id), String(reporte._id))

  // los nichos listan el resumen del último reporte
  const lista = await fetch(`${baseUrl}/api/nichos`)
  const { nichos } = await lista.json()
  assert.equal(nichos.length, 1)
  assert.equal(nichos[0].ultimoReporte.productosAnalizados, 3)

  // historia de un producto
  const historia = await fetch(`${baseUrl}/api/productos/MLC45499727/historia`)
  assert.equal(historia.status, 200)
  const cuerpoHistoria = await historia.json()
  assert.equal(cuerpoHistoria.producto.sku, 'MLC45499727')
  assert.equal(cuerpoHistoria.snapshots.length, 1)
  assert.equal(cuerpoHistoria.snapshots[0].precio, 15990)

  const noExiste = await fetch(`${baseUrl}/api/productos/MLC000/historia`)
  assert.equal(noExiste.status, 404)
})

test('GET /api/nichos/:id/productos entrega el último scan completo', async () => {
  const nicho = await modelos.Nicho.findOne({ keyword: 'foco solares' })
  const resp = await fetch(`${baseUrl}/api/nichos/${nicho._id}/productos`)
  assert.equal(resp.status, 200)
  const cuerpo = await resp.json()
  assert.equal(cuerpo.total, 3)
  assert.equal(cuerpo.productos[0].sku, 'MLC45499727') // ordenado por posición
  assert.equal(cuerpo.productos[0].esFull, true)
  assert.ok(cuerpo.productos.every((p) => 'origenCrossBorder' in p))
})

test('ids inválidos e inexistentes', async () => {
  const invalido = await fetch(`${baseUrl}/api/nichos/no-es-un-id/reporte`)
  assert.equal(invalido.status, 400)

  const inexistente = await fetch(`${baseUrl}/api/nichos/64b000000000000000000000/reporte`)
  assert.equal(inexistente.status, 404)
})
