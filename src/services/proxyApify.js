import { fetch as fetchUndici, ProxyAgent } from 'undici'
import { config } from '../config/env.js'

// Proxy residencial de Apify para endpoints públicos de ML que bloquean IPs de
// datacenter (el autosuggest devuelve 403 sostenido desde Render). Es el mismo
// pool que ya usan los actores de detalle; el tráfico extra son KB por día.
// La password del proxy no es el API token: se pide una vez a /users/me.

let passwordPromise = null

async function obtenerPassword() {
  const res = await fetch(`https://api.apify.com/v2/users/me?token=${config.apifyToken}`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Apify /users/me respondió ${res.status}`)
  const { data } = await res.json()
  const password = data?.proxy?.password
  if (!password) throw new Error('la cuenta de Apify no expone proxy password')
  return password
}

// Repite el request saliendo por una IP residencial NUEVA (sesión aleatoria por
// llamada): un agente reutilizado mantiene el mismo túnel/IP y el WAF de ML la
// quema tras un par de consultas — medido 2/27 con IP fija. null si no hay
// APIFY_TOKEN (tests, entorno local pelado). Se usa el fetch de undici y no el
// global: un dispatcher de otra copia de undici no es intercambiable entre ambos.
export async function fetchResidencial(url, opciones = {}) {
  if (!config.apifyToken) return null
  if (!passwordPromise) {
    passwordPromise = obtenerPassword().catch((err) => {
      passwordPromise = null // la próxima llamada reintenta
      throw err
    })
  }
  const password = await passwordPromise
  const sesion = `s${Math.floor(Math.random() * 1e9)}`
  const dispatcher = new ProxyAgent(
    `http://groups-RESIDENTIAL,session-${sesion}:${password}@proxy.apify.com:8000`,
  )
  try {
    return await fetchUndici(url, { ...opciones, dispatcher })
  } finally {
    dispatcher.close().catch(() => {})
  }
}
