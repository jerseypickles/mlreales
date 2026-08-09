import { sugerenciasReales, sinStopwords } from './busquedasReales.js'
import { TendenciaBusqueda } from '../models/TendenciaBusqueda.js'
import { diaChile } from './tendencias.js'

// Peso de búsqueda de una frase. El autocompletado de ML lista por volumen real
// dentro de cada prefijo, así que hay dos señales combinables:
//   1. QUÉ TAN CORTO es el prefijo con el que la frase ya aparece (una frase que
//      sale tecleando "pist" pesa mucho más que una que necesita "pistola ju")
//   2. su POSICIÓN dentro de esa lista
// Con eso se decide qué keyword va al arranque del título, en vez de suponer.

const normalizar = (t) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// consulta con respaldo en la serie diaria (el WAF de ML corta ráfagas)
async function sugerenciasConRespaldo(prefijo) {
  try {
    const s = await sugerenciasReales(prefijo, { limit: 10 })
    if (s.length) {
      await TendenciaBusqueda.updateOne(
        { prefijo, dia: diaChile() },
        { $set: { fecha: new Date(), sugerencias: s } },
        { upsert: true },
      ).catch(() => {})
      return s
    }
  } catch {
    /* cae al respaldo */
  }
  const guardada = await TendenciaBusqueda.findOne({ prefijo }).sort({ dia: -1 }).lean()
  return guardada?.sugerencias ?? []
}

// La frase y su variante sin stopwords son la MISMA búsqueda para ML: se
// comparan las dos contra cada lista y el prefijo se arma con la forma sin
// stopwords (el autocompletado responde a "arbol n", jamás a "arbol d").
export function variantesDe(frase) {
  const f = normalizar(frase)
  const sin = sinStopwords(f)
  return [...new Set([f, sin].filter(Boolean))]
}

// alto = aparece con el prefijo de su PRIMERA palabra; medio = necesita también
// la inicial de la segunda; nulo = ML no la sugiere (nadie la escribe así)
export async function medirPeso(frase, { pausaMs = 1200 } = {}) {
  const f = normalizar(frase)
  const variantes = variantesDe(f)
  // la forma sin stopwords manda para armar los prefijos y para reportar cómo
  // lo escribe la gente de verdad
  const base = variantes[variantes.length - 1]
  const palabras = base.split(' ')
  if (!palabras[0]) return { frase: f, peso: 'nulo', nivel: 0 }

  const prefijos = [palabras[0]]
  if (palabras.length > 1) prefijos.push(`${palabras[0]} ${palabras[1].slice(0, 1)}`)

  for (let i = 0; i < prefijos.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, pausaMs))
    const sugerencias = (await sugerenciasConRespaldo(prefijos[i])).map(normalizar)
    const comun = {
      frase: f,
      peso: i === 0 ? 'alto' : 'medio',
      nivel: i === 0 ? 3 : 2,
      prefijo: prefijos[i],
    }
    for (const v of variantes) {
      const posicion = sugerencias.indexOf(v)
      if (posicion !== -1) {
        return {
          ...comun,
          // cómo la escribe la gente cuando difiere de la keyword del nicho
          seEscribe: v === f ? undefined : v,
          posicion: posicion + 1,
          deCuantas: sugerencias.length,
        }
      }
    }
    // la frase puede existir como raíz de sugerencias más largas ("pistola
    // juguete balines"): eso es familia viva aunque la frase exacta no esté
    for (const v of variantes) {
      const derivadas = sugerencias.filter((s) => s.startsWith(`${v} `))
      if (derivadas.length) {
        return {
          ...comun,
          seEscribe: v === f ? undefined : v,
          posicion: null,
          derivadas: derivadas.slice(0, 4),
        }
      }
    }
  }
  return { frase: f, peso: 'nulo', nivel: 0, prefijo: prefijos[prefijos.length - 1] }
}

export async function medirPesos(frases, opciones) {
  const salida = []
  // las frases de 1 palabra se miden primero: suelen ser las puertas grandes
  const unicas = [...new Set((frases ?? []).map(normalizar))].filter(Boolean)
  unicas.sort((a, b) => a.split(' ').length - b.split(' ').length)
  for (const frase of unicas.slice(0, 16)) {
    salida.push(await medirPeso(frase, opciones))
  }
  return salida.sort((a, b) => b.nivel - a.nivel || (a.posicion ?? 99) - (b.posicion ?? 99))
}
