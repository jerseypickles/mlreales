import { CategoriaMl, TendenciaCategoria } from '../models/CategoriaMl.js'
import { RankingMasVendidos } from '../models/RankingMasVendidos.js'
import { meliGet } from './meli.js'
import { normalizarDestacados, normalizarTendencias } from './senalesOficiales.js'
import { categoriasDelTablero, resolverFichas, movimientosDeRanking } from './rankingMasVendidos.js'
import { diaChile } from './inventarioFull.js'

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
const PAUSA_MS = 250
const PAUSA_429_MS = 6000
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

// una consulta que distingue "ML me frenó" (reintentar después) de "no hay dato"
async function pedir(ruta, obtener = meliGet) {
  try {
    return { datos: await obtener(ruta) }
  } catch (err) {
    return { frenado: /\b429\b|too many/i.test(err.message), error: err.message }
  }
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
  const hojas = await CategoriaMl.find({ hoja: true, totalItems: { $gte: MIN_ITEMS_CATEGORIA } }).select('id').sort({ totalItems: -1 }).lean()
  const hechas = new Set(await RankingMasVendidos.distinct('categoriaId', { dia }))
  const ultima = new Map((await RankingMasVendidos.aggregate([{ $group: { _id: '$categoriaId', dia: { $max: '$dia' } } }])).map((x) => [x._id, x.dia]))
  const delTablero = await categoriasDelTablero().catch(() => new Map())
  const pendientes = hojasQueTocan(hojas, ultima, dia).slice(0, porPasada)
  // el tiempo de las tendencias se reserva antes de que el ranking lo consuma
  const presupuestoRanking = presupuestoMs * 0.8
  let capturadas = 0, frenos = 0, movidas = 0
  for (const { id } of pendientes) {
    if (Date.now() - inicio > presupuestoRanking) break
    const r = await pedir(`/highlights/MLC/category/${id}`, obtener)
    if (r.frenado) { frenos++; await esperar(PAUSA_429_MS); continue }
    const items = normalizarDestacados(r.datos)
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
  // búsquedas que suben: una vez por semana por categoría
  const vencida = diaChile(+ahora - REFRESCO_TENDENCIAS_DIAS * DIA)
  const conTendencia = new Set(await TendenciaCategoria.distinct('categoriaId', { dia: { $gt: vencida } }))
  let tendencias = 0, erroresTendencia = 0, vaciasTendencia = 0, ultimoErrorTendencia = null
  const candidatasTendencia = hojas.filter((h) => !conTendencia.has(h.id)).length
  for (const { id } of hojas.filter((h) => !conTendencia.has(h.id)).slice(0, TENDENCIAS_POR_PASADA)) {
    if (Date.now() - inicio > presupuestoMs) break
    const r = await pedir(`/trends/MLC/${id}`, obtener)
    if (r.frenado) { frenos++; await esperar(PAUSA_429_MS); continue }
    if (r.error) { erroresTendencia++; ultimoErrorTendencia = r.error }
    const terminos = normalizarTendencias(r.datos)
    if (!r.error && !terminos.length) vaciasTendencia++
    if (terminos.length) { await TendenciaCategoria.updateOne({ categoriaId: id, dia }, { $setOnInsert: { categoriaId: id, dia, terminos, capturadoEl: ahora } }, { upsert: true }); tendencias++ }
    await esperar(PAUSA_MS)
  }
  const resultado = { dia, arbol, hojasConVolumen: hojas.length, rankingHoy: hechas.size + capturadas, capturadas, movidas, tendencias, frenos,
    tendenciaDiag: { candidatas: candidatasTendencia, errores: erroresTendencia, vacias: vaciasTendencia, ultimoError: ultimoErrorTendencia, segundos: Math.round((Date.now() - inicio) / 1000) } }
  ultimaPasada = { ...resultado, en: new Date() }
  console.log(`[panorama] ${dia}: ranking ${resultado.rankingHoy}/${hojas.length} categorías (+${capturadas}, ${movidas} movimientos), ${tendencias} tendencias, ${frenos} frenos${arbol ? ` · árbol ${arbol.total} (${arbol.pendientes} por leer)` : ''}`)
  return resultado
}

// Pura. Términos que aparecen en la última captura y no estaban en la anterior.
export function terminosNuevos(ultima, anterior) {
  const antes = new Set(anterior ?? [])
  return (ultima ?? []).filter((t) => !antes.has(t))
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
      salida.push({ termino: t, categoria: nombres.get(categoriaId)?.ruta ?? categoriaId, totalItems: nombres.get(categoriaId)?.totalItems ?? 0 })
    }
  }
  return salida.sort((a, b) => b.totalItems - a.totalItems).slice(0, max)
}

export async function estadoPanorama({ ahora = new Date() } = {}) {
  const dia = diaChile(ahora)
  const [total, pendientes, hojas, rankingHoy, tendencias, diasRanking] = await Promise.all([
    CategoriaMl.countDocuments(), CategoriaMl.countDocuments({ actualizadoEl: null }),
    CategoriaMl.countDocuments({ hoja: true, totalItems: { $gte: MIN_ITEMS_CATEGORIA } }),
    RankingMasVendidos.countDocuments({ dia }), TendenciaCategoria.countDocuments({}),
    RankingMasVendidos.distinct('dia'),
  ])
  return { dia, ultimaPasada, arbol: { total, pendientes }, hojasConVolumen: hojas, rankingHoy, capturasDeTendencias: tendencias, diasDeRanking: diasRanking.length,
    busquedasQueSuben: await busquedasQueSuben({ max: 15 }).catch(() => []) }
}
