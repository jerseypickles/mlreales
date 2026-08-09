import { sugerenciasReales, sinStopwords, normalizarTexto, palabrasClave } from './busquedasReales.js'

// ¿ALGUIEN BUSCA ESTO? La pieza que faltaba en el embudo.
//
// El sistema medía OFERTA (cuántos listings, a qué precio, quién vende) y
// DEMANDA INFERIDA (delta de reseñas del top), pero nunca preguntó si la gente
// escribe esa búsqueda. Sin ese filtro el radar abre nichos con keywords que
// suenan bien y no existen, se pagan scans y análisis, y salen con veredicto de
// entrada sobre un listado que ningún comprador ve (9-ago: 65 de 78 "entrar").
//
// Se pregunta en CASCADA, de lo barato y preciso a lo caro y amplio. Las tres
// consultas responden preguntas distintas y ninguna sobra — medido en vivo:
//
//   1. prefijo de la 1ª palabra   "manguera"   → ¿encabeza su familia?
//   2. prefijo de dos palabras    "manguera e" → manguera extensible (#2) ✔ existe
//   3. cada palabra por separado  "snorkel"    → snorkel, snorkel buceo, snorkel
//                                                nino… (para "set snorkel", que
//                                                no existe pero cuyo PRODUCTO sí)
//
// Saltarse la (2) daba falsos "nadie la busca" en keywords perfectamente
// vivas: manguera extensible, waflera electrica, organizador cosmeticos, saca
// puntos negros. Saltarse la (3) escondía que "set snorkel" es solo una
// keyword mal puesta sobre un producto que se busca muchísimo.

const CIMA = 3 // posiciones que consideramos "cabeza de familia"
const MAX_PALABRAS = 4 // techo de consultas por nicho

// Palabras que envuelven al producto pero no son el producto: en "set snorkel"
// lo que se busca es snorkel, no set.
export const CONTENEDORES = new Set([
  'set', 'pack', 'kit', 'combo', 'caja', 'cajas', 'juego', 'juegos',
  'par', 'pares', 'lote', 'bolsa', 'docena', 'surtido', 'unidades',
])

