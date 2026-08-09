// Autocompletado público de Mercado Libre: refleja lo que los compradores
// escriben de verdad, ordenado por volumen real de búsquedas. El radar lo usa
// para no crear nichos con keywords que nadie escribe (un nicho así mide un
// listado que ningún comprador ve).

import { fetchResidencial } from './proxyApify.js'

const SITE_POR_DOMINIO = { CL: 'MLC' }

// palabras que no cambian la búsqueda ("freidora de aire" ≡ "freidora aire")
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'para', 'con', 'y', 'o', 'en'])

export function normalizarTexto(texto) {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// raíz simple para empatar singular/plural: "focos"→"foco", "solares"→"solar",
// "fuentes"→"fuente". No es un stemmer completo; alcanza para comparar keywords.
function raiz(palabra) {
  if (palabra.length > 4 && /[rlndzj]es$/.test(palabra)) return palabra.slice(0, -2)
  if (palabra.length > 3 && palabra.endsWith('s')) return palabra.slice(0, -1)
  return palabra
}

export function palabrasClave(texto) {
  return new Set(
    normalizarTexto(texto)
      .split(' ')
      .filter((p) => p && !STOPWORDS.has(p))
      .map(raiz),
  )
}

// La misma frase sin stopwords y EN ORDEN (sin pasar por la raíz): el
// autocompletado indexa "arbol navidad", nunca "arbol de navidad" — comparar
// contra la forma literal devolvía "nadie la busca" para keywords que son #1
// de su prefijo (medido el 9-ago sobre el tablero: árbol de navidad, freidora
// de aire, gafas de sol, cama para perro, organizador de zapatos…).
export function sinStopwords(texto) {
  return normalizarTexto(texto)
    .split(' ')
    .filter((p) => p && !STOPWORDS.has(p))
    .join(' ')
}

function setsIguales(a, b) {
  return a.size === b.size && [...a].every((p) => b.has(p))
}

export async function sugerenciasReales(query, { domainCode = 'CL', limit = 6 } = {}) {
  const site = SITE_POR_DOMINIO[domainCode]
  if (!site) {
    throw new Error(`domainCode "${domainCode}" sin site de autosuggest configurado (services/busquedasReales.js)`)
  }
  const url = `https://http2.mlstatic.com/resources/sites/${site}/autosuggest?showFilters=true&limit=${limit}&api_version=2&q=${encodeURIComponent(query)}`
  // headers del XHR real del sitio: el WAF puntúa UA+IP y un UA de bot declarado
  // baja la tasa de éxito incluso desde IP residencial
  const opciones = () => ({
    signal: AbortSignal.timeout(10_000),
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      accept: 'application/json, text/plain, */*',
      'accept-language': 'es-CL,es;q=0.9',
      referer: 'https://www.mercadolibre.cl/',
      origin: 'https://www.mercadolibre.cl',
    },
  })
  let res = await fetch(url, opciones())
  // ML bloquea IPs de datacenter (403 sostenido desde Render): reintentar la
  // misma consulta saliendo por el proxy residencial de Apify si está configurado
  if (res.status === 403) {
    const conProxy = await fetchResidencial(url, opciones()).catch((err) => {
      console.error(`[autosuggest] proxy residencial no disponible: ${err.message}`)
      return null
    })
    if (conProxy) res = conProxy
  }
  if (!res.ok) throw new Error(`autosuggest respondió ${res.status} para "${query}"`)
  const datos = await res.json()
  return (datos.suggested_queries ?? []).map((s) => normalizarTexto(s.q)).filter(Boolean)
}

// Parecido entre la keyword ideada y una búsqueda real: Jaccard sobre raíces
// de palabras significativas. Pura para poder testearla sin red.
export function elegirMejorSugerencia(candidata, sugerencias) {
  const objetivo = palabrasClave(candidata)
  let mejor = null
  for (const s of sugerencias) {
    const palabras = palabrasClave(s)
    const interseccion = [...objetivo].filter((p) => palabras.has(p)).length
    const union = new Set([...objetivo, ...palabras]).size
    const puntaje = union ? interseccion / union : 0
    if (!mejor || puntaje > mejor.puntaje) mejor = { keyword: s, puntaje }
  }
  return mejor
}

export const UMBRAL_PARECIDO = 0.5

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

// Convierte una keyword ideada por el LLM en la búsqueda real más parecida.
// El autosuggest es por prefijo, así que se consulta del término completo hacia
// prefijos más cortos, con pausa entre consultas (el endpoint devuelve 403 ante
// ráfagas). Devuelve null SOLO si todas las consultas respondieron y nadie
// busca nada parecido; si hubo consultas bloqueadas y no se encontró match,
// lanza error para que el llamador no descarte una keyword por un falso negativo.
export async function keywordReal(candidata, { domainCode = 'CL', pausaMs = 1100 } = {}) {
  const normalizada = normalizarTexto(candidata)
  const claves = palabrasClave(normalizada)
  const palabras = normalizada.split(' ')
  const vistas = new Set()
  let respuestas = 0
  let fallidas = 0

  for (let n = palabras.length; n >= 1; n--) {
    const query = palabras.slice(0, n).join(' ')
    if (respuestas + fallidas > 0) await esperar(pausaMs)
    let sugerencias
    try {
      sugerencias = await sugerenciasReales(query, { domainCode })
    } catch {
      fallidas++
      continue
    }
    respuestas++
    for (const s of sugerencias) vistas.add(s)
    // equivalencia por raíces: "foco solares" empata con "focos solares" y se
    // conserva la forma de la candidata (no hay renombre que valga la pena)
    if (sugerencias.some((s) => setsIguales(palabrasClave(s), claves))) {
      return { keyword: normalizada, exacta: true, puntaje: 1 }
    }
  }

  const mejor = elegirMejorSugerencia(normalizada, [...vistas])
  if (mejor && mejor.puntaje >= UMBRAL_PARECIDO) {
    return { keyword: mejor.keyword, exacta: false, puntaje: mejor.puntaje }
  }
  if (fallidas > 0) throw new Error(`autosuggest no confirmó "${candidata}" (${fallidas} consultas bloqueadas)`)
  return null
}
