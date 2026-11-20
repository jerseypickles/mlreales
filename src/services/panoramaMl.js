import { CategoriaMl, TendenciaCategoria, PasadaPanorama } from '../models/CategoriaMl.js'
import { RankingMasVendidos } from '../models/RankingMasVendidos.js'
import { meliGet } from './meli.js'
import { normalizarDestacados, normalizarTendencias, gruposDeTendencias } from './senalesOficiales.js'
import { categoriasDelTablero, resolverFichas, movimientosDeRanking } from './rankingMasVendidos.js'
import { diaChile } from './inventarioFull.js'
import { temporadaDe } from './calendarioTemporadas.js'

// EL PANORAMA DE MERCADO LIBRE: EL RADAR MIRA TODOS LOS PASILLOS.
//
// Pedido del importador (25-sep-2026): mientras llegan los productos, fortalecer
// lo que se descubre. El radar miraba siempre los mismos pasillos —el ranking de
// más vendidos solo de las ~100 categorías con nichos, y el autocompletado de
// ~20 palabras semilla fijas—. Esto lee, gratis y por la API oficial:
//  - el árbol completo de categorías (refresco semanal),
//  - el top 20 de más vendidos de cada categoría final con volumen, a diario,
//  - las búsquedas que suben en cada una, una vez por semana.
// Todo en pasadas cortas cada hora: ML frena tras ~115 consultas seguidas y la
// cuota la comparten el scan de propios y las órdenes. El nombre y la foto se
// buscan SOLO para lo que entró o subió en el ranking: resolver fichas de todo
// serían miles de consultas por productos que no se movieron.

const DIA = 86400e3
export const MIN_ITEMS_CATEGORIA = 500 // categorías más chicas no mueven un nicho
const REFRESCO_ARBOL_DIAS = 7
const REFRESCO_TENDENCIAS_DIAS = 7
// una categoría donde ML no publica ranking o tendencias se vuelve a probar
// recién después de esto (puede empezar a publicar si crece)
export const SIN_RANKING_DIAS = 14
export const SIN_TENDENCIAS_DIAS = 30
const PAUSA_MS = 250
const PAUSA_429_MS = 6000
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

// una consulta que distingue "ML me frenó" (reintentar después) de "no hay dato"
// y de "ML no me deja" (403)
async function pedir(ruta, obtener = meliGet) {
  try {
    return { datos: await obtener(ruta) }
  } catch (err) {
    return { frenado: /\b429\b|too many/i.test(err.message), denegado: /\b403\b|unauthorized|forbidden|access denied/i.test(err.message), error: err.message }
  }
}

// ML CERRÓ EL RANKING DE MÁS VENDIDOS EL 14-OCT-2026: `/highlights` responde
// 403 "At least one policy returned UNAUTHORIZED" para toda categoría (las
// tendencias siguen abiertas), como las reseñas ajenas el 29-sep. Un 403 no es
// un 404, así que no se anotaba: ~220 pedidos por hora, 0 capturas y una pasada
// que decía "0 frenos". Si una tanda arranca con puros 403, el ranking se deja
// 24 horas y después se reprueba con unas pocas.
export const MUESTRA_CIERRE = 8
const CIERRE_MS = 24 * 3600e3
let cierreRanking = null // { desde, hasta, ejemplo }

// Pura. ¿Las primeras respuestas de la tanda dicen que ML cerró el ranking?
export function rankingCerrado(respuestas) {
  return respuestas.length >= MUESTRA_CIERRE && respuestas.slice(0, MUESTRA_CIERRE).every((r) => r?.denegado)
}

// Pura. ¿ML dice que esa categoría no tiene el dato publicado? Un 404 ("Not
// found public trends") o una respuesta vacía sin error. Un freno (429) o un
// error de red NO cuentan: esos se reintentan en la pasada siguiente.
export function noPublicado(r, vacio) {
  if (r?.frenado) return false
  if (r?.error) return /\b404\b/.test(r.error)
  return Boolean(vacio)
}

