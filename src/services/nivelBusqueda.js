import { sugerenciasReales, sinStopwords, normalizarTexto } from './busquedasReales.js'

// ¿ALGUIEN BUSCA ESTO? La pieza que faltaba en el embudo.
//
// El sistema medía OFERTA (cuántos listings, a qué precio, quién vende) y
// DEMANDA INFERIDA (delta de reseñas del top), pero nunca preguntó si la gente
// escribe esa búsqueda. Sin ese filtro, el radar abre nichos con keywords que
// suenan bien y no existen, se pagan scans y análisis, y salen con veredicto de
// entrada sobre un listado que ningún comprador ve (9-ago: 65 de 78 "entrar").
//
// PERO no alcanza con preguntar por la frase literal. Medido en vivo:
//
//   "set snorkel"  →  prefijo "set":     set herramientas, set mancuernas…
//                     prefijo "snorkel": snorkel, snorkel buceo, snorkel nino,
//                                        snorkel natacion, snorkel mascara…
//
// El producto se busca muchísimo; lo que está mal es la KEYWORD. Por eso se
// consulta cada palabra significativa —no solo la primera— y se distingue:
//
//   · la keyword existe          → alto / medio / bajo según su posición
//   · la keyword no, la familia sí → RENOMBRAR, con la búsqueda real propuesta
//   · ni la keyword ni la familia  → nulo, ahí sí no hay nada
//
// La fuente es el autocompletado de ML (la misma que usa el auditor de
// títulos): $0, sin Apify ni LLM. El orden de sus sugerencias ES el dato —
// lista por volumen real de búsquedas dentro de cada prefijo.

const CIMA = 3 // posiciones que consideramos "cabeza de familia"
const MAX_PALABRAS = 4 // techo de consultas por nicho

const normalizar = (t) => normalizarTexto(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Las palabras por las que vale la pena preguntar. Las de menos de 3 letras no
// son prefijo útil del autocompletado.
export function palabrasDeBusqueda(keyword) {
  return sinStopwords(normalizar(keyword))
    .split(' ')
    .filter((p) => p.length >= 3)
    .slice(0, MAX_PALABRAS)
}

// La frase y su variante sin stopwords son la MISMA búsqueda para ML:
// "arbol de navidad" no existe, "arbol navidad" es #1 de su prefijo.
export function variantesDe(keyword) {
  const f = normalizar(keyword)
  return [...new Set([f, sinStopwords(f)].filter(Boolean))]
}

// Una palabra es CABEZA de búsqueda cuando el autocompletado la devuelve a
// ella misma de primera: es una búsqueda por derecho propio ("snorkel", "ipl",
// "foco"), no un modificador que nadie teclea solo ("set", "casera").
export const esCabeza = (palabra, sugerencias) => sugerencias?.[0] === palabra

// ---- núcleo puro: dado lo que respondió ML, qué significa ----
// listas: Map<palabra consultada, sugerencias[]>
export function analizarFamilia(keyword, listas) {
  const f = normalizar(keyword)
  const variantes = variantesDe(f)
  const palabras = palabrasDeBusqueda(f)

  let exacta = null
  const cabezas = []
  const mismaIntencion = [] // sugerencias que contienen TODAS las palabras del nicho
  const candidatas = [] // posibles keywords de reemplazo

  for (const [prefijo, lista] of listas) {
    if (!lista?.length) continue
    const cabeza = esCabeza(prefijo, lista)
    if (cabeza) cabezas.push(prefijo)

    lista.forEach((s, i) => {
      const posicion = i + 1
      if (!exacta && variantes.includes(s)) {
        exacta = {
          prefijo,
          posicion,
          deCuantas: lista.length,
          seEscribe: s === f ? null : s,
        }
        return
      }
      const cuantas = palabras.filter((w) => s.includes(w)).length
      if (!cuantas) return
      if (cuantas === palabras.length) mismaIntencion.push({ q: s, prefijo, posicion })
      // solo proponemos reemplazos que salgan de una palabra que la gente SÍ
      // teclea: las sugerencias de "casera" son mayonesa y tortas, no depiladoras
      if (cabeza) candidatas.push({ q: s, prefijo, posicion, palabras: cuantas })
    })
  }

  // mejor candidata: la que cubre más palabras del nicho, más arriba en su
  // lista, y a igualdad la más específica
  candidatas.sort(
    (a, b) => b.palabras - a.palabras || a.posicion - b.posicion || b.q.length - a.q.length,
  )
  const vistas = new Set()
  const propuestas = candidatas.filter((c) => !vistas.has(c.q) && vistas.add(c.q)).slice(0, 5)

  if (exacta) {
    const nivel = exacta.posicion <= CIMA ? 'alto' : 'medio'
    return {
      nivel,
      puntaje: nivel === 'alto' ? 4 : 3,
      ...exacta,
      familia: mismaIntencion.length || undefined,
    }
  }

  // la frase exacta no existe. ¿Existe el PRODUCTO?
  if (mismaIntencion.length || propuestas.length) {
    const mejor = propuestas[0] ?? mismaIntencion[0]
    return {
      nivel: 'renombrar',
      puntaje: 2,
      prefijo: mejor.prefijo,
      keywordSugerida: mejor.q,
      posicionSugerida: mejor.posicion,
      alternativas: propuestas.map((c) => c.q),
      cabezas,
    }
  }

  return { nivel: 'nulo', puntaje: 0, cabezas, alternativas: [] }
}

// Frase corta para la UI y para los prompts.
export function explicar(n) {
  if (!n) return null
  if (n.nivel === 'nulo') return 'Nadie busca esta keyword ni nada parecido en ML: no hay producto que medir.'
  if (n.nivel === 'renombrar') {
    const otras = n.alternativas?.length > 1 ? ` (también: ${n.alternativas.slice(1, 4).join(' · ')})` : ''
    return `Esta keyword no se busca, pero el producto SÍ: la gente escribe "${n.keywordSugerida}"${n.posicionSugerida ? ` (#${n.posicionSugerida} de su prefijo)` : ''}${otras}. Conviene medir esa.`
  }
  const como = n.seEscribe ? ` (la gente escribe "${n.seEscribe}")` : ''
  return `#${n.posicion} de ${n.deCuantas} en "${n.prefijo}"${como}`
}

// ---- medición contra el autocompletado ----
export async function medirNivelBusqueda(keyword, { pausaMs = 1300 } = {}) {
  const palabras = palabrasDeBusqueda(keyword)
  if (!palabras.length) return { nivel: 'nulo', puntaje: 0, medidoEl: new Date() }

  const listas = new Map()
  let bloqueadas = 0
  for (const [i, p] of palabras.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, pausaMs))
    try {
      listas.set(p, await sugerenciasReales(p, { limit: 10 }))
    } catch {
      bloqueadas++
    }
  }
  // sin una sola respuesta no se puede afirmar nada: mejor sin medición que
  // con un "nadie la busca" que en realidad fue un 403
  if (!listas.size) throw new Error(`autocompletado sin respuesta para "${keyword}" (${bloqueadas} consultas bloqueadas)`)

  return {
    ...analizarFamilia(keyword, listas),
    consultadas: [...listas.keys()],
    bloqueadas: bloqueadas || undefined,
    medidoEl: new Date(),
  }
}

