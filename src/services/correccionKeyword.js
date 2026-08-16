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

// LA Ñ NO ES UNA TILDE, ES OTRA LETRA — Y GOOGLE LO SABE.
//
// `normalizarTexto` descompone y borra las marcas diacríticas, así que la ñ
// llega a Google convertida en n. Para las tildes de vocales da lo mismo
// (medido: "nivel laser" y "nivel láser" dan 14.800 idénticos, igual que
// camión, colchón y lámpara), pero la ñ cambia la palabra:
//
//   pestanas postizas → 10/mes        pestañas postizas → 8.100/mes
//   bano portatil     → 20/mes        baño portatil     → 8.100/mes
//
// Y NO se trata de "restaurar la ñ" siempre: "juguetes ninos" mide 1.900 y
// "juguetes niños" mide 0. Por eso se generan las dos formas y gana la que
// mida más, que es la misma regla que ya protege a las correcciones de
// keyword — una corrección nunca puede reducir el volumen.
//
// Solo sustitución simple (una n por vez): alcanza para pestañas, baño, niños,
// pañales, y evita el estallido combinatorio de palabras con varias n.
function variantesEne(frase) {
  const salida = []
  for (let i = 0; i < frase.length; i++) {
    if (frase[i] === 'n') salida.push(`${frase.slice(0, i)}ñ${frase.slice(i + 1)}`)
  }
  return salida
}

// Candidatas mecánicas de una keyword: la original más las variantes con
// conector insertado en cada juntura y con la última palabra en plural/singular.
export function candidatasMecanicas(keyword) {
  const base = normalizarTexto(keyword)
  const palabras = base.split(' ').filter(Boolean)
  const salida = new Set([base])
  // una sola palabra no admite conectores, pero sí puede llevar ñ ("panales")
  if (palabras.length < 2) {
    for (const v of variantesEne(base)) salida.add(v)
    return [...salida]
  }

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
  for (const f of [...salida]) for (const v of variantesEne(f)) salida.add(v)
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