// Pura. Las hojas que se pueden pedir: sin marca de "no publica" vigente.
export function pedibles(hojas, campo, ahora) {
  return hojas.filter((h) => !(h[campo] && new Date(h[campo]) > ahora))
}

// Pura. Lo que se guarda de una categoría leída.
export function aCategoria(c) {
  const hijas = c?.children_categories ?? []
  return {
    nombre: c?.name ?? null,
    ruta: (c?.path_from_root ?? []).map((x) => x.name).join(' > ') || c?.name || null,
    padreId: c?.path_from_root?.length > 1 ? c.path_from_root.at(-2).id : null,
    hoja: hijas.length === 0,
    totalItems: Number.isFinite(c?.total_items_in_this_category) ? c.total_items_in_this_category : null,
    hijas: hijas.map((h) => ({ id: h.id, nombre: h.name })),
  }
}

// El árbol: se siembra con las categorías raíz y se va leyendo lo pendiente o
// vencido, anotando las hijas que aparezcan. Termina cuando se acaba el tiempo.
export async function avanzarArbol({ ahora = new Date(), presupuestoMs = 150_000, obtener = meliGet } = {}) {
  if (!(await CategoriaMl.exists({}))) {
    const r = await pedir('/sites/MLC/categories', obtener)
    for (const c of r.datos ?? []) await CategoriaMl.updateOne({ id: c.id }, { $setOnInsert: { id: c.id, nombre: c.name, ruta: c.name } }, { upsert: true })
  }
  const limite = Date.now() + presupuestoMs
  const vencida = new Date(+ahora - REFRESCO_ARBOL_DIAS * DIA)
  let leidas = 0, frenos = 0
  while (Date.now() < limite) {
    const lote = await CategoriaMl.find({ $or: [{ actualizadoEl: null }, { actualizadoEl: { $lt: vencida } }] }).select('id').limit(50).lean()
    if (!lote.length) break
    for (const { id } of lote) {
      if (Date.now() >= limite) break
      const r = await pedir(`/categories/${id}`, obtener)
      if (r.frenado) { frenos++; await esperar(PAUSA_429_MS); continue }
      if (!r.datos) { await CategoriaMl.updateOne({ id }, { $set: { actualizadoEl: ahora } }); continue }
      const c = aCategoria(r.datos)
      await CategoriaMl.updateOne({ id }, { $set: { nombre: c.nombre, ruta: c.ruta, padreId: c.padreId, hoja: c.hoja, totalItems: c.totalItems, actualizadoEl: ahora } })
      if (c.hijas.length) {
        await CategoriaMl.bulkWrite(c.hijas.map((h) => ({ updateOne: { filter: { id: h.id }, update: { $setOnInsert: { id: h.id, nombre: h.nombre, padreId: id } }, upsert: true } })), { ordered: false })
      }
      leidas++
      await esperar(PAUSA_MS)
    }
  }
  const [total, pendientes, hojas] = await Promise.all([
    CategoriaMl.countDocuments(), CategoriaMl.countDocuments({ actualizadoEl: null }),
    CategoriaMl.countDocuments({ hoja: true, totalItems: { $gte: MIN_ITEMS_CATEGORIA } }),
  ])
  return { leidas, frenos, total, pendientes, hojasConVolumen: hojas }
}

// Una pasada: ranking de hoy de las categorías finales con volumen que falten,
// y las búsquedas que suben de las que tengan la captura vencida.
// El árbol resultó de 12.145 categorías y 6.029 hojas con volumen (27-sep): a
// 120 por hora no alcanzaba ni la mitad al día, y las búsquedas que suben
// quedaban sin tiempo (solo 13 capturas). Ahora: las 3.000 hojas más grandes a
// diario, el resto cada 3 días, y un cupo FIJO de tendencias por pasada.
export const DIARIAS = 3000
export const CADA_DIAS_RESTO = 3
export const TENDENCIAS_POR_PASADA = 40

