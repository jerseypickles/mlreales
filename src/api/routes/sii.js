import { Router } from 'express'
import { estadoSesion, guardarSesion, liquidacionesDelPeriodo, SesionSiiVencida } from '../../services/sii.js'
import { mesActual } from '../../services/gastos.js'

// El SII no tiene API: estas rutas hablan con los endpoints internos del RCV
// usando una sesión que el usuario abrió a mano (ver services/sii.js).
const rutasSii = Router()

const periodoValido = (p) => /^\d{4}-\d{2}$/.test(p ?? '')

rutasSii.get('/estado', async (_req, res, next) => {
  try {
    res.json(await estadoSesion())
  } catch (err) {
    next(err)
  }
})

// Recibe las cookies de la sesión abierta en sii.cl. NO recibe la clave, y no
// debe: ver el comentario del modelo SiiSesion.
rutasSii.post('/sesion', async (req, res, next) => {
  try {
    const cookies = req.body?.cookies
    if (typeof cookies !== 'string' || !cookies.trim()) {
      return res.status(400).json({ error: 'falta el string de cookies de www4.sii.cl' })
    }
    if (/clave=|password=/i.test(cookies) && !/NETSCAPE_LIVEWIRE\.clave=\$2a\$/.test(cookies)) {
      // el hash bcrypt de la sesión sí viaja en las cookies y es esperable; una
      // clave en texto plano no lo es, y no la vamos a guardar
      return res.status(400).json({ error: 'eso parece traer una clave en texto plano: manda solo las cookies' })
    }
    res.json(await guardarSesion(cookies))
  } catch (err) {
    if (err instanceof SesionSiiVencida) return res.status(409).json({ error: err.message, reconectar: true })
    res.status(400).json({ error: err.message })
  }
})

rutasSii.get('/rcv', async (req, res, next) => {
  try {
    const periodo = periodoValido(req.query.periodo) ? req.query.periodo : mesActual()
    res.json(await liquidacionesDelPeriodo(periodo))
  } catch (err) {
    if (err instanceof SesionSiiVencida) return res.status(409).json({ error: err.message, reconectar: true })
    next(err)
  }
})

export default rutasSii