const normalizar = (t) => normalizarTexto(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Las palabras por las que vale la pena preguntar (menos de 3 letras no es
// prefijo útil del autocompletado).
export function palabrasDeBusqueda(keyword) {
  return sinStopwords(normalizar(keyword))
    .split(' ')
    .filter((p) => p.length >= 3)
    .slice(0, MAX_PALABRAS)
}

// El SUSTANTIVO del nicho. En español el núcleo va primero ("manguera
// extensible", "waflera electrica"), salvo cuando la primera palabra solo
// envuelve ("set snorkel", "pack toallitas humedas").
export function cabezaDe(keyword) {
  const palabras = palabrasDeBusqueda(keyword)
  return palabras.find((p) => !CONTENEDORES.has(p)) ?? palabras[0] ?? null
}

// La frase y su variante sin stopwords son la MISMA búsqueda para ML:
// "arbol de navidad" no existe, "arbol navidad" es #1 de su prefijo.
export function variantesDe(keyword) {
  const f = normalizar(keyword)
  return [...new Set([f, sinStopwords(f)].filter(Boolean))]
}

// Las consultas de la cascada, en orden. La 3ª solo hace falta si las dos
// primeras no encontraron la frase.
export function consultasDe(keyword) {
  const palabras = palabrasDeBusqueda(keyword)
  if (!palabras.length) return { cortas: [], largas: [] }
  const base = sinStopwords(normalizar(keyword)).split(' ').filter(Boolean)
  const cortas = [palabras[0]]
  if (base.length > 1) cortas.push(`${base[0]} ${base[1].slice(0, 1)}`)
  return { cortas, largas: palabras.slice(1) }
}

// ---- núcleo puro: dado lo que respondió ML, qué significa ----
// listas: Map<consulta, sugerencias[]> — las consultas con espacio son el
// prefijo de dos palabras (frase específica), las de una palabra son familia.
export function analizarFamilia(keyword, listas) {
  const f = normalizar(keyword)
  const variantes = variantesDe(f)
  const palabras = palabrasDeBusqueda(f)
  const cabeza = cabezaDe(f)

  // por RAÍZ, no por texto: "foco solar" es la misma búsqueda que "focos
  // solares" y el sistema tiene que verlo (el stemmer ya existe)
  const raices = palabrasClave(f)

  let exacta = null
  const cabezas = []

  for (const [consulta, lista] of listas) {
    if (!lista?.length || consulta.includes(' ')) continue
    if (lista[0] === consulta) cabezas.push(consulta)
  }

  // CALIFICADORES: las palabras que acompañan a las OTRAS palabras-cabeza del
  // nicho. La familia de "ipl" incluye "ipl laser", así que "laser" es el
  // puente entre las dos mitades de "depiladora ipl casera" y el reemplazo
  // correcto es "depiladora laser", no la genérica "depiladora".
  const calificadores = new Set()
  for (const [consulta, lista] of listas) {
    if (consulta.includes(' ') || consulta === cabeza || !cabezas.includes(consulta)) continue
    for (const s of lista) for (const r of palabrasClave(s)) if (!raices.has(r)) calificadores.add(r)
  }

  const candidatas = []
  for (const [consulta, lista] of listas) {
    if (!lista?.length) continue
    const esFrase = consulta.includes(' ')

    lista.forEach((s, i) => {
      const posicion = i + 1
      if (!exacta && variantes.includes(s)) {
        exacta = { consulta, esFrase, posicion, deCuantas: lista.length, seEscribe: s === f ? null : s }
        return
      }
      const suyas = palabrasClave(s)
      // cuánto del nicho cubre esta búsqueda. Por RAÍZ ("foco solar" cubre
      // "foco solares") y también por TEXTO, porque ML fusiona palabras:
      // "portabebe" cubre dos palabras de "mochila porta bebe" y por raíz no
      // cubriría ninguna.
      const cubre = Math.max(
        [...raices].filter((r) => suyas.has(r)).length,
        palabras.filter((w) => s.includes(w)).length,
      )
      // el reemplazo tiene que hablar del MISMO producto: o lleva el sustantivo
      // del nicho, o cubre dos de sus palabras. Sin este candado se proponía
      // "extensible" para manguera y "electrica toothbrush" para waflera.
      if (cabeza && !s.includes(cabeza) && cubre < 2) return
      candidatas.push({
        q: s,
        consulta,
        posicion,
        cubre,
        // el #1 de un prefijo largo no vale lo mismo que el #1 de uno corto:
        // el corto lo alcanza mucha más gente
        esFrase: esFrase ? 1 : 0,
        // ¿trae la palabra que conecta con la otra mitad del nicho?
        puente: [...suyas].some((r) => calificadores.has(r)) ? 1 : 0,
      })
    })
  }

  // LA FAMILIA: qué escribe la gente alrededor de este producto, en orden de
  // volumen. Se guarda siempre —no solo cuando hay que renombrar— porque es lo
  // que deja elegir la palabra clara mirando, en vez de adivinando.
  const listaCabeza = listas.get(cabeza) ?? [...listas.values()].find((l) => l?.length) ?? []
  const familia = listaCabeza.slice(0, 10).map((q, i) => ({ q, posicion: i + 1 }))

  if (exacta) {
    // encontrada con el prefijo de UNA palabra = la gente llega escribiendo
    // poco; solo con el de dos = existe pero es cola larga
    const nivel = exacta.posicion <= CIMA ? (exacta.esFrase ? 'medio' : 'alto') : exacta.esFrase ? 'bajo' : 'medio'
    return {
      nivel,
      puntaje: { alto: 4, medio: 3, bajo: 2 }[nivel],
      prefijo: exacta.consulta,
      posicion: exacta.posicion,
      deCuantas: exacta.deCuantas,
      seEscribe: exacta.seEscribe,
      colaLarga: exacta.esFrase || undefined,
      familia,
      cabeza,
    }
  }

  // la frase no existe. ¿Existe el PRODUCTO? Gana la búsqueda que cubre más
  // del nicho; a igualdad, la que hace de puente con su otra mitad; recién
  // ahí decide el volumen (la posición en la lista).
  candidatas.sort(
    (a, b) => b.cubre - a.cubre || b.puente - a.puente || a.esFrase - b.esFrase || a.posicion - b.posicion,
  )
  const vistas = new Set()
  const propuestas = candidatas.filter((c) => !vistas.has(c.q) && vistas.add(c.q)).slice(0, 5)

  if (propuestas.length) {
    return {
      nivel: 'renombrar',
      puntaje: 1,
      cabeza,
      prefijo: propuestas[0].consulta,
      keywordSugerida: propuestas[0].q,
      posicionSugerida: propuestas[0].posicion,
      alternativas: propuestas.map((c) => c.q),
      familia,
      cabezas,
    }
  }

  return { nivel: 'nulo', puntaje: 0, cabeza, cabezas, alternativas: [], familia }
}

// ¿La gente escribe esta búsqueda? Un no_entrar sobre una keyword viva no
// cierra el nicho: el rechazo pudo salir de leer mal el listado, así que queda
// pendiente de otro escaneo en vez de apagarse (regla del importador, 9-ago —
// caso paleta maquillaje: rechazada por dominancia de marca con 42% de tiendas
// oficiales y ~850 ventas/día medidas).
export const seBusca = (nivelBusqueda) => ['alto', 'medio'].includes(nivelBusqueda?.nivel)

// Para ordenar familias: manda la keyword CLARA, no la de mayor score. Sin
// esto lideraba "foco solares" (mal escrita) sobre sus hermanas sanas y
// "depiladora ipl casera" sobre "depiladora laser", que es justo la búsqueda
// que el sistema propone para ella. Sin medir queda en tierra de nadie: no
// destrona a una medida sana ni la pisa una medida mala.
export const puntajeBusqueda = (nivelBusqueda) => nivelBusqueda?.puntaje ?? 2.5

// Frase corta para la UI y para los prompts.
export function explicar(n) {
  if (!n) return null
  if (n.nivel === 'nulo') {
    return 'Nadie busca esta keyword ni nada parecido en ML: no hay producto que medir.'
  }
  if (n.nivel === 'renombrar') {
    const otras = n.alternativas?.length > 1 ? ` (también: ${n.alternativas.slice(1, 4).join(' · ')})` : ''
    return `Esta keyword no aparece en el autocompletado, pero el producto SÍ se busca: la gente escribe "${n.keywordSugerida}"${n.posicionSugerida ? ` (#${n.posicionSugerida})` : ''}${otras}.`
  }
  const como = n.seEscribe ? ` — la gente la escribe "${n.seEscribe}"` : ''
  const cola = n.colaLarga ? ', hay que teclear dos palabras para que aparezca' : ''
  return `#${n.posicion} de ${n.deCuantas} tecleando "${n.prefijo}"${cola}${como}`
}

// ---- medición contra el autocompletado ----
export async function medirNivelBusqueda(keyword, { pausaMs = 1300 } = {}) {
  const { cortas, largas } = consultasDe(keyword)
  if (!cortas.length) return { nivel: 'nulo', puntaje: 0, medidoEl: new Date() }

  const listas = new Map()
  let bloqueadas = 0
  const preguntar = async (q, primera = false) => {
    if (!primera) await new Promise((r) => setTimeout(r, pausaMs))
    try {
      listas.set(q, await sugerenciasReales(q, { limit: 10 }))
    } catch {
      bloqueadas++
    }
  }

  // 1 y 2: ¿existe la frase tal cual? Con esto alcanza para el nicho sano y
  // son solo dos consultas.
  for (const [i, q] of cortas.entries()) await preguntar(q, i === 0)
  const sana = analizarFamilia(keyword, listas)

  // 3: solo si la frase no apareció, buscar el producto por sus otras palabras
  if (sana.nivel === 'renombrar' || sana.nivel === 'nulo') {
    for (const q of largas) await preguntar(q)
  }

  // sin una sola respuesta no se puede afirmar nada: mejor sin medición que
  // con un "nadie la busca" que en realidad fue un 403 del WAF
  if (!listas.size) {
    throw new Error(`autocompletado sin respuesta para "${keyword}" (${bloqueadas} consultas bloqueadas)`)
  }

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
export async function medirNichosPendientes({ dias = 14, max = 40, pausaMs = 1300, desde = null } = {}) {
  const { Nicho } = await import('../models/Nicho.js')
  // `desde` = re-medir todo lo que se midió ANTES de ese instante (cambió el
  // medidor, o se renombraron keywords). Es una marca fija que viaja entre las
  // pasadas encadenadas: sin ella cada vuelta volvería a tomar los mismos 40 y
  // el resto del tablero se quedaría con la medición vieja para siempre.
  const corte = desde ? new Date(desde) : new Date(Date.now() - dias * 86400e3)
  const vencidos = { $or: [{ nivelBusqueda: null }, { 'nivelBusqueda.medidoEl': { $lt: corte } }] }
  const pendientes = await Nicho.find(vencidos)
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
          `[nivel-busqueda] "${nicho.keyword}": la keyword no existe, el producto SÍ → "${nivelBusqueda.keywordSugerida}"`,
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