// Pura. Qué hojas tocan hoy: las grandes si no se leyeron hoy; las chicas si su
// última lectura tiene 3 días o más. hojas: ordenadas por totalItems desc;
// ultima: Map(categoriaId → día AAAA-MM-DD de su última captura).
export function hojasQueTocan(hojas, ultima, dia) {
  const limite = new Date(`${dia}T12:00:00Z`)
  limite.setUTCDate(limite.getUTCDate() - CADA_DIAS_RESTO)
  const corte = limite.toISOString().slice(0, 10)
  return hojas.filter((h, i) => {
    const u = ultima.get(h.id)
    if (u === dia) return false
    return i < DIARIAS || !u || u <= corte
  })
}

let ultimaPasada = null
export async function pasadaPanorama({ ahora = new Date(), porPasada = 220, presupuestoMs = 240_000, obtener = meliGet } = {}) {
  const dia = diaChile(ahora)
  const inicio = Date.now()
  // mientras el árbol no esté completo, la pasada lo avanza primero
  // con mucho árbol por leer, casi toda la pasada va al árbol: sin él no hay
  // categorías que rankear (1ª pasada: 227 leídas en 2 min, 0 frenos de ML)
  const porLeer = await CategoriaMl.countDocuments({ actualizadoEl: null })
  const arbol = porLeer || !(await CategoriaMl.exists({}))
    ? await avanzarArbol({ ahora, presupuestoMs: presupuestoMs * (porLeer > 300 ? 0.85 : 0.5), obtener }) : null
  const hojas = await CategoriaMl.find({ hoja: true, totalItems: { $gte: MIN_ITEMS_CATEGORIA } }).select('id sinRankingHasta sinTendenciasHasta').sort({ totalItems: -1 }).lean()
  const hechas = new Set(await RankingMasVendidos.distinct('categoriaId', { dia }))
  const ultima = new Map((await RankingMasVendidos.aggregate([{ $group: { _id: '$categoriaId', dia: { $max: '$dia' } } }])).map((x) => [x._id, x.dia]))
  const delTablero = await categoriasDelTablero().catch(() => new Map())
  // TRABA DEL 1-OCT: las categorías sin ranking publicado no se anotaban, y
  // como nunca tenían captura volvían a encabezar los 220 cupos de cada pasada.
  // El ranking diario se quedó en ~579 de 6.029 (+162, +113… hasta +1 por hora).
  const pendientes = hojasQueTocan(pedibles(hojas, 'sinRankingHasta', ahora), ultima, dia).slice(0, porPasada)
  // búsquedas que suben: una vez por semana por categoría. VAN ANTES del
  // ranking y con su propio tiempo: con 6.029 hojas el ranking siempre tiene
  // pendientes, se comía la pasada entera y las tendencias quedaron en 575
  // capturas desde el 16-sep sin una segunda lectura con qué comparar.
  const finTendencias = Date.now() - inicio + presupuestoMs * 0.2
  let frenos = 0
  const vencida = diaChile(+ahora - REFRESCO_TENDENCIAS_DIAS * DIA)
  const conTendencia = new Set(await TendenciaCategoria.distinct('categoriaId', { dia: { $gt: vencida } }))
  let tendencias = 0, erroresTendencia = 0, vaciasTendencia = 0, ultimoErrorTendencia = null, sinTendencias = 0
  // MISMA TRABA, PEOR: las 40 más grandes daban 404 "Not found public trends"
  // en todas las pasadas (40 errores de 40, todo el 1 y 2-oct) y se volvían a
  // pedir cada hora: 6 capturas en dos días. Ahora el 404 queda anotado.
  // primero las categorías ANCHAS (raíces y su primer nivel): que una búsqueda esté entre las primeras de una
  // categoría grande dice algo; en una hoja chica casi cualquiera lo está. Son pocas y van antes que las hojas.
  const anchas = await categoriasAnchas().catch(() => [])
  const candidatas = pedibles([...anchas, ...hojas], 'sinTendenciasHasta', ahora).filter((h) => !conTendencia.has(h.id))
  const candidatasTendencia = candidatas.length
  for (const { id } of candidatas.slice(0, TENDENCIAS_POR_PASADA)) {
    if (Date.now() - inicio > finTendencias) break
    const r = await pedir(`/trends/MLC/${id}`, obtener)
    if (r.frenado) { frenos++; await esperar(PAUSA_429_MS); continue }
    if (r.error) { erroresTendencia++; ultimoErrorTendencia = r.error }
    const terminos = normalizarTendencias(r.datos)
    if (!r.error && !terminos.length) vaciasTendencia++
    if (noPublicado(r, !terminos.length)) {
      await CategoriaMl.updateOne({ id }, { $set: { sinTendenciasHasta: new Date(+ahora + SIN_TENDENCIAS_DIAS * DIA) } })
      sinTendencias++
    }
    if (terminos.length) { await TendenciaCategoria.updateOne({ categoriaId: id, dia }, { $setOnInsert: { categoriaId: id, dia, terminos, grupos: gruposDeTendencias(r.datos), capturadoEl: ahora } }, { upsert: true }); tendencias++ }
    await esperar(PAUSA_MS)
  }
  const presupuestoRanking = presupuestoMs
  let capturadas = 0, movidas = 0, sinRanking = 0, denegadas = 0
  const primeras = []
  const cerrado = cierreRanking && +ahora < cierreRanking.hasta
  for (const { id } of cerrado ? [] : pendientes) {
    if (Date.now() - inicio > presupuestoRanking) break
    const r = await pedir(`/highlights/MLC/category/${id}`, obtener)
    if (primeras.length < MUESTRA_CIERRE) primeras.push(r)
    if (r.frenado) { frenos++; await esperar(PAUSA_429_MS); continue }
    if (r.denegado) {
      denegadas++
      if (rankingCerrado(primeras)) {
        cierreRanking = { desde: cierreRanking?.desde ?? +ahora, hasta: +ahora + CIERRE_MS, ejemplo: String(r.error ?? '').slice(0, 120) }
        console.warn(`[panorama] ML niega el ranking de más vendidos (${MUESTRA_CIERRE}/${MUESTRA_CIERRE} con 403): pausa de 24 h`)
        break
      }
      await esperar(PAUSA_MS)
      continue
    }
    if (!r.error) cierreRanking = null // ML volvió a responder
    const items = normalizarDestacados(r.datos)
    if (noPublicado(r, !items.length)) {
      await CategoriaMl.updateOne({ id }, { $set: { sinRankingHasta: new Date(+ahora + SIN_RANKING_DIAS * DIA) } })
      sinRanking++
    }
    if (items.length) {
      await RankingMasVendidos.updateOne({ categoriaId: id, dia }, { $setOnInsert: { categoriaId: id, dia, nichos: delTablero.get(id) ?? [], items, capturadoEl: ahora } }, { upsert: true })
      capturadas++
      // nombre y foto SOLO de lo que entró o subió contra la captura anterior
      const antes = await RankingMasVendidos.findOne({ categoriaId: id, dia: { $lt: dia } }).sort({ dia: -1 }).lean()
      if (antes) {
        const mov = movimientosDeRanking(items, antes.items).filter((i) => i.nuevo || i.subio >= 5)
        if (mov.length) { movidas += mov.length; await resolverFichas(mov, { ahora }).catch(() => 0) }
      }
    }
    await esperar(PAUSA_MS)
  }
  const resultado = { dia, arbol, hojasConVolumen: hojas.length, rankingHoy: hechas.size + capturadas, capturadas, movidas, sinRanking, tendencias, frenos, denegadas,
    rankingCerrado: cierreRanking ? { desde: new Date(cierreRanking.desde), hasta: new Date(cierreRanking.hasta), ejemplo: cierreRanking.ejemplo } : null,
    tendenciaDiag: { candidatas: candidatasTendencia, errores: erroresTendencia, vacias: vaciasTendencia, sinTendencias, ultimoError: ultimoErrorTendencia, segundos: Math.round((Date.now() - inicio) / 1000) } }
  ultimaPasada = { ...resultado, en: new Date() }
  // la API corre en otro proceso: sin esto solo se veía en el log
  await PasadaPanorama.create({ en: ultimaPasada.en, dia, resultado }).catch(() => null)
  console.log(`[panorama] ${dia}: ranking ${resultado.rankingHoy}/${hojas.length} categorías (+${capturadas}, ${movidas} movimientos), ${tendencias} tendencias, ${frenos} frenos${denegadas ? `, ${denegadas} denegadas (403)` : ''}${cierreRanking ? ' · ranking CERRADO por ML' : ''}${arbol ? ` · árbol ${arbol.total} (${arbol.pendientes} por leer)` : ''}`)
  return resultado
}

