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

// Cuatro años atrás, que es lo más lejos que acepta `date_from` en
// google_ads/search_volume. Google no entrega el mes en curso.
export function desde4Anos(hoy = new Date()) {
  const d = new Date(hoy)
  d.setFullYear(d.getFullYear() - 4)
  return d.toISOString().slice(0, 10)
}

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

// ¿ESTE PRODUCTO ESTÁ VIVO O SE ESTÁ MURIENDO?
//
// La pregunta del importador, textual: "no voy a traer un producto que está
// muerto en búsquedas". Y hasta ahora el sistema no la podía contestar.
//
// `curvaDeMonthlySearches` recibe los meses de VARIOS AÑOS y los promedia en
// una forma de 12: eso deja bien la estacionalidad y TIRA la tendencia. Con una
// sola curva de 12 valores no se puede separar "baja porque es su temporada
// baja" de "baja porque el producto se está muriendo".
//
// Comparando los últimos 12 meses contra los 12 anteriores la estacionalidad se
// cancela sola —cada mes se compara con el mismo mes del año anterior— y lo que
// queda es la tendencia real.
//
// Hace falta pedir `date_from` de hace 4 años: sin eso Google devuelve solo 12
// meses y no hay con qué comparar.
export function variacionInteranual(monthlySearches) {
  const filas = (monthlySearches ?? [])
    .filter((m) => Number.isFinite(m?.search_volume) && Number.isInteger(m?.year) && Number.isInteger(m?.month))
    .sort((a, b) => a.year - b.year || a.month - b.month)
  if (filas.length < 24) return null

  const ultimos = filas.slice(-12)
  const previos = filas.slice(-24, -12)
  const suma = (xs) => xs.reduce((a, m) => a + m.search_volume, 0)
  const anterior = suma(previos)
  if (!anterior) return null
  const actual = suma(ultimos)
  return {
    pct: Math.round(((actual - anterior) / anterior) * 1000) / 10,
    ultimos12: actual,
    previos12: anterior,
    mesesUsados: filas.length,
  }
}

// Pura. El veredicto en una palabra. Los cortes son anchos a propósito: el
// volumen de Google viene en baldes y un ±10% puede ser el mismo balde visto
// dos veces, no un mercado que se mueve.
//
// LA CAÍDA SOLA NO CONDENA UN NICHO, Y LA PRIMERA VERSIÓN SÍ LO HACÍA.
//
// Lo corrigió el importador: "está bien que cayó un 34% pero aún queda espacio
// para ganar dinero, tampoco seamos tan pesimistas". Tiene razón y los números
// lo respaldan: "audifonos bluetooth" cayó 34% y le quedan 27.100 búsquedas al
// mes —de los mercados más grandes de la mesa— mientras "maquina coser" está
// estable con 1.000. El grande que se achica sigue siendo más grande que el
// chico que no se mueve.
//
// Lo que sí es un problema es la COMBINACIÓN: un mercado ya chico que además se
// está yendo. Ahí el stock que traes llega a un mercado más chico todavía.
// Medido el 31-ago-2026: scooter infantil 260 búsquedas y -33%, carpa camping
// 1.300 y -24%.
const VOLUMEN_CHICO = 3000

export function saludDelNicho(variacion, { busquedasMes = null } = {}) {
  if (!variacion) return null
  const p = variacion.pct
  const chico = Number.isFinite(busquedasMes) && busquedasMes < VOLUMEN_CHICO
  // "muriendo" queda para el que se va Y ya era chico: es el único caso donde
  // la tendencia por sí sola cambia la decisión de comprar
  if (p <= -20 && chico) return 'muriendo'
  if (p <= -10) return 'bajando'
  if (p >= 30) return 'despegando'
  if (p >= 10) return 'subiendo'
  return 'estable'
}

// Un resultado crudo de DataForSEO → lo que guardamos. Pura: testeable sin red.
export function interpretar(resultado) {
  const curva = curvaDeMonthlySearches(resultado?.monthly_searches)
  const forma = curva ? describirCurva(curva) : null
  if (!forma) return null
  const variacion = variacionInteranual(resultado?.monthly_searches)
  return {
    keyword: resultado.keyword,
    fuente: 'google-ads',
    ...forma,
    // últimos 12 meses contra los 12 anteriores: la estacionalidad se cancela y
    // queda la tendencia. null cuando Google devolvió menos de 24 meses.
    variacionInteranualPct: variacion?.pct ?? null,
    salud: saludDelNicho(variacion, { busquedasMes: resultado?.search_volume }),
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
        {
          keywords: lote,
          location_code: locationCode,
          language_code: languageCode,
          search_partners: false,
          // sin esto Google devuelve 12 meses y no hay con qué comparar año
          // contra año. El mínimo que acepta son 4 años hacia atrás.
          date_from: desde4Anos(),
        },
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
