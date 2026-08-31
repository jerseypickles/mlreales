import { describirCurva } from './estacionalidad.js'
import { config } from '../config/env.js'

// CUÁNTA GENTE BUSCA ESTO, en números absolutos.
//
// Google Ads (vía DataForSEO) entrega el volumen mensual real por país más el
// desglose de los últimos 12 meses. Reemplaza a Google Trends como fuente
// primaria por tres razones que se verificaron en vivo el 12-ago-2026:
//
// 1. Es ABSOLUTO, no un índice normalizado a sí mismo. Trends solo permite
//    comparar diciembre contra julio del MISMO producto; esto permite comparar
//    productos entre sí — árbol de navidad son 74.000 búsquedas/mes y quitasol
//    playa 5.400, algo que con Trends era invisible.
// 2. Trends MIENTE en volúmenes bajos. "fuente agua gato" (480 búsquedas/mes)
//    daba ratio 4,8 en Trends y 1,18 acá: con pocas búsquedas la serie semanal
//    de Trends se llena de ceros y cualquier semana con actividad se convierte
//    en un pico falso. Donde hay volumen las dos fuentes coinciden.
// 3. No se bloquea: 50 keywords en UNA llamada por US$0,09, sin cookies ni
//    proxies ni endpoints internos que Google pueda cambiar sin avisar.
//
// El precio es por request y NO por keyword: pedir 1 cuesta lo mismo que pedir
// 1.000, así que siempre se pide en lote.

const URL = 'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live'
// TODAS LAS VARIANTES DE UNA KEYWORD, CON SU VOLUMEN.
//
// `search_volume` responde "cuánto se busca ESTO" para una lista que uno ya
// tiene. `keywords_for_keywords` responde la pregunta que faltaba: "qué más
// busca la gente alrededor de esto". Es lo que hoy sacamos de las tendencias de
// ML, que publica unas 20 por categoría y no siempre las que importan.
//
// El caso que lo justifica, medido el 30-ago-2026: "cooler portatil" tiene 480
// búsquedas al mes y "cooler" tiene 27.100. Ese hallazgo salió de que ML
// casualmente listaba "cooler" en sus tendencias. Con este endpoint no depende
// de la casualidad.
const URL_RELACIONADAS = 'https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live'

// Chile. Se verificó contra el endpoint de locations: {location_code: 2152,
// country_iso_code: 'CL', location_type: 'Country'}
export const CHILE = 2152

export function hayCredenciales() {
  return Boolean(config.dataForSeoLogin && config.dataForSeoPassword)
}

// monthly_searches viene como lista de {year, month, search_volume} de los
// últimos 12 meses. Se ordena a calendario enero-diciembre; si un mes aparece
// más de una vez (la ventana móvil puede solaparse) se promedia.
export function curvaDeMonthlySearches(monthlySearches) {
  const porMes = new Map()
  for (const m of monthlySearches ?? []) {
    const mes = Number(m?.month)
    const v = Number(m?.search_volume)
    if (!Number.isInteger(mes) || mes < 1 || mes > 12 || !Number.isFinite(v)) continue
    if (!porMes.has(mes)) porMes.set(mes, [])
    porMes.get(mes).push(v)
  }
  if (!porMes.size) return null
  return Array.from({ length: 12 }, (_, i) => {
    const v = porMes.get(i + 1)
    return v ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0
  })
}

// Un resultado crudo de DataForSEO → lo que guardamos. Pura: testeable sin red.
export function interpretar(resultado) {
  const curva = curvaDeMonthlySearches(resultado?.monthly_searches)
  const forma = curva ? describirCurva(curva) : null
  if (!forma) return null
  return {
    keyword: resultado.keyword,
    fuente: 'google-ads',
    ...forma,
    // lo que Trends nunca pudo dar: el tamaño, comparable entre keywords
    busquedasMes: Number.isFinite(resultado.search_volume) ? resultado.search_volume : null,
    // intensidad publicitaria de la palabra en Google (no es el CPC de ML, pero
    // dice si el término está peleado por anunciantes)
    competenciaAds: resultado.competition ?? null,
    competenciaIndice: Number.isFinite(resultado.competition_index) ? resultado.competition_index : null,
    cpcUsd: Number.isFinite(resultado.cpc) ? resultado.cpc : null,
    medidoEl: new Date(),
  }
}

