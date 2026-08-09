import { medirPeso } from './pesoKeyword.js'
import { sugerenciasReales } from './busquedasReales.js'

// ¿ALGUIEN BUSCA ESTO? La pieza que faltaba en el embudo.
//
// El sistema medía OFERTA (cuántos listings, a qué precio, quién vende) y
// DEMANDA INFERIDA (delta de reseñas del top), pero nunca preguntó si la gente
// escribe esa búsqueda. Sin ese filtro, el radar abre nichos con keywords que
// suenan bien y no existen ("cascada solar jardin fuente", "disfraz fiestas
// patrias niño"), se pagan scans y análisis, y salen con veredicto de entrada
// sobre un listado que ningún comprador ve. Medido el 9-ago sobre el tablero:
// 65 de 78 nichos decían "entrar".
//
// La fuente es el autocompletado de ML (mismo que ya usa el auditor de
// títulos): $0, sin Apify ni LLM. El orden de sus sugerencias ES el dato —
// lista por volumen real de búsquedas dentro de cada prefijo.

const CIMA = 3 // posiciones que consideramos "cabeza de familia"

// Pura: traduce la medición cruda de pesoKeyword al nivel que ordena el tablero.
export function clasificarPeso(medicion) {
  if (!medicion || medicion.peso === 'nulo') return { nivel: 'nulo', puntaje: 0 }
  // 'medio' del medidor = la frase solo asoma tecleando dos palabras: cola larga
  if (medicion.peso === 'medio') return { nivel: 'bajo', puntaje: 1 }
  // 'alto' = aparece con el prefijo de su primera palabra; la posición decide
  // si encabeza la familia o vive al fondo de la lista
  if (Number.isFinite(medicion.posicion)) {
    return medicion.posicion <= CIMA ? { nivel: 'alto', puntaje: 3 } : { nivel: 'medio', puntaje: 2 }
  }
  // sin posición propia pero con derivadas: la frase es raíz viva de búsquedas
  // más largas ("rascador gato" → "rascador gato sillon")
  return { nivel: 'medio', puntaje: 2 }
}

// Frase corta para la UI y para los prompts: por qué este nicho tiene (o no)
// nivel de búsqueda.
export function explicar(n) {
  if (!n) return null
  const como = n.seEscribe ? ` (la gente escribe "${n.seEscribe}")` : ''
  if (n.nivel === 'nulo') {
    const alt = n.alternativas?.length ? ` Con "${n.prefijo}" se busca: ${n.alternativas.slice(0, 3).join(' · ')}.` : ''
    return `Nadie escribe esta búsqueda en ML.${alt}`
  }
  if (n.posicion) {
    return `#${n.posicion} de ${n.deCuantas} en "${n.prefijo}"${como}`
  }
  if (n.derivadas?.length) {
    return `raíz viva de: ${n.derivadas.slice(0, 3).join(' · ')}${como}`
  }
  return `aparece bajo "${n.prefijo}"${como}`
}

// Mide una keyword y devuelve el documento que se guarda en el nicho.
export async function medirNivelBusqueda(keyword, opciones = {}) {
  const medicion = await medirPeso(keyword, opciones)
  const { nivel, puntaje } = clasificarPeso(medicion)

  const nivelBusqueda = {
    nivel,
    puntaje,
    peso: medicion.peso,
    prefijo: medicion.prefijo ?? null,
    posicion: medicion.posicion ?? null,
    deCuantas: medicion.deCuantas ?? null,
    seEscribe: medicion.seEscribe ?? null,
    derivadas: medicion.derivadas ?? null,
    medidoEl: new Date(),
  }

  // sin volumen, lo accionable es SABER QUÉ SÍ SE BUSCA con ese prefijo: es la
  // keyword de reemplazo que el importador puede medir en vez de esta
  if (nivel === 'nulo' && medicion.prefijo) {
    nivelBusqueda.alternativas = await sugerenciasReales(medicion.prefijo, { limit: 6 }).catch(() => [])
  }
  return nivelBusqueda
}

// Pasada en batch sobre los nichos sin medir o con medición vencida. Gratis:
// solo autocompletado. La pausa entre consultas es obligatoria — el WAF de ML
// corta las ráfagas (por eso también el respaldo en la serie de tendencias).
export async function medirNichosPendientes({ dias = 14, max = 40, pausaMs = 1300 } = {}) {
  const { Nicho } = await import('../models/Nicho.js')
  const corte = new Date(Date.now() - dias * 86400e3)
  const pendientes = await Nicho.find({
    $or: [{ nivelBusqueda: null }, { 'nivelBusqueda.medidoEl': { $lt: corte } }],
  })
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
      if (nivelBusqueda.nivel === 'nulo') {
        console.log(
          `[nivel-busqueda] "${nicho.keyword}": NADIE la busca — con "${nivelBusqueda.prefijo}" se busca ${JSON.stringify(nivelBusqueda.alternativas?.slice(0, 3) ?? [])}`,
        )
      }
    } catch (err) {
      // el autosuggest bloqueado no puede botar la pasada: ese nicho se
      // reintenta en la próxima (queda sin medición, no con una falsa)
      fallidos++
      console.warn(`[nivel-busqueda] "${nicho.keyword}" no se pudo medir: ${err.message}`)
    }
  }

  const restantes = await Nicho.countDocuments({
    $or: [{ nivelBusqueda: null }, { 'nivelBusqueda.medidoEl': { $lt: corte } }],
  })
  return { medidos, fallidos, porNivel, pendientes: restantes }
}
