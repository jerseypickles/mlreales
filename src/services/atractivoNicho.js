import { volumenMensual, CHILE } from './volumenBusqueda.js'
import { candidatasMecanicas, elegirCorreccion } from './correccionKeyword.js'
import { palabrasClave, normalizarTexto } from './busquedasReales.js'
import { config } from '../config/env.js'

// ¿VALE LA PENA ABRIR ESTE NICHO?
//
// El radar proponía con el contexto del negocio y el autocompletado de ML, pero
// sin ver ni el tamaño ni la dirección del mercado. Lanzaba nichos correctos
// sobre tendencias poco atractivas, y cada uno cuesta scans de Apify y análisis
// de IA durante semanas antes de que se note.
//
// Acá se mide ANTES de gastar: volumen absoluto en Chile y crecimiento de los
// últimos años. Ambos de Google, así que miden el PAÍS y no Mercado Libre — por
// eso no vetan solos. El "¿alguien lo busca en ML?" lo sigue contestando el
// autocompletado (services/nivelBusqueda.js), que es la fuente correcta para
// eso. Acá se responde otra cosa: si ese mercado es grande y hacia dónde va.

const URL_TRENDS = 'https://api.dataforseo.com/v3/keywords_data/google_trends/explore/live'

// Bajo esto no hay nicho que valga un contenedor, ni creciendo. No es un veto
// por gusto: es el piso donde el volumen deja de sostener una compra.
export const VOLUMEN_MINIMO = 200

// LA FAMILIA, NO LA FRASE MÁS LARGA.
//
// Google Ads mide frases exactas, y una específica puede ser cola larga aunque
// su familia mueva miles. Medido el 13-ago: "lampara de uñas uv" da 50
// búsquedas y "lampara uv" 1.600; "scooter niño" no tiene dato y "scooter"
// tiene 18.100. Juzgar el nicho por la variante más específica lo mata.
//
// Se prueban los prefijos progresivos (quitando calificativos por la derecha) y
// se conserva el mayor volumen encontrado, dejando anotado con qué frase salió.
// UN SOLO calificativo de menos, no todos. Trepar hasta la raíz cambia de
// mercado: "lampara de uñas uv" llegaba a "lampara" (27.100 búsquedas, que
// incluye lámparas de techo y de auto) y "beauty blender" a "beauty", que ni
// siquiera es un producto. Con un salto se recupera la familia real —
// "lampara de uñas" 1.300, "pestañas postizas" 8.100— sin cambiar de rubro.
export function prefijosProgresivos(keyword, { saltos = 1 } = {}) {
  const palabras = String(keyword ?? '').trim().split(/\s+/).filter(Boolean)
  if (!palabras.length) return []
  const salida = []
  for (let n = palabras.length; n >= Math.max(1, palabras.length - saltos); n--) {
    salida.push(palabras.slice(0, n).join(' '))
  }
  return salida
}

// Crecimiento del último año completo contra el promedio de los anteriores.
export const CRECE_PCT = 15
export const CAE_PCT = -15

export function clasificarCrecimiento(pct) {
  if (!Number.isFinite(pct)) return 'sin-medir'
  if (pct >= CRECE_PCT) return 'crece'
  if (pct <= CAE_PCT) return 'cae'
  return 'estable'
}

// Promedios por año móvil desde agosto, descartando períodos incompletos: sin
// eso, el año en curso arrastra el resultado hacia su estación actual (medido:
// árbol de navidad aparecía cayendo 87% porque el tramo parcial era su valle).
export function crecimientoDeSerie(puntos, { hoy = new Date() } = {}) {
  const porPeriodo = new Map()
  for (const p of puntos ?? []) {
    const f = p?.date_from ? new Date(p.date_from) : null
    const v = Array.isArray(p?.values) ? Number(p.values[0]) : NaN
    if (!f || !Number.isFinite(v)) continue
    const periodo = f.getUTCMonth() >= 7 ? f.getUTCFullYear() : f.getUTCFullYear() - 1
    if (!porPeriodo.has(periodo)) porPeriodo.set(periodo, [])
    porPeriodo.get(periodo).push({ f, v })
  }
  const completos = [...porPeriodo.entries()]
    .filter(([, ps]) => {
      const fechas = ps.map((x) => x.f)
      return (Math.max(...fechas) - Math.min(...fechas)) / 86400e3 >= 320
    })
    .sort((a, b) => a[0] - b[0])
  if (completos.length < 3) return null

  const promedios = completos.map(([periodo, ps]) => ({
    periodo,
    valor: Math.round((ps.reduce((a, b) => a + b.v, 0) / ps.length) * 10) / 10,
  }))
  const ultimo = promedios.at(-1).valor
  const previos = promedios.slice(0, -1)
  const base = previos.reduce((a, b) => a + b.valor, 0) / previos.length
  if (!base) return null
  const pct = Math.round(((ultimo - base) / base) * 100)
  return { serie: promedios, ultimo, base: Math.round(base * 10) / 10, pct, clasificacion: clasificarCrecimiento(pct) }
}

