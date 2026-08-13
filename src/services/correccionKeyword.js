import { palabrasClave, normalizarTexto } from './busquedasReales.js'

// LA MISMA FRASE, BIEN ESCRITA.
//
// Las keywords del tablero nacieron comprimidas: "rizador pelo" en vez de
// "rizador de pelo", "pastillas freno" en vez de "pastillas de freno". La
// preposición que se cayó se llevó el mercado — medido en Google Chile,
// "rizador pelo" son 50 búsquedas/mes y "rizador de pelo" 1.900.
//
// Renombrar el nicho rompería su serie de meses, así que NO se toca. Lo que se
// corrige es solo el lado de Google: la curva y el volumen se miden con la
// forma bien escrita, y la tarjeta declara cuál usó. La medición de ML
// —scans, score, maduración— sigue intacta sobre la keyword original.
//
// SOLO corrección mecánica: se restauran preposiciones y se prueban plurales,
// pero las palabras de contenido tienen que ser LAS MISMAS. "rizador pelo" →
// "rizador de pelo" sí; "rizador pelo" → "ondulador de pelo" NO, porque
// ondulador es otra palabra y podría ser otro producto. Los sinónimos se
// muestran aparte para que decida el humano.

const CONECTORES = ['de', 'para', 'de la', 'del', 'con']

// Candidatas mecánicas de una keyword: la original más las variantes con
// conector insertado en cada juntura y con la última palabra en plural/singular.
export function candidatasMecanicas(keyword) {
  const base = normalizarTexto(keyword)
  const palabras = base.split(' ').filter(Boolean)
  const salida = new Set([base])
  if (palabras.length < 2) return [...salida]

  for (let corte = 1; corte < palabras.length; corte++) {
    for (const con of CONECTORES) {
      salida.add([...palabras.slice(0, corte), con, ...palabras.slice(corte)].join(' '))
    }
  }
  // plural/singular de la última palabra: "cama para perro" ↔ "camas para perros"
  const variar = (frase) => {
    const p = frase.split(' ')
    const ult = p[p.length - 1]
    if (!ult) return []
    const otra = ult.endsWith('s') ? ult.slice(0, -1) : `${ult}s`
    return [[...p.slice(0, -1), otra].join(' ')]
  }
  for (const f of [...salida]) for (const v of variar(f)) salida.add(v)
  return [...salida]
}

// De las candidatas medidas, la mejor: MISMAS palabras de contenido y el mayor
// volumen. Devuelve null si ninguna supera a la original (no hay nada que
// corregir) o si la mejora no vale la pena.
export function elegirCorreccion(keyword, volumenPorCandidata, { mejoraMinima = 1.5 } = {}) {
  const claves = palabrasClave(keyword)
  const original = volumenPorCandidata.get(normalizarTexto(keyword)) ?? 0
  let mejor = null
  for (const [frase, volumen] of volumenPorCandidata) {
    if (!volumen || frase === normalizarTexto(keyword)) continue
    // las palabras de contenido deben coincidir: esto deja pasar la preposición
    // restaurada y el plural, y bloquea el cambio de sustantivo
    const c = palabrasClave(frase)
    if (c.size !== claves.size || [...claves].some((p) => !c.has(p))) continue
    if (!mejor || volumen > mejor.volumen) mejor = { keyword: frase, volumen }
  }
  if (!mejor) return null
  if (original > 0 && mejor.volumen < original * mejoraMinima) return null
  return { ...mejor, original, factor: original ? Math.round((mejor.volumen / original) * 10) / 10 : null }
}
