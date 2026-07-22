import crypto from 'node:crypto'
import { config } from '../config/env.js'
import { MeliCuenta } from '../models/MeliCuenta.js'

// API oficial de Mercado Libre con la cuenta del propio vendedor. El scraper
// mira la calle (competencia); esto abre la puerta de la casa: órdenes reales,
// visitas y stock — y de paso sondea qué endpoints públicos responde el token
// para decidir qué partes del scraper se pueden jubilar.

const AUTH_BASE = 'https://auth.mercadolibre.cl/authorization'
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'
const API_BASE = 'https://api.mercadolibre.com'

// PKCE: state → verifier, efímero en memoria (Render corre 1 instancia; si el
// deploy pilla un login a medias, se reintenta la conexión y ya)
const pendientes = new Map()

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function meliConfigurado() {
  return Boolean(config.meliAppId && config.meliAppSecret && config.meliRedirectUri)
}

export function urlAutorizacion() {
  const state = b64url(crypto.randomBytes(24))
  const verifier = b64url(crypto.randomBytes(48))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  for (const [s, p] of pendientes) if (Date.now() - p.creadoEl > 15 * 60e3) pendientes.delete(s)
  pendientes.set(state, { verifier, creadoEl: Date.now() })
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.meliAppId,
    redirect_uri: config.meliRedirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  return `${AUTH_BASE}?${params.toString()}`
}

async function pedirToken(body) {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  })
  const datos = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(`oauth/token ${resp.status}: ${datos.message ?? datos.error_description ?? datos.error ?? 'sin detalle'}`)
  }
  return datos
}

async function guardarTokens(datos) {
  const expiraEl = new Date(Date.now() + (datos.expires_in ?? 21600) * 1000)
  return MeliCuenta.findOneAndUpdate(
    { userId: String(datos.user_id) },
    {
      $set: {
        accessToken: datos.access_token,
        refreshToken: datos.refresh_token,
        expiraEl,
        scopes: datos.scope ?? null,
        actualizadoEl: new Date(),
      },
      $setOnInsert: { conectadoEl: new Date() },
    },
    { upsert: true, new: true },
  )
}

export async function canjearCodigo({ code, state }) {
  const pendiente = pendientes.get(state)
  if (!pendiente) throw new Error('state desconocido o vencido (¿deploy en el medio?): reintentar la conexión')
  pendientes.delete(state)
  const datos = await pedirToken({
    grant_type: 'authorization_code',
    client_id: config.meliAppId,
    client_secret: config.meliAppSecret,
    code,
    redirect_uri: config.meliRedirectUri,
    code_verifier: pendiente.verifier,
  })
  const cuenta = await guardarTokens(datos)
  try {
    const me = await meliGet('/users/me')
    cuenta.nickname = me.nickname ?? null
    await cuenta.save()
  } catch {
    /* el nickname es cosmético: la conexión ya quedó */
  }
  return cuenta
}

async function refrescar(cuenta) {
  const datos = await pedirToken({
    grant_type: 'refresh_token',
    client_id: config.meliAppId,
    client_secret: config.meliAppSecret,
    refresh_token: cuenta.refreshToken,
  })
  return guardarTokens(datos)
}

async function cuentaConTokenFresco() {
  let cuenta = await MeliCuenta.findOne()
  if (!cuenta) throw new Error('sin cuenta de Mercado Libre conectada')
  if (!cuenta.expiraEl || cuenta.expiraEl.getTime() - Date.now() < 5 * 60e3) {
    cuenta = await refrescar(cuenta)
  }
  return cuenta
}

