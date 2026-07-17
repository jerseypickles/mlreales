import { config } from '../config/env.js'

const API_BASE = 'https://api.apify.com/v2'

// El actor de búsqueda selecciona país por URL de listado (enum de su input schema,
// validado contra apify.com/karamelo/mercadolibre-scraper-espanol-castellano el 2026-07-16).
const URL_LISTADO_POR_DOMINIO = {
  CL: 'https://listado.mercadolibre.cl/',
  AR: 'https://listado.mercadolibre.com.ar/',
  CO: 'https://listado.mercadolibre.com.co/',
  MX: 'https://listado.mercadolibre.com.mx/',
  PE: 'https://listado.mercadolibre.com.pe/',
  UY: 'https://listado.mercadolibre.com.uy/',
}

export class ApifyError extends Error {
  constructor(mensaje, { status = null, actorId = null } = {}) {
    super(mensaje)
    this.name = 'ApifyError'
    this.status = status
    this.actorId = actorId
  }
}

// Token por header y no por query string, para que nunca quede en URLs ni logs.
function cabeceras() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apifyToken}` }
}

async function leerMensajeError(resp) {
  const texto = await resp.text().catch(() => '')
  try {
    return JSON.parse(texto)?.error?.message || texto.slice(0, 300)
  } catch {
    return texto.slice(0, 300)
  }
}

// Modo sync: Apify lo corta a los 300s; suficiente para búsquedas de 1-3 páginas.
// Con `conMeta: true` devuelve { items, runId } para poder inspeccionar el log del run.
export async function ejecutarActorSync(actorId, input, { timeoutMs = 300_000, conMeta = false } = {}) {
  const url = `${API_BASE}/acts/${actorId}/run-sync-get-dataset-items?clean=true&format=json`
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new ApifyError(`Sin respuesta de Apify para ${actorId}: ${err.message}`, { actorId })
  }
  if (resp.status === 429) {
    throw new ApifyError(`Rate limit de Apify (429) en ${actorId}; el job reintenta con backoff`, {
      status: 429,
      actorId,
    })
  }
  if (!resp.ok) {
    throw new ApifyError(`Apify respondió ${resp.status} en ${actorId}: ${await leerMensajeError(resp)}`, {
      status: resp.status,
      actorId,
    })
  }
  const items = await resp.json()
  if (!Array.isArray(items)) {
    throw new ApifyError(`Respuesta inesperada de ${actorId}: se esperaba un array de items`, { actorId })
  }
  if (conMeta) return { items, runId: resp.headers.get('x-apify-run-id') ?? null }
  return items
}

// Log de un run (diagnóstico de runs que terminan vacíos)
export async function obtenerLogRun(runId) {
  const resp = await fetch(`${API_BASE}/actor-runs/${runId}/log`, { headers: cabeceras() })
  if (!resp.ok) throw new ApifyError(`Apify respondió ${resp.status} leyendo log del run ${runId}`, { status: resp.status })
  return resp.text()
}

// Costo real en USD de un run (para el medidor de costo por nicho). No-fatal.
export async function obtenerCostoRun(runId) {
  if (!runId) return 0
  try {
    const resp = await fetch(`${API_BASE}/actor-runs/${runId}`, { headers: cabeceras() })
    if (!resp.ok) return 0
    const { data } = await resp.json()
    return Number(data?.usageTotalUsd) || 0
  } catch {
    return 0
  }
}

// Modo async para runs largos (batches del nivel 2 en Fase 2): inicia el run y hace polling.
// Con `conMeta: true` devuelve { items, costoUsd }.
// Input del actor de detalle según su familia: sourabhbgp (actual) y ecomscrape
// (legado/rollback) reciben formatos distintos.
export function construirInputDetalle(actorId, urls, { domainCode = 'CL' } = {}) {
  if (String(actorId).includes('sourabhbgp')) {
    return {
      mode: 'product',
      country: domainCode,
      productUrls: urls,
      maxItems: 0,
      includeReviews: false,
      includeQuestions: true, // preguntas de compradores: objeciones reales para listing/análisis
      includeVariations: false,
      maxConcurrency: 8,
      useResidentialProxy: true,
    }
  }
  return {
    urls,
    max_retries_per_url: 2,
    ignore_url_failures: true,
    proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
  }
}

// Para la sonda debug: iniciar un run sin esperarlo (el proxy de Render corta
// respuestas largas) y consultar estado + items después con el runId.
export async function iniciarRun(actorId, input) {
  const resp = await fetch(`${API_BASE}/acts/${actorId}/runs`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify(input),
  })
  if (!resp.ok) {
    throw new ApifyError(
      `Apify respondió ${resp.status} al iniciar run de ${actorId}: ${await leerMensajeError(resp)}`,
      { status: resp.status, actorId },
    )
  }
  const { data: run } = await resp.json()
  return { runId: run.id }
}

export async function estadoRun(runId) {
  const resp = await fetch(`${API_BASE}/actor-runs/${runId}`, { headers: cabeceras() })
  if (!resp.ok) throw new ApifyError(`Apify respondió ${resp.status} consultando run ${runId}`, { status: resp.status })
  const { data } = await resp.json()
  const resultado = { estado: data.status, costoUsd: Number(data.usageTotalUsd) || 0, items: null }
  if (data.status === 'SUCCEEDED' && data.defaultDatasetId) {
    const items = await fetch(`${API_BASE}/datasets/${data.defaultDatasetId}/items?clean=true&format=json`, {
      headers: cabeceras(),
    })
    if (items.ok) resultado.items = await items.json()
  }
  return resultado
}

export async function ejecutarActorAsync(actorId, input, { pollMs = 10_000, timeoutMs = 15 * 60_000, conMeta = false } = {}) {
  const inicio = Date.now()
  const arranque = await fetch(`${API_BASE}/acts/${actorId}/runs`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify(input),
  })
  if (!arranque.ok) {
    throw new ApifyError(
      `Apify respondió ${arranque.status} al iniciar run de ${actorId}: ${await leerMensajeError(arranque)}`,
      { status: arranque.status, actorId },
    )
  }
  const { data: run } = await arranque.json()

  let estado = run.status
  let datasetId = run.defaultDatasetId
  let costoUsd = 0
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(estado)) {
    if (Date.now() - inicio > timeoutMs) {
      throw new ApifyError(`Run ${run.id} de ${actorId} superó ${Math.round(timeoutMs / 1000)}s`, { actorId })
    }
    await new Promise((resolver) => setTimeout(resolver, pollMs))
    const resp = await fetch(`${API_BASE}/actor-runs/${run.id}`, { headers: cabeceras() })
    if (!resp.ok) {
      throw new ApifyError(`Apify respondió ${resp.status} consultando run ${run.id}`, {
        status: resp.status,
        actorId,
      })
    }
    const { data } = await resp.json()
    estado = data.status
    datasetId = data.defaultDatasetId
    costoUsd = Number(data.usageTotalUsd) || costoUsd
  }
  if (estado !== 'SUCCEEDED') {
    throw new ApifyError(`Run ${run.id} de ${actorId} terminó en estado ${estado}`, { actorId })
  }

  const items = await fetch(`${API_BASE}/datasets/${datasetId}/items?clean=true&format=json`, {
    headers: cabeceras(),
  })
  if (!items.ok) {
    throw new ApifyError(`Apify respondió ${items.status} leyendo dataset ${datasetId}`, {
      status: items.status,
      actorId,
    })
  }
  const datos = await items.json()
  if (conMeta) return { items: datos, costoUsd }
  return datos
}

// Devuelve { items, costoUsd } para el medidor de costo por nicho.
export async function buscarNivel1(keyword, { domainCode = 'CL', maxPages = config.maxPagesBusqueda } = {}) {
  const country = URL_LISTADO_POR_DOMINIO[domainCode]
  if (!country) {
    throw new ApifyError(`domainCode "${domainCode}" sin URL de listado configurada (services/apify.js)`)
  }
  const { items, runId } = await ejecutarActorSync(
    config.actorSearch,
    { keyword, country, maxPages, promoted: false },
    { conMeta: true },
  )
  return { items, costoUsd: await obtenerCostoRun(runId) }
}