// Pura. Términos que aparecen en la última captura y no estaban en la anterior.
export function terminosNuevos(ultima, anterior) {
  const antes = new Set(anterior ?? [])
  return (ultima ?? []).filter((t) => !antes.has(t))
}

// Pura. QUÉ CLASE DE SEÑAL ES UNA BÚSQUEDA QUE SUBE (8-oct-2026). Compara esta
// semana contra la anterior, así que sube lo que la ESTACIÓN empuja: en octubre
// polerones, en diciembre piscinas. El importador: "tú tienes data de 12 meses y
// a la mano ML con 7 días". Para quien importa con ~2 meses de demora, lo de
// temporada que sube hoy llega tarde; lo que sirve es la NOVEDAD.
//   'estacional-tarde'    → de una temporada que ya no se alcanza o no toca
//   'estacional-a-tiempo' → de una temporada que todavía se alcanza pidiendo ya
//   'novedad'             → no es de temporada: lo que de verdad aporta
export function clasificarBusqueda(termino, temporada) {
  if (!temporada) return { tipo: 'novedad' }
  const aTiempo = ['a-tiempo', 'justo'].includes(temporada.estado)
  return { tipo: aTiempo ? 'estacional-a-tiempo' : 'estacional-tarde', temporada: temporada.nombre, estadoTemporada: temporada.estado }
}