export async function meliGet(ruta) {
  let cuenta = await cuentaConTokenFresco()
  const pedir = (token) =>
    fetch(`${API_BASE}${ruta}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  let resp = await pedir(cuenta.accessToken)
  if (resp.status === 401) {
    cuenta = await refrescar(cuenta)
    resp = await pedir(cuenta.accessToken)
  }
  const datos = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(`${ruta} → ${resp.status}: ${datos.message ?? datos.error ?? 'sin detalle'}`)
  return datos
}

export async function estadoMeli() {
  const cuenta = await MeliCuenta.findOne().lean()
  if (!cuenta) return { conectado: false, configurado: meliConfigurado() }
  return {
    conectado: true,
    configurado: true,
    userId: cuenta.userId,
    nickname: cuenta.nickname,
    conectadoEl: cuenta.conectadoEl,
    expiraEl: cuenta.expiraEl,
  }
}

export async function hayCuentaMeli() {
  return Boolean(await MeliCuenta.exists({}))
}

// Agregado de /reviews/item/:id — paging.total es el conteo exacto de reseñas
// (verificado en vivo 22-jul con MLC2678282136: 49). rating_average tolerante:
// si ML no lo manda, el rating queda null y el snapshot conserva el previo.
export function resumenReviewsOficiales(datos) {
  const total = datos?.paging?.total
  if (!Number.isFinite(total)) return null
  const rating = Number.isFinite(datos?.rating_average) ? datos.rating_average : null
  return { numReviews: total, rating }
}

// Conteo de reseñas por la API oficial: las reseñas viven a nivel catálogo y
// este endpoint SÍ las entrega donde el actor no ve nada (páginas /up/).
// Nunca rompe un scan: sin cuenta conectada, id desconocido o 403 → null.
export async function reviewsOficialesSeguro(sku) {
  try {
    if (!(await MeliCuenta.exists({}))) return null
    return resumenReviewsOficiales(await meliGet(`/reviews/item/${sku}`))
  } catch (err) {
    console.warn(`[meli] reviews de ${sku} no disponibles: ${err.message}`)
    return null
  }
}

// Detalle oficial de un item PROPIO: precio, stock (available_quantity),
// vendidos reales (sold_quantity — exacto para el dueño, a diferencia del
// "+10.000" público), estado y título. Solo abre para items del vendedor
// conectado; para ajenos ML responde 403 (sonda 22-jul). Nunca rompe: null.
export async function itemOficialSeguro(idMl) {
  try {
    if (!(await MeliCuenta.exists({}))) return null
    return await meliGet(`/items/${idMl}`)
  } catch (err) {
    console.warn(`[meli] item ${idMl} no disponible: ${err.message}`)
    return null
  }
}

// Visitas del item en los últimos N días. Schema tolerante (total_visits no
// está validado contra output en vivo — si no calza, el warn lo dirá).
export async function visitasSeguro(idMl, dias = 7) {
  try {
    if (!(await MeliCuenta.exists({}))) return null
    const datos = await meliGet(`/items/${idMl}/visits/time_window?last=${dias}&unit=day`)
    return Number.isFinite(datos?.total_visits) ? datos.total_visits : null
  } catch (err) {
    console.warn(`[meli] visitas de ${idMl} no disponibles: ${err.message}`)
    return null
  }
}

// Precio para ganar la caja de compra de un item de catálogo (price_to_win
// v2). Schema tolerante y muestra al log en formas inesperadas — el output
// real no está validado en vivo aún: el primer scan lo dirá.
export async function precioParaGanarSeguro(idMl) {
  try {
    if (!(await MeliCuenta.exists({}))) return null
    const datos = await meliGet(`/items/${idMl}/price_to_win?version=v2`)
    const numero = (v) => (Number.isFinite(v) ? v : Number.isFinite(v?.amount) ? v.amount : null)
    const r = {
      estado: typeof datos?.status === 'string' ? datos.status : null,
      precioParaGanar: numero(datos?.price_to_win),
      precioActual: numero(datos?.current_price),
    }
    if (r.estado === null && r.precioParaGanar === null) {
      console.warn(
        `[meli] price_to_win de ${idMl} con forma inesperada — muestra: ${JSON.stringify(datos).slice(0, 300)}`,
      )
      return null
    }
    return r
  } catch (err) {
    console.warn(`[meli] price_to_win de ${idMl} no disponible: ${err.message}`)
    return null
  }
}

// Sonda post-conexión: deja en el LOG qué puertas abre el token (propias y
// públicas) — la decisión de qué migrar del scraper sale de estos resultados,
// jamás de suponer schemas (regla del proyecto).
export async function sondearApi() {
  const me = await meliGet('/users/me')
  console.log(`[meli] conectado como ${me.nickname} (${me.id}), site ${me.site_id}`)
  const pruebas = [
    ['mis-items', `/users/${me.id}/items/search?limit=5`],
    ['orders', `/orders/search?seller=${me.id}&sort=date_desc&limit=1`],
    ['item-publico', '/items/MLC2678282136'],
    ['opiniones-publicas', '/reviews/item/MLC2678282136'],
    ['search-publica', '/sites/MLC/search?q=gua%20sha&limit=3'],
  ]
  for (const [nombre, ruta] of pruebas) {
    try {
      const r = await meliGet(ruta)
      console.log(`[meli] sonda ${nombre}: OK — ${JSON.stringify(r).slice(0, 260)}`)
    } catch (err) {
      console.warn(`[meli] sonda ${nombre}: ${err.message}`)
    }
  }
  return { sondeado: true }
}
