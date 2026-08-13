// LA FORMA DEL AÑO, MEDIDA.
//
// Hasta ahora la estacionalidad de un nicho salía de `radarInfo.estacionalidad`,
// que la escribe la IA de memoria: conocimiento general del mundo, no dato del
// mercado chileno. De ahí sale la ventana de compra — o sea que la fecha en que
// se gasta un contenedor venía de una inferencia.
//
// Google Trends entrega la silueta real de 5 años para Chile. NO entrega
// cantidad de búsquedas: los valores son un índice 0-100 relativo al máximo de
// esa misma palabra. Sirve para comparar diciembre contra julio del MISMO
// producto (que es lo que decide cuándo comprar) y JAMÁS para comparar un
// producto contra otro.
//
// Es un hecho que no cambia: se mide una vez por keyword y sirve meses. Por eso
// un bloqueo de Google no rompe nada — posterga. Sin fallback por proxy (el
// importador no quiere depender de Apify para esto): se reintenta otro día.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Google antepone ")]}'," a sus respuestas de API para que no se puedan
// incrustar como <script>. Hay que cortarlo antes de parsear.
export function parsearRespuestaGoogle(texto) {
  const i = String(texto ?? '').indexOf('{')
  if (i < 0) return null
  try {
    return JSON.parse(texto.slice(i))
  } catch {
    return null
  }
}

// timelineData viene semanal (5 años ≈ 260 puntos). Se promedia por mes
// calendario: la silueta anual es lo que importa, no la semana exacta.
export function curvaMensual(timelineData) {
  const acc = Array.from({ length: 12 }, () => [])
  for (const p of timelineData ?? []) {
    const ts = Number(p?.time)
    const valor = Array.isArray(p?.value) ? Number(p.value[0]) : NaN
    if (!Number.isFinite(ts) || !Number.isFinite(valor)) continue
    acc[new Date(ts * 1000).getUTCMonth()].push(valor)
  }
  if (acc.every((v) => !v.length)) return null
  return acc.map((v) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0))
}

// ¿Este producto es de temporada o se vende todo el año?
//
// El umbral es sobre pico/promedio y no sobre pico/valle: un producto puede
// tener un mes muerto por ruido y seguir siendo de venta pareja. 1.5 salió de
// mirar casos conocidos — brochas de maquillaje da 2.11 (tiene ola de regalo en
// diciembre aunque venda todo el año) y quitasol 2.79 (estacional puro).
export const RATIO_ESTACIONAL = 1.5

export function describirCurva(curva) {
  if (!Array.isArray(curva) || curva.length !== 12) return null
  const total = curva.reduce((a, b) => a + b, 0)
  if (!total) return null
  const promedio = total / 12
  let mesPico = 0
  for (let i = 1; i < 12; i++) if (curva[i] > curva[mesPico]) mesPico = i
  let mesValle = 0
  for (let i = 1; i < 12; i++) if (curva[i] < curva[mesValle]) mesValle = i
  const ratioPico = curva[mesPico] / promedio

  return {
    curva,
    // 1-12 para que calce con `ventana.js` y con la estacionalidad del radar
    mesPico: mesPico + 1,
    mesValle: mesValle + 1,
    nombreMesPico: MESES[mesPico],
    ratioPico: Math.round(ratioPico * 100) / 100,
    clasificacion: ratioPico >= RATIO_ESTACIONAL ? 'estacional' : 'todo-el-año',
    promedio: Math.round(promedio),
  }
}

// ¿En qué punto de su año está el nicho HOY? Es lo que se dibuja como "estás
// aquí" en la tarjeta y lo que permite leer un cero como valle en vez de muerte.
export function posicionEnElAno(curva, mes = new Date().getMonth() + 1) {
  const d = describirCurva(curva)
  if (!d) return null
  const valor = curva[mes - 1]
  const rel = d.promedio ? valor / d.promedio : 0
  return {
    mes,
    valor,
    relativoAlPromedio: Math.round(rel * 100) / 100,
    // "el mes que estás midiendo es el valle del año" es justo lo que evita
    // dictaminar "no vende" sobre un estacional fuera de temporada
    momento: rel >= 1.3 ? 'pico' : rel <= 0.7 ? 'valle' : 'normal',
  }
}