// Las búsquedas que ENTRARON a las tendencias de su categoría, con el nombre de
// la categoría: lo que lee el radar.
export async function busquedasQueSuben({ max = 30 } = {}) {
  const docs = await TendenciaCategoria.find({}).sort({ dia: -1 }).select('categoriaId dia terminos').lean()
  const porCat = new Map()
  for (const d of docs) porCat.set(d.categoriaId, [...(porCat.get(d.categoriaId) ?? []), d])
  const nombres = new Map((await CategoriaMl.find({ id: { $in: [...porCat.keys()] } }).select('id ruta totalItems').lean()).map((c) => [c.id, c]))
  const salida = []
  for (const [categoriaId, serie] of porCat) {
    if (serie.length < 2) continue
    for (const t of terminosNuevos(serie[0].terminos, serie[1].terminos).slice(0, 3)) {
      const ruta = nombres.get(categoriaId)?.ruta ?? categoriaId
      salida.push({ termino: t, categoria: ruta, totalItems: nombres.get(categoriaId)?.totalItems ?? 0, ...clasificarBusqueda(t, temporadaDe(`${t} ${String(ruta).split(' > ').at(-1)}`)) })
    }
  }
  return salida.sort((a, b) => b.totalItems - a.totalItems).slice(0, max)
}

// Raíces que no son para un importador (inmuebles, servicios, vehículos completos, alimentos, libros, música y
// películas, antigüedades, entradas y el cajón de «otras»): no se miran sus tendencias ni su ranking.
const RAIZ_FUERA = /^(inmuebles|servicios|autos, motos|alimentos|libros|m[uú]sica y pel|antig[uü]edades|entradas|otras categor)/i
export const raizUtil = (nombre) => !RAIZ_FUERA.test(String(nombre ?? '').trim())

// Las categorías anchas: las raíces útiles del árbol y sus hijas que no son hojas (las hojas ya van por su lado).
export async function categoriasAnchas() {
  const raices = (await CategoriaMl.find({ padreId: null, hoja: { $ne: null } }).select('id nombre sinTendenciasHasta totalItems').lean()).filter((r) => raizUtil(r.nombre))
  const hijas = await CategoriaMl.find({ padreId: { $in: raices.map((r) => r.id) }, hoja: { $ne: true } }).select('id sinTendenciasHasta totalItems').sort({ totalItems: -1 }).lean()
  return [...raices, ...hijas]
}