// Volumen de MUCHAS keywords en una sola llamada. Devuelve Map<keyword, dato>.
// Nunca lanza por keyword sin dato: simplemente no aparece en el Map.
export async function volumenMensual(keywords, { locationCode = CHILE, languageCode = 'es' } = {}) {
  const lista = [...new Set((keywords ?? []).filter(Boolean))]
  if (!lista.length || !hayCredenciales()) return new Map()

  const auth = Buffer.from(`${config.dataForSeoLogin}:${config.dataForSeoPassword}`).toString('base64')
  const salida = new Map()

  // el tope de la API es 1000 keywords por request
  for (let i = 0; i < lista.length; i += 1000) {
    const lote = lista.slice(i, i + 1000)
    const res = await fetch(URL, {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify([
        { keywords: lote, location_code: locationCode, language_code: languageCode, search_partners: false },
      ]),
    })
    if (!res.ok) throw new Error(`DataForSEO respondió ${res.status}`)
    const datos = await res.json()
    if (datos?.status_code !== 20000) {
      throw new Error(`DataForSEO: ${datos?.status_message ?? 'respuesta inesperada'}`)
    }
    for (const t of datos.tasks ?? []) {
      for (const r of t.result ?? []) {
        const dato = interpretar(r)
        if (dato) salida.set(dato.keyword, dato)
      }
    }
  }
  return salida
}

// Las keywords que Google asocia a una semilla, con su volumen. Devuelve el
// mismo shape que `volumenMensual` para que el resto no distinga la fuente.
//
// OJO CON EL COSTO Y LA TASA, que son distintos a los de `search_volume`:
// la doc de DataForSEO dice "12 requests per minute per account for Google Ads
// Live endpoints" y "accounts are charged for every request regardless of the
// number of keywords returned". O sea que acá NO aplica el truco del lote: una
// semilla es una llamada y una llamada es un cobro. Por eso quien llama debe
// pedirlo solo cuando lo necesita, no para cada nicho de la mesa.
//
// `limit` NO es un parámetro válido de este endpoint —los válidos son keywords,
// location, language, search_partners, sort_by, keywords_negative y fechas—, así
// que el recorte se hace acá.
//
// Nunca rompe: esto ENRIQUECE la elección de keyword, no la sostiene. Si la API
// no responde, el cruce sigue funcionando con las tendencias de ML.
export async function relacionadasDe(semilla, { locationCode = CHILE, languageCode = 'es', limite = 40 } = {}) {
  if (!semilla || !hayCredenciales()) return []
  const auth = Buffer.from(`${config.dataForSeoLogin}:${config.dataForSeoPassword}`).toString('base64')
  try {
    const res = await fetch(URL_RELACIONADAS, {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify([
        {
          keywords: [semilla],
          location_code: locationCode,
          language_code: languageCode,
          search_partners: false,
          // ordena por volumen y no por relevancia, que es el default: lo que
          // buscamos es la variante MÁS BUSCADA, no la más parecida
          sort_by: 'search_volume',
        },
      ]),
    })
    if (!res.ok) return []
    const datos = await res.json()
    if (datos?.status_code !== 20000) return []
    const salida = []
    for (const t of datos.tasks ?? []) {
      for (const r of t.result ?? []) {
        const dato = interpretar(r)
        if (dato && Number.isFinite(dato.busquedasMes)) salida.push(dato)
      }
    }
    return salida.sort((a, b) => b.busquedasMes - a.busquedasMes).slice(0, limite)
  } catch (err) {
    console.warn(`[volumen] relacionadas de "${semilla}": ${err.message}`)
    return []
  }
}
