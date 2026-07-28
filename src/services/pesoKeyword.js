import { sugerenciasReales } from './busquedasReales.js'
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

// alto = aparece con el prefijo de su PRIMERA palabra; medio = necesita también
// la inicial de la segunda; nulo = ML no la sugiere (nadie la escribe así)
export async function medirPeso(frase, { pausaMs = 1200 } = {}) {
  const f = normalizar(frase)
  const palabras = f.split(' ')
  if (!palabras[0]) return { frase: f, peso: 'nulo', nivel: 0 }

  const prefijos = [palabras[0]]
  if (palabras.length > 1) prefijos.push(`${palabras[0]} ${palabras[1].slice(0, 1)}`)

  for (let i = 0; i < prefijos.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, pausaMs))
    const sugerencias = (await sugerenciasConRespaldo(prefijos[i])).map(normalizar)
    const posicion = sugerencias.indexOf(f)
    if (posicion !== -1) {
      return {
        frase: f,
        peso: i === 0 ? 'alto' : 'medio',
        nivel: i === 0 ? 3 : 2,
        prefijo: prefijos[i],
        posicion: posicion + 1,
        deCuantas: sugerencias.length,
      }
    }
    // la frase puede existir como raíz de sugerencias más largas ("pistola
    // juguete balines"): eso es familia viva aunque la frase exacta no esté
    const derivadas = sugerencias.filter((s) => s.startsWith(`${f} `))
    if (derivadas.length) {
      return {
        frase: f,
        peso: i === 0 ? 'alto' : 'medio',
        nivel: i === 0 ? 3 : 2,
        prefijo: prefijos[i],
        posicion: null,
        derivadas: derivadas.slice(0, 4),
      }
    }
  }
  return { frase: f, peso: 'nulo', nivel: 0, prefijo: prefijos[prefijos.length - 1] }
}

export async function medirPesos(frases, opciones) {
  const salida = []
  for (const frase of [...new Set((frases ?? []).map(normalizar))].filter(Boolean).slice(0, 12)) {
    salida.push(await medirPeso(frase, opciones))
  }
  return salida.sort((a, b) => b.nivel - a.nivel || (a.posicion ?? 99) - (b.posicion ?? 99))
}