// LO QUE CRECE EN VENTAS SEMANA TRAS SEMANA (20-nov-2026). De cada lista de /trends, el primer grupo son las diez
// búsquedas que más crecieron en ingresos. Una semana sola es un salto (una oferta, una fecha); la que se repite es
// venta que viene subiendo. Medido ese día al auditar las fuentes del radar: los nichos que salieron de señales de
// venta real (el ranking de más vendidos, las tiendas que reponen) son los que después vendieron, y de estas listas
// el radar recibía solo los términos nuevos de la semana, sin saber de qué grupo eran.
//
// Pura. capturas: [{ categoriaId, dia, terminos, grupos }] de las últimas semanas; categorias: Map(id → { ruta,
// totalItems }). Devuelve las búsquedas que estuvieron entre las que más crecen en ingresos en `minSemanas` capturas
// o más de una misma categoría, de la categoría más ancha a la más angosta. Las capturas anteriores a los grupos
// sirven igual: sus diez primeros términos son ese grupo (quitar repetidos no mueve el principio de la lista).
export const SEMANAS_SOSTENIDA = 2
// hasta qué nivel del árbol una categoría es «ancha»: las raíces y su primer nivel
export const NIVEL_ANCHO = 2
export function sostenidasDe(capturas, categorias, { minSemanas = SEMANAS_SOSTENIDA, porCategoria = 2 } = {}) {
  const nivel = (c) => String(c?.ruta ?? '').split(' > ').filter(Boolean).length || 9
  const porTermino = new Map()
  const porCat = new Map()
  for (const c of capturas ?? []) (porCat.get(c.categoriaId) ?? porCat.set(c.categoriaId, []).get(c.categoriaId)).push(c)
  for (const [categoriaId, serie] of porCat) {
    const cuenta = new Map()
    for (const c of serie) for (const t of new Set(c.grupos?.crecen ?? (c.terminos ?? []).slice(0, 10))) cuenta.set(t, (cuenta.get(t) ?? 0) + 1)
    const cat = categorias.get(categoriaId)
    // de cada categoría, las que más semanas llevan: una sola categoría no llena la lista
    const suyas = [...cuenta].filter(([, semanas]) => semanas >= minSemanas).sort((a, b) => b[1] - a[1]).slice(0, porCategoria)
    for (const [termino, semanas] of suyas) {
      const fila = { termino, categoriaId, categoria: cat?.ruta ?? categoriaId, semanas, de: serie.length, nivel: nivel(cat), totalItems: cat?.totalItems ?? 0 }
      const previa = porTermino.get(termino)
      // la misma búsqueda en varias categorías: queda la más ancha (y, a igual nivel, la más grande)
      if (!previa || fila.nivel < previa.nivel || (fila.nivel === previa.nivel && fila.totalItems > previa.totalItems)) porTermino.set(termino, fila)
    }
  }
  return [...porTermino.values()].sort((a, b) => a.nivel - b.nivel || b.semanas - a.semanas || b.totalItems - a.totalItems)
}

