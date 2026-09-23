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

// ¿Este producto es de temporada, o se vende todo el año con un bulto?
//
// TRES bandas, no dos. El corte binario en 1.5 marcaba 46 de 71 nichos como
// "estacional" —el 65% del tablero con chip de urgencia— y ponía etiquetas
// opuestas a curvas idénticas: toallitas húmedas (1,50) decía "último mes para
// pedir" y freidora de aire (1,48) decía "todo el año", con siluetas casi
// iguales. El importador lo cazó mirando el minigráfico contra la etiqueta.
//
// Los cortes salen de mirar las 71 curvas medidas: sobre 2,0 la silueta tiene
// forma de verdad (quitasol █▅▂▁▁▁▁▁▁▂▃▅, árbol ▁▁▁▁▁▁▁▁▂▃█▇); entre 1,3 y 2,0
// es plana con un bulto (toallitas ▇▅▆▅▆▆▆▆▆█▅▅); bajo 1,3 es plana.
//
// Solo la banda alta abre ventana de compra: en un producto de venta pareja no
// existe "el último mes para pedir", y decirlo es mentir.
export const RATIO_ESTACIONAL = 2.0
export const RATIO_ALZA_SUAVE = 1.3

export function clasificarPorRatio(ratio) {
  if (ratio >= RATIO_ESTACIONAL) return 'estacional'
  if (ratio >= RATIO_ALZA_SUAVE) return 'alza-suave'
  return 'todo-el-año'
}

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
    clasificacion: clasificarPorRatio(ratioPico),
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

// LOS PERÍODOS DEL AÑO: QUÉ MESES SUBEN, CUÁNTO, SI SE REPITE Y POR QUÉ.
//
// El ratio pico/promedio decía "todo el año" a la calculadora científica, que
// marzo-abril se busca 4 veces más que diciembre-febrero, los 4 años medidos:
// como mayo y junio también son altos, el pico "no destacaba" del promedio. El
// importador lo cazó mirando el minigráfico: "tú y yo sabemos que esto va cuando
// los estudiantes vuelven a clases". Y la freidora salta en junio todos los
// años, que no es una estación sino el CyberDay.
//
// Cada mes se compara con la mediana de los 12 meses que lo rodean (así el
// mercado que crece o cae no ensucia la forma), y un mes es fuerte si sube 30%
// y eso se REPITE en la mayoría de los años: un salto de un solo año es ruido.
// Los meses fuertes seguidos forman un período, y el período se explica con el
// calendario chileno. Lo que no calza con nada se dice: "pico sin explicar".
export const UMBRAL_PERIODO = 1.3
export const UMBRAL_VALLE = 0.7
const NOMBRE_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// meses (1-12) en que la gente COMPRA para cada evento. En empate gana el que
// va primero en la lista.
export const EVENTOS_DEL_ANIO = [
  // en Chile la lista escolar se compra en enero-febrero y la universidad
  // arranca en marzo
  { id: 'vuelta-a-clases', nombre: 'vuelta a clases', meses: [1, 2, 3], palabras: /escolar|colegio|[uú]tiles|lonchera|estuche|cotona|delantal|mochila|cuaderno|calculadora/i },
  // universidad e institutos: marzo a mayo. Solo explica tramos largos que
  // arrancan en marzo; un pico suelto de abril (arco y flecha, collar) queda
  // sin explicar antes que rotularlo mal
  { id: 'ano-academico', nombre: 'inicio del año académico', meses: [3, 4, 5], empieza: [3], minMeses: 2, palabras: /calculadora|delantal|universi|notebook|escritorio/i },
  { id: 'navidad', nombre: 'Navidad', meses: [11, 12], palabras: /navidad|navide|pesebre|regalo|árbol|arbol/i },
  { id: 'verano', nombre: 'verano', meses: [12, 1, 2], palabras: /playa|piscina|camping|carpa|flotador|quitasol|toldo|ventilador|enfriador|aire acondicionado|climatizador|inflable|snorkel|agua|traje de ba|sombrilla|hamaca|verano|solar|bloqueador|cooler|kayak|reposera|silla playa/i },
  { id: 'cyberday', nombre: 'CyberDay', meses: [6] },
  // en Chile el CyberMonday cae en octubre o noviembre
  { id: 'black-friday', nombre: 'CyberMonday y Black Friday', meses: [10, 11] },
  { id: 'invierno', nombre: 'invierno', meses: [5, 6, 7, 8], palabras: /estufa|calefa|frazada|t[eé]rmic|parka|chaleco|guante|bufanda|paraguas|deshumid|polar|invierno/i },
  { id: 'fiestas-patrias', nombre: 'Fiestas Patrias', meses: [9], palabras: /parrilla|asado|carb[oó]n|volant|huaso|cueca/i },
  // DE REGALO: un mes que coincide no prueba la causa (un frutero que sube en
  // agosto no es "Día del niño"). Van al final y se dicen "coincide con"
  { id: 'dia-de-la-madre', nombre: 'Día de la madre', meses: [5], regalo: true },
  { id: 'dia-del-padre', nombre: 'Día del padre', meses: [6], regalo: true },
  { id: 'dia-del-nino', nombre: 'Día del niño', meses: [8], regalo: true },
  { id: 'san-valentin', nombre: 'San Valentín', meses: [2], regalo: true },
  { id: 'halloween', nombre: 'Halloween', meses: [10], regalo: true },
]

const medianaDe = (xs) => { const s = [...xs].sort((a, b) => a - b); return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 }

