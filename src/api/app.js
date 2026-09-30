import express from 'express'
import mongoose from 'mongoose'
import rutasNichos from './routes/nichos.js'
import rutasProductos from './routes/productos.js'
import rutasPropios from './routes/propios.js'
import rutasDebug from './routes/debug.js'
import rutasMargen from './routes/margen.js'
import rutasTendencias from './routes/tendencias.js'
import rutasOportunidades from './routes/oportunidades.js'
import rutasCriterios from './routes/criterios.js'
import rutasMeli from './routes/meli.js'
import rutasEstratega from './routes/estratega.js'
import rutasSii from './routes/sii.js'
import rutasAprendizaje from './routes/aprendizaje.js'
import rutasMasVendidos from './routes/masVendidos.js'
import rutasSeguimiento from './routes/seguimiento.js'
import { obtenerColas } from '../jobs/queues.js'
import { gastoDelMes, mesActual } from '../services/gastos.js'
import { config } from '../config/env.js'

export function crearApp() {
  const app = express()
  app.use(express.json())

  // el dashboard corre en otro dominio (static site); CORS_ORIGEN restringe si se define
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGEN || '*')
    res.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-debug-key')
    res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  // API key: si API_KEY está definida, toda la API la exige salvo /api/salud
  // (el health check de Render no manda headers) y el callback OAuth de ML
  // (llega desde el navegador redirigido por Mercado Libre, sin headers nuestros)
  app.use('/api', (req, res, next) => {
    const clave = process.env.API_KEY
    if (!clave || req.path === '/salud' || req.path === '/meli/oauth/callback') return next()
    if (req.get('x-api-key') === clave) return next()
    res.status(401).json({ error: 'no autorizado: falta o no coincide x-api-key' })
  })

  app.get('/api/salud', async (_req, res) => {
    const mongo = mongoose.connection.readyState === 1 ? 'ok' : 'desconectado'
    let redis = 'desconectado'
    try {
      // con Redis caído el cliente de BullMQ nunca resuelve: acotar con timeout
      const pong = await Promise.race([
        obtenerColas().scanNicho.client.then((cliente) => cliente.ping()),
        new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('timeout')), 1500)),
      ])
      if (pong === 'PONG') redis = 'ok'
    } catch {
      // queda "desconectado"
    }
    res.json({ ok: mongo === 'ok' && redis === 'ok', mongo, redis })
  })

  // gasto del mes vs techo: cuando gastado >= presupuesto, programador y radar se detienen solos
  app.get('/api/gastos', async (req, res) => {
    const gastadoUsd = await gastoDelMes()
    const { saldoApify } = await import('../services/apify.js')
    const apify = await saldoApify().catch(() => null)
    // desglose diario IA vs scraping: el total del mes suma los dos y no
    // permitía responder cuánto cuesta la IA por sí sola
    const { gastoPorDia, iaPorNicho } = await import('../services/gastos.js')
    const dias = Math.min(90, Math.max(1, Number(req.query.dias) || 30))
    const porDia = await gastoPorDia({ dias }).catch(() => null)
    const iaNichos = await iaPorNicho().catch(() => null)
    res.json({ mes: mesActual(), gastadoUsd, presupuestoUsd: config.presupuestoUsdMes, apify, porDia, iaNichos })
  })

  // Posición de IVA del mes. Panel de gestión, NO una declaración: no existe
  // API para presentar ni pagar el F29.
  app.get('/api/contabilidad', async (req, res, next) => {
    try {
      const { posicionIva } = await import('../services/contabilidad.js')
      const periodo = /^\d{4}-\d{2}$/.test(req.query.periodo ?? '') ? req.query.periodo : undefined
      res.json(await posicionIva({ periodo }))
    } catch (err) {
      next(err)
    }
  })

  // EL F29 DE CADA MES y lo que no llega solo (ver services/f29.js)
  app.get('/api/contabilidad/f29', async (_req, res, next) => {
    try {
      const { resumenF29 } = await import('../services/f29.js')
      res.json(await resumenF29())
    } catch (err) { next(err) }
  })
  // lo que se declaró en el SII: { periodo, declaradoEl, folio?, pagadoClp?, remanenteClp?, notas? }
  app.post('/api/contabilidad/declaraciones', express.json(), async (req, res, next) => {
    try {
      const { DeclaracionF29 } = await import('../models/DeclaracionF29.js')
      const b = req.body ?? {}
      if (!/^\d{4}-\d{2}$/.test(b.periodo ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(b.declaradoEl ?? '')) return res.status(400).json({ error: 'periodo AAAA-MM y declaradoEl AAAA-MM-DD' })
      const num = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : null)
      const d = await DeclaracionF29.findOneAndUpdate({ periodo: b.periodo }, { $set: { declaradoEl: b.declaradoEl, folio: b.folio || null, pagadoClp: num(b.pagadoClp), remanenteClp: num(b.remanenteClp), notas: b.notas || null, actualizadoEl: new Date() } }, { upsert: true, new: true })
      res.json(d)
    } catch (err) { next(err) }
  })
  app.delete('/api/contabilidad/declaraciones/:periodo', async (req, res, next) => {
    try {
      const { DeclaracionF29 } = await import('../models/DeclaracionF29.js')
      res.json({ ok: (await DeclaracionF29.deleteOne({ periodo: req.params.periodo })).deletedCount > 0 })
    } catch (err) { next(err) }
  })
  // documentos que no llegan solos: la DIN de importación y facturas fuera del RCV
  app.get('/api/contabilidad/documentos', async (_req, res, next) => {
    try {
      const { DocumentoCompra } = await import('../models/DocumentoCompra.js')
      res.json({ documentos: await DocumentoCompra.find().sort({ fecha: -1 }).lean() })
    } catch (err) { next(err) }
  })
  app.post('/api/contabilidad/documentos', express.json(), async (req, res, next) => {
    try {
      const { DocumentoCompra } = await import('../models/DocumentoCompra.js')
      const b = req.body ?? {}
      if (!['din', 'factura'].includes(b.tipo) || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha ?? '') || !(Number(b.ivaClp) >= 0)) return res.status(400).json({ error: 'tipo din|factura, fecha AAAA-MM-DD e ivaClp ≥ 0' })
      const n = (v) => (v === '' || v == null ? null : Math.round(Number(v)))
      res.status(201).json(await DocumentoCompra.create({ tipo: b.tipo, fecha: b.fecha, folio: b.folio || null, proveedor: b.proveedor || null, netoClp: n(b.netoClp) ?? 0, ivaClp: n(b.ivaClp), totalClp: n(b.totalClp), notas: b.notas || null }))
    } catch (err) { next(err) }
  })
  app.delete('/api/contabilidad/documentos/:id', async (req, res, next) => {
    try {
      const { DocumentoCompra } = await import('../models/DocumentoCompra.js')
      res.json({ ok: (await DocumentoCompra.deleteOne({ _id: req.params.id })).deletedCount > 0 })
    } catch (err) { next(err) }
  })
  // leer ya las facturas de ML (tarda: el endpoint acepta 5 pedidos por minuto)
  app.post('/api/contabilidad/facturas-ml', async (_req, res, next) => {
    try {
      const { sincronizarFacturasMl } = await import('../services/facturasMl.js')
      sincronizarFacturasMl().catch((e) => console.warn(`[facturas-ml] ${e.message}`))
      res.status(202).json({ iniciado: true })
    } catch (err) { next(err) }
  })

  app.use('/api/nichos', rutasNichos)
  app.use('/api/productos', rutasProductos)
  app.use('/api/propios', rutasPropios)
  app.use('/api/debug', rutasDebug)
  app.use('/api/margen', rutasMargen)
  app.use('/api/tendencias', rutasTendencias)
  app.use('/api/oportunidades', rutasOportunidades)
  app.use('/api/criterios', rutasCriterios)
  app.use('/api/meli', rutasMeli)
  app.use('/api/estratega', rutasEstratega)
  app.use('/api/sii', rutasSii)
  app.use('/api/aprendizaje', rutasAprendizaje)
  app.use('/api/mas-vendidos', rutasMasVendidos)
  app.use('/api/seguimiento', rutasSeguimiento)

  app.use((_req, res) => res.status(404).json({ error: 'ruta no encontrada' }))

  app.use((err, _req, res, _next) => {
    if (err.name === 'CastError') return res.status(400).json({ error: 'id inválido' })
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' })
    console.error('[api]', err)
    res.status(500).json({ error: err.message || 'error interno' })
  })

  return app
}