// Lo que lee el radar: las sostenidas de las últimas `semanas` semanas en categorías anchas (raíces y su primer
// nivel) o grandes, con qué clase de señal es cada una. Son muchas más de las que caben en una corrida: cada día
// se muestra un tramo distinto (rota por día), así el radar no propone siempre sobre los mismos pasillos.
export const ITEMS_CATEGORIA_GRANDE = 20000
export async function tendenciasSostenidas({ ahora = new Date(), semanas = 4, max = 30 } = {}) {
  const desde = diaChile(+ahora - semanas * 7 * DIA)
  const capturas = await TendenciaCategoria.find({ dia: { $gte: desde } }).select('categoriaId dia terminos grupos').lean()
  if (!capturas.length) return []
  const categorias = new Map((await CategoriaMl.find({ id: { $in: [...new Set(capturas.map((c) => c.categoriaId))] } }).select('id ruta totalItems').lean()).map((c) => [c.id, c]))
  const todas = sostenidasDe(capturas, categorias).filter((x) => x.nivel <= NIVEL_ANCHO || x.totalItems >= ITEMS_CATEGORIA_GRANDE)
  if (!todas.length) return []
  // se piden de más: el radar todavía saca licencias, temporadas que ya no se alcanzan y lo que ya es un nicho
  const tramo = max * 4
  const paso = (Math.floor(+ahora / DIA) * tramo) % todas.length
  return [...todas.slice(paso), ...todas.slice(0, paso)].slice(0, tramo)
    .map((x) => ({ ...x, ...clasificarBusqueda(x.termino, temporadaDe(`${x.termino} ${String(x.categoria).split(' > ').at(-1)}`)) }))
}

// LO QUE SE BUSCA EN LAS CATEGORÍAS ANCHAS (20-nov-2026): la segunda señal de cada nicho. Estar en las tendencias de
// una categoría hoja no dice nada (cada búsqueda es top en su categoría chica); estar en las de una raíz o de su
// primer nivel sí. Pura. Devuelve, de la última captura de cada categoría ancha, cada término con su grupo y en
// cuántas de las capturas de la ventana aparece. Las capturas sin grupos (anteriores al 20-nov) solo permiten
// separar las diez primeras.
export function terminosDeAnchas(capturas, categorias) {
  const nivel = (c) => String(c?.ruta ?? '').split(' > ').filter(Boolean).length
  const porCategoria = new Map()
  for (const c of capturas ?? []) {
    const cat = categorias.get(c.categoriaId)
    if (!cat || nivel(cat) < 1 || nivel(cat) > NIVEL_ANCHO) continue
    ;(porCategoria.get(c.categoriaId) ?? porCategoria.set(c.categoriaId, []).get(c.categoriaId)).push(c)
  }
  const salida = []
  for (const [categoriaId, serie] of porCategoria) {
    serie.sort((a, b) => String(a.dia).localeCompare(String(b.dia)))
    const ultima = serie.at(-1)
    const grupoDe = (t, i) => (ultima.grupos
      ? (ultima.grupos.crecen?.includes(t) ? 'crecen' : ultima.grupos.buscadas?.includes(t) ? 'buscadas' : 'suben')
      : i < 10 ? 'crecen' : 'en-la-lista')
    const todos = ultima.grupos ? [...new Set([...(ultima.grupos.crecen ?? []), ...(ultima.grupos.buscadas ?? []), ...(ultima.grupos.suben ?? [])])] : (ultima.terminos ?? [])
    todos.forEach((termino, i) => salida.push({ termino, categoria: categorias.get(categoriaId).ruta, grupo: grupoDe(termino, i), dia: ultima.dia,
      semanas: serie.filter((c) => (c.terminos ?? []).includes(termino) || Object.values(c.grupos ?? {}).some((g) => g?.includes?.(termino))).length, de: serie.length }))
  }
  return salida
}

export async function tendenciasAnchas({ ahora = new Date(), semanas = 4 } = {}) {
  const desde = diaChile(+ahora - semanas * 7 * DIA)
  const anchas = await CategoriaMl.find({ $or: [{ padreId: null }, { padreId: { $in: (await CategoriaMl.find({ padreId: null }).select('id').lean()).map((r) => r.id) } }] }).select('id ruta').lean()
  const categorias = new Map(anchas.map((c) => [c.id, c]))
  const capturas = await TendenciaCategoria.find({ categoriaId: { $in: anchas.map((c) => c.id) }, dia: { $gte: desde } }).select('categoriaId dia terminos grupos').lean()
  return { categorias: new Set(capturas.map((c) => c.categoriaId)).size, terminos: terminosDeAnchas(capturas, categorias) }
}

