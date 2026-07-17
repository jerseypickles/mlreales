import { fetch as fetchUndici, ProxyAgent } from 'undici'
import { config } from '../config/env.js'

// Proxy residencial de Apify para endpoints públicos de ML que bloquean IPs de
// datacenter (el autosuggest devuelve 403 sostenido desde Render). Es el mismo
// pool que ya usan los actores de detalle; el tráfico extra son KB por día.
// La password del proxy no es el API token: se pide una vez a /users/me.

let agentePromise = null

async function crearAgente() {
  const res = await fetch(`https://api.apify.com/v2/users/me?token=${config.apifyToken}`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Apify /users/me respondió ${res.status}`)
  const { data } = await res.json()
  const password = data?.proxy?.password
  if (!password) throw new Error('la cuenta de Apify no expone proxy password')
  return new ProxyAgent(`http://groups-RESIDENTIAL:${password}@proxy.apify.com:8000`)
}

// Repite el request saliendo por una IP residencial. null si no hay APIFY_TOKEN
// (tests, entorno local pelado). Se usa el fetch de undici y no el global: un
// dispatcher de otra copia de undici no es intercambiable entre ambos.
export async function fetchResidencial(url, opciones = {}) {
  if (!config.apifyToken) return null
  if (!agentePromise) {
    agentePromise = crearAgente().catch((err) => {
      agentePromise = null // la próxima llamada reintenta la creación
      throw err
    })
  }
  const dispatcher = await agentePromise
  return fetchUndici(url, { ...opciones, dispatcher })
}