// EL JUEZ DEL RUIDO.
//
// El delta de reseñas × factor produce basura: 41 de 367 mediciones saltan 5x o
// más entre scans consecutivos (mochila porta bebé marcó 155.237/día). Trends
// no depende de reseñas ni de scrapers ni del factor, así que puede arbitrar:
// un salto brutal en un mes que la curva declara plano es artefacto, no demanda.
export const SALTO_SOSPECHOSO = 5

export function saltoEsCreible({ anterior, actual, curva, mesActual, mesAnterior }) {
  if (!Number.isFinite(anterior) || !Number.isFinite(actual) || anterior <= 0 || actual <= 0) return null
  const salto = Math.max(actual / anterior, anterior / actual)
  if (salto < SALTO_SOSPECHOSO) return { creible: true, salto: Math.round(salto * 10) / 10, motivo: 'salto normal' }
  if (!Array.isArray(curva) || curva.length !== 12) {
    return { creible: null, salto: Math.round(salto * 10) / 10, motivo: 'sin curva medida: no se puede juzgar' }
  }
  const a = curva[(mesAnterior ?? mesActual) - 1]
  const b = curva[mesActual - 1]
  const saltoEstacional = a > 0 ? Math.max(b / a, a / b) : 1
  // la estacionalidad explica saltos suaves, no de dos órdenes de magnitud:
  // se exige que la curva se mueva al menos la raíz del salto observado
  const creible = saltoEstacional >= Math.sqrt(salto)
  return {
    creible,
    salto: Math.round(salto * 10) / 10,
    saltoEstacional: Math.round(saltoEstacional * 10) / 10,
    motivo: creible
      ? 'la temporada lo explica'
      : 'la curva del año está plana en ese mes: artefacto de catálogo, no demanda',
  }
}

// ── Red ──────────────────────────────────────────────────────────────────────

async function pedir(url, cookie) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      'accept-language': 'es-CL,es;q=0.9',
      referer: 'https://trends.google.com/',
      ...(cookie ? { cookie } : {}),
    },
  })
  return { status: res.status, texto: await res.text() }
}

// Google devuelve 429 a la primera consulta sin cookie de sesión. Se pide una
// página cualquiera para que emita el NID y se reusa en las dos llamadas.
async function cookieDeSesion() {
  const res = await fetch('https://trends.google.com/trends/explore?geo=CL', {
    signal: AbortSignal.timeout(20_000),
    headers: { 'user-agent': UA, 'accept-language': 'es-CL,es;q=0.9' },
  }).catch(() => null)
  const set = res?.headers?.getSetCookie?.() ?? []
  return set.map((c) => c.split(';')[0]).join('; ') || null
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

// Curva anual de una keyword en Chile. Devuelve null si Google no respondió —
// el llamador NO debe inventar: marca "sin curva" y reintenta otro día.
export async function curvaAnual(keyword, { geo = 'CL', anos = 5, esperaMs = 4000 } = {}) {
  const cookie = await cookieDeSesion()
  const req = {
    comparisonItem: [{ keyword, geo, time: `today ${anos}-y` }],
    category: 0,
    property: '',
  }
  const explore = await pedir(
    `https://trends.google.com/trends/api/explore?hl=es&tz=240&req=${encodeURIComponent(JSON.stringify(req))}`,
    cookie,
  )
  const datos = parsearRespuestaGoogle(explore.texto)
  const widget = (datos?.widgets ?? []).find((w) => w.id === 'TIMESERIES')
  if (!widget?.token) return null

  await dormir(esperaMs) // sin esto Google responde 429 a la segunda llamada
  const serie = await pedir(
    `https://trends.google.com/trends/api/widgetdata/multiline?hl=es&tz=240&req=${encodeURIComponent(
      JSON.stringify(widget.request),
    )}&token=${encodeURIComponent(widget.token)}`,
    cookie,
  )
  const curva = curvaMensual(parsearRespuestaGoogle(serie.texto)?.default?.timelineData)
  if (!curva) return null

  const d = describirCurva(curva)
  return d ? { keyword, geo, anos, ...d, medidoEl: new Date() } : null
}