// CÓMO SE LLAMA LA COSA DE VERDAD.
//
// La corrección mecánica repara la escritura pero no descubre el nombre: para
// "scooter niño" probó todas las preposiciones y Google no reporta ninguna —
// la palabra que existe es "scooter infantil" (260) y el mercado real es
// "scooter electrico" (60.500). Eso es un SINÓNIMO, y la corrección mecánica se
// niega a aplicarlos a propósito porque cambiar el sustantivo puede cambiar de
// producto ("rizador" → "ondulador").
//
// Acá se DESCUBREN y se reportan, nunca se aplican solos: el radar los muestra
// con su volumen para que decida quien mira.
const URL_IDEAS = 'https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live'

export function filtrarVariantes(keyword, resultados, { max = 4 } = {}) {
  const claves = palabrasClave(keyword)
  if (!claves.size) return []
  return (resultados ?? [])
    .filter((r) => {
      if (!Number.isFinite(r?.search_volume) || r.search_volume <= 0) return false
      if (normalizarTexto(r.keyword) === normalizarTexto(keyword)) return false
      // debe compartir al menos una palabra de contenido: si no, es otro rubro
      const c = palabrasClave(r.keyword)
      return [...claves].some((p) => c.has(p))
    })
    .sort((a, b) => b.search_volume - a.search_volume)
    .slice(0, max)
    .map((r) => ({ keyword: r.keyword, volumen: r.search_volume, competencia: r.competition ?? null }))
}

async function variantesReales(keyword, { locationCode = CHILE, limite = 60 } = {}) {
  const auth = Buffer.from(`${config.dataForSeoLogin}:${config.dataForSeoPassword}`).toString('base64')
  const res = await fetch(URL_IDEAS, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify([
      { keywords: [keyword], location_code: locationCode, language_code: 'es', sort_by: 'search_volume', limit: limite },
    ]),
  })
  if (!res.ok) return []
  const datos = await res.json()
  const tarea = datos?.tasks?.[0]
  if (tarea?.status_code !== 20000) return []
  return filtrarVariantes(keyword, tarea.result ?? [])
}

async function serieTrends(keyword, { locationCode = CHILE, desde = '2021-08-01' } = {}) {
  const auth = Buffer.from(`${config.dataForSeoLogin}:${config.dataForSeoPassword}`).toString('base64')
  const res = await fetch(URL_TRENDS, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    // UNA keyword por consulta a propósito: Google normaliza las comparaciones
    // entre sí, y en un lote la más chica se aplasta a 1 y pierde su tendencia
    body: JSON.stringify([
      { keywords: [keyword], location_code: locationCode, language_code: 'es', date_from: desde, type: 'web' },
    ]),
  })
  if (!res.ok) return null
  const datos = await res.json()
  const tarea = datos?.tasks?.[0]
  if (tarea?.status_code !== 20000) return null
  for (const r of tarea.result ?? []) {
    for (const it of r.items ?? []) {
      if (it.type === 'google_trends_graph') return it.data ?? null
    }
  }
  return null
}

