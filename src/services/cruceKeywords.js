// ¿LA KEYWORD DEL NICHO ES LA QUE LA GENTE ESCRIBE?
//
// El volumen de Google mide LA PALABRA QUE ELEGIMOS, no el producto. Si nadie
// escribe esa palabra, el número es real y a la vez irrelevante: describe un
// escaparate que no se abre.
//
// Medido el 30-ago-2026 contra las tendencias que publica ML por categoría:
//   manguera extensible   260/mes  →  ML: "manguera de jardin", "mangueras jardin"
//   cooler portatil       480/mes  →  ML: "cooler 60 litros", "cooler", "alpicool"
//   espejo luz            140/mes  →  ML: "espejo de aumento 20x", "espejo triple"
//
// Los tres salieron nivel "medio" y ninguno quedó marcado. Y manguera venía de
// ser un ENTRAR con score 89 en el tablero de agosto: el nicho no se murió, la
// keyword nunca fue la que se busca.
//
// Esto NO es una corrección automática. Renombrar un nicho rompe su serie
// histórica, así que la señal se muestra y el importador decide.

// Palabras que no distinguen nada y ensucian la comparación.
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'sin', 'y', 'a', 'en', 'por', 'un', 'una'])

// Pura. Normaliza para comparar: sin acentos, sin mayúsculas, sin plurales
// simples. "Mangueras Jardín" y "manguera jardin" tienen que ser lo mismo.
export function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !VACIAS.has(t))
    // plural simple: "mangueras" → "manguera". No se toca lo corto ni lo que
    // ya termina en consonante rara, para no fabricar palabras.
    .map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t))
}

// Pura. El sustantivo que manda: en español va primero. "manguera extensible"
// y "manguera de jardin" comparten cabeza; "espejo luz" y "espejo triple"
// también. Es lo que separa "otra forma de decirlo" de "otro producto".
export const cabeza = (keyword) => normalizar(keyword)[0] ?? null

// Pura. ¿Nuestra keyword es la que se busca, una variante, o ajena?
//
//   coincide  alguna tendencia contiene TODAS nuestras palabras
//   variante  comparten la cabeza pero ninguna nos contiene: el producto es
//             ese, la forma de nombrarlo no
//   ajena     ni la cabeza aparece: o el nicho no es de esta categoría, o las
//             tendencias no lo representan
export function evaluarKeyword(keyword, tendencias) {
  const nuestras = normalizar(keyword)
  if (!nuestras.length) return { estado: 'sin-datos', motivo: 'keyword vacía' }
  if (!tendencias?.length) return { estado: 'sin-datos', motivo: 'ML no publicó tendencias de esta categoría' }

  const cab = nuestras[0]
  const analizadas = tendencias.map((t) => ({ texto: t, tokens: normalizar(t) }))

  const contiene = analizadas.find((t) => nuestras.every((n) => t.tokens.includes(n)))
  if (contiene) {
    return { estado: 'coincide', sugerida: null, comoSeBusca: contiene.texto }
  }

  // las que comparten la cabeza vienen en el orden que ML las publica, que es
  // el de relevancia: la primera es la mejor candidata
  const conCabeza = analizadas.filter((t) => t.tokens.includes(cab))
  if (conCabeza.length) {
    return {
      estado: 'variante',
      sugerida: conCabeza[0].texto,
      alternativas: conCabeza.slice(0, 4).map((t) => t.texto),
      motivo: `nadie escribe "${keyword}"; en esta categoría se busca "${conCabeza[0].texto}"`,
    }
  }

  return {
    estado: 'ajena',
    sugerida: null,
    motivo: `ninguna búsqueda de la categoría menciona "${cab}"`,
    tendencias: tendencias.slice(0, 5),
  }
}

// LA SUGERENCIA NO SE ADIVINA, SE MIDE.
//
// Elegir la mejor candidata por heurística sale mal: para "espejo luz" la
// primera tendencia con la cabeza correcta era "espejos de bolsillo por mayor",
// que es un aviso mayorista y no una keyword de nicho. Y preferir la más corta
// tampoco sirve —en manguera ganaba "mangera", que es un error de tipeo.
//
// Como `volumenMensual` acepta hasta 1.000 keywords por llamada, se le
// pregunta a Google el volumen de TODAS las candidatas y gana la que más se
// busca. Es una medición, no un criterio de estilo.
export async function medirCandidatas(keyword, evaluacion, { volumenMensual }) {
  if (evaluacion?.estado !== 'variante' || !evaluacion.alternativas?.length) return evaluacion
  const candidatas = [keyword, ...evaluacion.alternativas]
  let volumenes
  try {
    volumenes = await volumenMensual(candidatas)
  } catch {
    // sin medición se devuelve la evaluación tal cual: la señal sigue sirviendo
    return evaluacion
  }
  const conVolumen = candidatas
    .map((k) => ({ keyword: k, busquedasMes: volumenes.get(k)?.busquedasMes ?? null }))
    .filter((x) => Number.isFinite(x.busquedasMes))
    .sort((a, b) => b.busquedasMes - a.busquedasMes)
  if (!conVolumen.length) return evaluacion

  const nuestra = conVolumen.find((x) => x.keyword === keyword)?.busquedasMes ?? null
  const mejor = conVolumen[0]
  // si la nuestra ya es la más buscada, no hay nada que sugerir
  if (mejor.keyword === keyword) {
    return { ...evaluacion, estado: 'coincide', sugerida: null, medidas: conVolumen, motivo: 'la keyword del nicho es la más buscada de su familia' }
  }
  return {
    ...evaluacion,
    sugerida: mejor.keyword,
    medidas: conVolumen,
    vecesMas: nuestra ? Math.round((mejor.busquedasMes / nuestra) * 10) / 10 : null,
    motivo: nuestra
      ? `"${mejor.keyword}" tiene ${mejor.busquedasMes.toLocaleString('es-CL')}/mes contra ${nuestra.toLocaleString('es-CL')} de "${keyword}"`
      : `"${mejor.keyword}" tiene ${mejor.busquedasMes.toLocaleString('es-CL')}/mes`,
  }
}

// Pura. Cuándo esto merece que alguien lo mire.
//
// Una keyword variante NO es un problema por sí sola: muchas búsquedas
// específicas son legítimas y valiosas. Lo que enciende la alarma es variante
// CON VOLUMEN BAJO — ahí lo más probable es que el volumen sea de la palabra y
// no del producto, y el nicho esté mal juzgado.
const VOLUMEN_SOSPECHOSO = 3000

export function mereceRevision({ evaluacion, busquedasMes }) {
  if (evaluacion?.estado !== 'variante') return false
  return Number.isFinite(busquedasMes) && busquedasMes < VOLUMEN_SOSPECHOSO
}