// Se explica por los meses MÁS FUERTES del período, no por el primero: la
// mochila escolar sube de diciembre a marzo, pero su bulto es enero-febrero, y
// explicarla por diciembre la rotulaba "verano".
// Con los meses solos hay casos que no se pueden separar: enero-febrero es a la
// vez verano y vuelta a clases (la cocinilla de camping salía "vuelta a
// clases"). Si la keyword del nicho da la pista, manda; si no, y dos eventos
// calzan parecido, se dicen los dos en vez de elegir a ciegas.
function explicar(tramo, keyword = '') {
  const peso = tramo.reduce((a, m) => a + m.indice, 0)
  const candidatos = []
  for (const e of EVENTOS_DEL_ANIO) {
    if (e.empieza && !e.empieza.includes(tramo[0].mes)) continue
    if (e.minMeses && tramo.length < e.minMeses) continue
    const puntaje = tramo.filter((m) => e.meses.includes(m.mes)).reduce((a, m) => a + m.indice, 0) / peso
    if (puntaje >= 0.34) candidatos.push({ e, puntaje })
  }
  if (!candidatos.length) return null
  const mejor = Math.max(...candidatos.map((c) => c.puntaje))
  // cerca del mejor; los de regalo solo compiten si no hay otra explicación
  let cerca = candidatos.filter((c) => c.puntaje >= mejor - 0.2)
  if (cerca.some((c) => !c.e.regalo)) cerca = cerca.filter((c) => !c.e.regalo)
  const porPalabra = cerca.filter((c) => c.e.palabras?.test(keyword))
  const elegidos = porPalabra.length ? porPalabra.slice(0, 1) : cerca.sort((a, b) => b.puntaje - a.puntaje).slice(0, 2)
  const [uno, dos] = elegidos
  if (uno.e.regalo) return { id: uno.e.id, nombre: `coincide con ${uno.e.nombre}`, certeza: 'coincide' }
  if (porPalabra.length) return { id: uno.e.id, nombre: uno.e.nombre, certeza: 'calendario-y-producto' }
  if (dos && dos.puntaje >= uno.puntaje - 0.2) return { id: uno.e.id, nombre: `${uno.e.nombre} o ${dos.e.nombre}`, certeza: 'ambiguo', alternativa: dos.e.id }
  return { id: uno.e.id, nombre: uno.e.nombre, certeza: 'calendario' }
}

// Pura. serieMensual: [{periodo:'AAAA-MM', valor}] (la de Google Ads, 48 meses).
export function periodosDelAnio(serieMensual, { keyword = '' } = {}) {
  const serie = (serieMensual ?? []).filter((m) => /^\d{4}-\d{2}$/.test(m?.periodo) && Number.isFinite(m.valor)).sort((a, b) => a.periodo.localeCompare(b.periodo))
  if (serie.length < 24) return null
  const porMes = Array.from({ length: 12 }, () => [])
  for (let i = 6; i + 5 < serie.length; i++) {
    const ventana = serie.slice(i - 6, i + 6).map((m) => m.valor)
    const med = medianaDe(ventana)
    if (!(med > 0)) continue
    porMes[Number(serie[i].periodo.slice(5)) - 1].push(serie[i].valor / med)
  }
  if (porMes.some((xs) => !xs.length)) return null
  const meses = porMes.map((xs, i) => ({
    mes: i + 1,
    indice: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 100) / 100,
    altos: xs.filter((x) => x >= UMBRAL_PERIODO).length,
    bajos: xs.filter((x) => x <= UMBRAL_VALLE).length,
    anios: xs.length,
  }))
  const esAlto = (m) => m.indice >= UMBRAL_PERIODO && m.altos / m.anios >= 0.6
  const esBajo = (m) => m.indice <= UMBRAL_VALLE && m.bajos / m.anios >= 0.6
  // tramos seguidos, dando la vuelta al año (dic→ene)
  const tramos = (cumple) => {
    const marcados = meses.map(cumple)
    if (marcados.every(Boolean)) return []
    const inicio = marcados.findIndex((x) => !x)
    const salida = []
    let actual = []
    for (let k = 1; k <= 12; k++) {
      const i = (inicio + k) % 12
      if (marcados[i]) actual.push(meses[i])
      else if (actual.length) { salida.push(actual); actual = [] }
    }
    if (actual.length) salida.push(actual)
    return salida
  }
  const total = meses.reduce((a, m) => a + m.indice, 0)
  const aPeriodo = (t) => {
    const ms = t.map((m) => m.mes)
    return {
      meses: ms,
      texto: ms.length === 1 ? NOMBRE_MES[ms[0] - 1] : `${NOMBRE_MES[ms[0] - 1]}-${NOMBRE_MES[ms.at(-1) - 1]}`,
      multiplicador: Math.round(t.reduce((a, m) => a + m.indice, 0) / t.length * 10) / 10,
      // de cuántos años medidos, en cuántos se repitió (el mes más débil del tramo)
      repite: Math.min(...t.map((m) => m.altos ?? m.bajos)),
      anios: Math.min(...t.map((m) => m.anios)),
      participacionPct: Math.round(t.reduce((a, m) => a + m.indice, 0) / total * 100),
    }
  }
  const picos = tramos(esAlto).map((t) => ({ ...aPeriodo(t), porque: explicar(t, keyword) }))
    .sort((a, b) => b.multiplicador - a.multiplicador)
  const valles = tramos(esBajo).map((t) => { const p = aPeriodo(t); return { ...p, repite: Math.min(...t.map((m) => m.bajos)) } })
  const indices = meses.map((m) => m.indice)
  return {
    picos, valles, meses,
    // mes más fuerte contra el más flojo: la calculadora ~4×, la freidora ~1,5×
    amplitud: Math.round(Math.max(...indices) / Math.max(0.01, Math.min(...indices)) * 10) / 10,
  }
}