// Mide una tanda de candidatas: volumen en UNA llamada (el precio es por
// request, no por keyword) y crecimiento en una consulta por candidata, solo
// para las que pasaron el piso de volumen.
export async function medirAtractivo(keywords, { conCrecimiento = true } = {}) {
  const lista = [...new Set((keywords ?? []).filter(Boolean))]
  if (!lista.length) return []

  // se mide la forma BIEN ESCRITA ("rizador pelo" 50 vs "rizador de pelo"
  // 1.900) y también los PREFIJOS, porque una frase específica puede ser cola
  // larga de una familia grande ("scooter niño" sin dato, "scooter" 18.100)
  const candidatas = [...new Set(lista.flatMap((k) => [...candidatasMecanicas(k), ...prefijosProgresivos(k)]))]
  const volumenes = await volumenMensual(candidatas)

  const salida = []
  for (const kw of lista) {
    const vols = new Map(candidatasMecanicas(kw).map((c) => [c, volumenes.get(c)?.busquedasMes ?? 0]))
    const correccion = elegirCorreccion(kw, vols)
    const exacta = correccion?.keyword ?? kw
    const datoExacto = volumenes.get(exacta)

    // OJO: `null` es "Google no tiene dato", NO "nadie la busca". Confundirlos
    // descartó nichos vivos — "scooter niño" salió con 0 y su familia mueve
    // 18.100. Solo cuenta como cero medido lo que Google reporta como 0.
    const volumenExacto = Number.isFinite(datoExacto?.busquedasMes) ? datoExacto.busquedasMes : null

    // la familia: el mayor volumen entre los prefijos, para no matar un nicho
    // por su variante más específica
    let familia = null
    for (const p of prefijosProgresivos(exacta)) {
      const v = volumenes.get(p)?.busquedasMes
      if (Number.isFinite(v) && (!familia || v > familia.volumen)) familia = { keyword: p, volumen: v }
    }

    const volumen = Math.max(volumenExacto ?? 0, familia?.volumen ?? 0)
    const dato = datoExacto ?? (familia ? volumenes.get(familia.keyword) : null)
    const fila = {
      keyword: kw,
      keywordMedida: exacta !== kw ? exacta : null,
      volumen,
      volumenExacto,
      // de qué frase salió el volumen que manda: si es la familia y no la
      // keyword, el nicho hay que abrirlo apuntando ahí
      volumenDeFamilia: familia && familia.volumen > (volumenExacto ?? 0) ? familia.keyword : null,
      sinDatoExacto: volumenExacto == null,
      // familia MUCHO mayor que la frase = probablemente otro mercado más
      // amplio, no el nicho propuesto. Se muestra, no se descarta: decide quien
      // mira, con el número a la vista.
      // El volumen no describe el producto propuesto cuando: (a) la familia es
      // desproporcionada frente a la frase, o (b) la frase no tiene NINGÚN dato
      // y todo el volumen viene prestado del prefijo. Medido: "scooter niño" no
      // existe y "scooter" son 18.100 — que en Chile son MOTOS, otro producto.
      familiaSospechosa:
        familia &&
        (volumenExacto == null
          ? familia.keyword !== exacta
          : familia.volumen > volumenExacto * 20)
          ? true
          : undefined,
      competenciaAds: dato?.competenciaAds ?? null,
      estacionalidad: dato?.clasificacion ?? null,
      mesPico: dato?.nombreMesPico ?? null,
      suficiente: volumen >= VOLUMEN_MINIMO,
    }
    // sin dato exacto o bajo el piso: preguntar CÓMO SE LLAMA de verdad antes
    // de descartar. Se reportan como sugerencia, jamás se aplican solas.
    if (fila.sinDatoExacto || !fila.suficiente) {
      // si la semilla está muerta, Google tampoco genera ideas a partir de
      // ella (medido: "scooter niño" no expande nada). Se reintenta desde la
      // FAMILIA, que sí tiene vida, y el filtro sigue exigiendo que la variante
      // comparta una palabra con la keyword original.
      let variantes = await variantesReales(exacta).catch(() => [])
      if (!variantes.length && familia && familia.keyword !== exacta) {
        const crudas = await variantesReales(familia.keyword).catch(() => [])
        variantes = crudas.filter((v) => {
          const c = palabrasClave(v.keyword)
          return [...palabrasClave(exacta)].some((w) => c.has(w))
        })
      }
      if (variantes.length) {
        fila.variantes = variantes
        const mejor = variantes[0]
        if (mejor.volumen > fila.volumen) {
          fila.sugerenciaKeyword = mejor.keyword
          fila.volumenSugerido = mejor.volumen
          // el radar se queda con el chilenismo en vez de redescubrirlo
          import('./aprendizajes.js')
            .then((m) => m.registrarTerminoChileno({
              propuesto: exacta, real: mejor.keyword,
              volumenPropuesto: volumenExacto ?? 0, volumenReal: mejor.volumen,
            }))
            .catch(() => {})
          // el atractivo se juzga con lo que existe de verdad, dejando dicho
          // que el nicho hay que abrirlo con OTRA frase
          fila.volumen = mejor.volumen
          fila.suficiente = mejor.volumen >= VOLUMEN_MINIMO
        }
      }
    }

    if (conCrecimiento && fila.suficiente) {
      const puntos = await serieTrends(fila.sugerenciaKeyword ?? fila.volumenDeFamilia ?? exacta).catch(() => null)
      const c = puntos ? crecimientoDeSerie(puntos) : null
      fila.crecimientoPct = c?.pct ?? null
      fila.crecimiento = c?.clasificacion ?? 'sin-medir'
      fila.serieAnual = c?.serie ?? null
    } else {
      fila.crecimiento = fila.suficiente ? 'sin-medir' : 'no-aplica'
    }
    salida.push(fila)
  }
  return salida.sort((a, b) => puntaje(b) - puntaje(a))
}

// Orden de atractivo: el tamaño manda, la dirección desempata. Un nicho que
// crece 40% sobre 50 búsquedas sigue siendo 70 búsquedas; uno grande que cae
// todavía se puede trabajar, pero de último.
export function puntaje(f) {
  if (!f?.suficiente) return -1
  const base = Math.log10(1 + (f.volumen ?? 0))
  const factor = f.crecimiento === 'crece' ? 1.35 : f.crecimiento === 'cae' ? 0.65 : 1
  return base * factor
}