// BARRIDO DEL VOCABULARIO DE TEMPORADA (8-oct-2026). Toma la última captura de
// tendencias de cada categoría, clasifica cada término y cuenta las palabras de
// los que quedaron como "novedad": ahí aparecen las palabras de temporada que
// el calendario todavía no reconoce. Solo lectura.
const VACIAS = new Set(['de', 'para', 'con', 'sin', 'y', 'el', 'la', 'los', 'las', 'en', 'un', 'una', 'por', 'al', 'del', 'mujer', 'hombre', 'nino', 'nina', 'ninos', 'ninas'])
export async function barridoVocabulario({ hoy = new Date(), max = 400 } = {}) {
  const docs = await TendenciaCategoria.find({}).sort({ dia: -1 }).select('categoriaId dia terminos').lean()
  const ultima = new Map()
  for (const d of docs) if (!ultima.has(d.categoriaId)) ultima.set(d.categoriaId, d)
  const rutas = new Map((await CategoriaMl.find({ id: { $in: [...ultima.keys()] } }).select('id ruta').lean()).map((c) => [c.id, c.ruta]))
  const porTipo = {}, palabras = new Map(), ejemplos = new Map(), porTemporada = {}, estacionales = new Map()
  let total = 0
  for (const [categoriaId, d] of ultima) {
    const ruta = rutas.get(categoriaId) ?? ''
    for (const t of d.terminos ?? []) {
      total++
      const c = clasificarBusqueda(t, temporadaDe(`${t} ${ruta.split(' > ').at(-1)}`, hoy))
      porTipo[c.tipo] = (porTipo[c.tipo] ?? 0) + 1
      if (c.temporada) porTemporada[c.temporada] = (porTemporada[c.temporada] ?? 0) + 1
      if (c.tipo !== 'novedad') {
        // el otro lado: qué palabra hizo estacional a cada término (para cazar
        // falsos positivos: "cooler" de PC, "ventilador" de radiador)
        const k = `${c.temporada}|${t}`
        if (!estacionales.has(k)) estacionales.set(k, { temporada: c.temporada, termino: t, categoria: ruta.split(' > ').slice(-1)[0] })
        continue
      }
      for (const w of new Set(String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((x) => x.length >= 4 && !VACIAS.has(x)))) {
        palabras.set(w, (palabras.get(w) ?? 0) + 1)
        if (!ejemplos.has(w)) ejemplos.set(w, `${t} · ${ruta.split(' > ').slice(-1)[0]}`)
      }
    }
  }
  return { categorias: ultima.size, total, porTipo, porTemporada,
    palabras: [...palabras].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w, n]) => ({ w, n, ej: ejemplos.get(w) })),
    estacionales: [...estacionales.values()] }
}

export async function estadoPanorama({ ahora = new Date() } = {}) {
  const dia = diaChile(ahora)
  const [total, pendientes, hojas, rankingHoy, tendencias, diasRanking] = await Promise.all([
    CategoriaMl.countDocuments(), CategoriaMl.countDocuments({ actualizadoEl: null }),
    CategoriaMl.countDocuments({ hoja: true, totalItems: { $gte: MIN_ITEMS_CATEGORIA } }),
    RankingMasVendidos.countDocuments({ dia }), TendenciaCategoria.countDocuments({}),
    RankingMasVendidos.distinct('dia'),
  ])
  const guardada = ultimaPasada ? null : await PasadaPanorama.findOne().sort({ en: -1 }).lean().catch(() => null)
  const [sinRanking, sinTendencias] = await Promise.all([
    CategoriaMl.countDocuments({ sinRankingHasta: { $gt: ahora } }), CategoriaMl.countDocuments({ sinTendenciasHasta: { $gt: ahora } }),
  ])
  return { dia, ultimaPasada: ultimaPasada ?? (guardada ? { ...guardada.resultado, en: guardada.en } : null), sinPublicar: { ranking: sinRanking, tendencias: sinTendencias }, arbol: { total, pendientes }, hojasConVolumen: hojas, rankingHoy, capturasDeTendencias: tendencias, diasDeRanking: diasRanking.length,
    busquedasQueSuben: await busquedasQueSuben({ max: 15 }).catch(() => []) }
}