// Pasada en batch sobre los nichos sin medir o con medición vencida. Gratis:
// solo autocompletado. La pausa entre consultas es obligatoria — el WAF de ML
// corta las ráfagas (por eso también el respaldo en la serie de tendencias).
export async function medirNichosPendientes({ dias = 14, max = 40, pausaMs = 1300, forzar = false } = {}) {
  const { Nicho } = await import('../models/Nicho.js')
  const corte = new Date(Date.now() - dias * 86400e3)
  // forzar: re-mide todo aunque la medición esté fresca (cambió el medidor, o
  // el importador renombró keywords y quiere el tablero al día)
  const vencidos = { $or: [{ nivelBusqueda: null }, { 'nivelBusqueda.medidoEl': { $lt: corte } }] }
  const pendientes = await Nicho.find(forzar ? {} : vencidos)
    .select('keyword')
    // 'activo' < 'pausado': los que siguen gastando scans se miden primero
    .sort({ estado: 1, creadoEl: -1 })
    .limit(max)
    .lean()

  if (!pendientes.length) return { medidos: 0, porNivel: {}, pendientes: 0 }

  const porNivel = {}
  let medidos = 0
  let fallidos = 0
  for (const [i, nicho] of pendientes.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, pausaMs))
    try {
      const nivelBusqueda = await medirNivelBusqueda(nicho.keyword, { pausaMs })
      await Nicho.updateOne({ _id: nicho._id }, { $set: { nivelBusqueda } })
      porNivel[nivelBusqueda.nivel] = (porNivel[nivelBusqueda.nivel] ?? 0) + 1
      medidos++
      if (nivelBusqueda.nivel === 'renombrar') {
        console.log(
          `[nivel-busqueda] "${nicho.keyword}": la keyword no se busca, el producto SÍ → "${nivelBusqueda.keywordSugerida}"`,
        )
      } else if (nivelBusqueda.nivel === 'nulo') {
        console.log(`[nivel-busqueda] "${nicho.keyword}": NADIE busca esto ni nada parecido`)
      }
    } catch (err) {
      // el autosuggest bloqueado no puede botar la pasada: ese nicho se
      // reintenta en la próxima (queda sin medición, no con una falsa)
      fallidos++
      console.warn(`[nivel-busqueda] "${nicho.keyword}" no se pudo medir: ${err.message}`)
    }
  }

  return { medidos, fallidos, porNivel, pendientes: await Nicho.countDocuments(vencidos) }
}
