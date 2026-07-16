import express from 'express'
import mongoose from 'mongoose'
import rutasNichos from './routes/nichos.js'
import rutasProductos from './routes/productos.js'
import rutasDebug from './routes/debug.js'
import { obtenerColas } from '../jobs/queues.js'

export function crearApp() {
  const app = express()
  app.use(express.json())

  // el dashboard corre en otro dominio (static site); CORS_ORIGEN restringe si se define
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGEN || '*')
    res.set('Access-Control-Allow-Headers', 'Content-Type')
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
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

  app.use('/api/nichos', rutasNichos)
  app.use('/api/productos', rutasProductos)
  app.use('/api/debug', rutasDebug)

  app.use((_req, res) => res.status(404).json({ error: 'ruta no encontrada' }))

  app.use((err, _req, res, _next) => {
    if (err.name === 'CastError') return res.status(400).json({ error: 'id inválido' })
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' })
    console.error('[api]', err)
    res.status(500).json({ error: err.message || 'error interno' })
  })

  return app
}
