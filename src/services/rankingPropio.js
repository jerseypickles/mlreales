// EL RANKING DONDE COMPITE CADA PUBLICACIÓN PROPIA (20-nov-2026).
//
// Pedido del dueño, mirando «Quién vende lo mismo» de una publicación suya: «cuando revisamos dentro debería mostrar
// las que se asimilan, y yo aquí estoy viendo una que se asimila pero no entró dentro del producto», con el enlace de
// la página donde la vio: los más vendidos de la categoría de su publicación, filtrados por su marca. Es la página a
// la que lleva el cartel «N.º más vendido» de cada publicación.
//
// Los candidatos de esa vista salían de una sola fuente: el último scan de la búsqueda del nicho. Medido ese día con
// esa publicación: ni ella ni las que venden su mismo producto aparecían entre las doscientas primeras de la búsqueda
// de su nicho, y en el ranking de su categoría y marca estaban todas entre las diez primeras. La búsqueda de un nicho
// es una frase; el ranking de la categoría y la marca es donde Mercado Libre pone a competir a la publicación.
//
// Acá se lee esa página con el lector del ranking web (masVendidosWeb.leerMasVendidos: una página de listado cada
// vez) para cada par categoría y marca donde hay una publicación propia vigente, una vez por semana, y se guarda cada
// lectura. iguales.js suma esas publicaciones a los candidatos; con las lecturas guardadas también sale el puesto de
// la publicación propia y la historia de precio de cada rival.
import { RankingPropio } from '../models/RankingPropio.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { leerMasVendidos, urlMasVendidos } from './masVendidosWeb.js'
import { marcaDeItem } from './marcaMl.js'
import { diaChile } from './inventarioFull.js'
import { config } from '../config/env.js'
import { FILTRO_VIGENTES } from '../../frontend/src/lib/catalogoPropios.js'

const DIA = 86400e3
// cada cuánto se vuelve a leer el ranking de un par
export const DIAS_ENTRE_LECTURAS = 7
// hasta cuándo una lectura sirve para proponer candidatos: pasado eso ya no dice quién vende hoy
export const DIAS_VIGENTE = 21
// lecturas que se miran hacia atrás para la historia de precio y para lo último que se supo de un rival
const LECTURAS_ATRAS = 12

// Pura. La parte de la dirección que identifica el ranking: la categoría sola o filtrada por la marca.
export const rutaDeRanking = ({ categoriaId, marcaId = null }) => (marcaId ? `${categoriaId}?attribute_id=BRAND&attribute_value_id=${marcaId}` : categoriaId)
export const urlDeRanking = (par) => urlMasVendidos(rutaDeRanking(par))

// Pura. El ranking de una publicación propia: su categoría y su marca. Null mientras falte alguna de las dos (la marca
// se anota en la medición: antes de eso no se sabe si el ranking va filtrado).
export function parDePropio(propio) {
  if (!propio?.categoriaMl || !propio.marcaMl) return null
  return { categoriaId: propio.categoriaMl, marcaId: propio.marcaMl.id ?? null }
}
const llave = (par) => `${par.categoriaId}|${par.marcaId ?? ''}`

// Los pares donde hay una publicación propia vigente.
export async function paresDePropios() {
  const propios = await ProductoPropio.find({ estado: 'activo', ...FILTRO_VIGENTES, categoriaMl: { $ne: null }, marcaMl: { $ne: null } }).select('categoriaMl marcaMl').lean()
  const pares = new Map()
  for (const p of propios) { const par = parDePropio(p); if (par) pares.set(llave(par), par) }
  return [...pares.values()]
}

// Pura. Qué pares toca leer: los que nunca se leyeron y los que llevan `dias` o más sin leerse, el más atrasado
// primero. ultima: Map(llave del par → fecha de su última lectura).
export function paresQueTocan(pares, ultima, { ahora = new Date(), dias = DIAS_ENTRE_LECTURAS, intentos = new Map() } = {}) {
  const corte = +ahora - dias * DIA
  // entre los que tocan, primero el que lleva más tiempo sin que se lo lea NI se lo intente
  return pares.map((par) => ({ par, leido: ultima.get(llave(par)) ? +new Date(ultima.get(llave(par))) : 0, intentado: +(intentos.get(llave(par)) ?? 0) }))
    .filter((x) => x.leido <= corte).sort((a, b) => Math.max(a.leido, a.intentado) - Math.max(b.leido, b.intentado)).map((x) => x.par)
}

// Lee el ranking de un par y guarda la lectura del día. `leer` y `gastos` se inyectan en los tests.
//
// NO TODAS LAS CATEGORÍAS TIENEN EL RANKING FILTRADO POR MARCA (20-nov-2026, la primera tarde en producción). En una
// categoría propia la página filtrada llegó bien pero era la página de error de Mercado Libre, sin ranking, y la de
// la categoría entera sí lo traía, con los rivales directos. Cuando la filtrada llega sin ranking se lee la de la
// categoría (`sinFiltro`), y la vez siguiente se va directo a esa: la página vacía también se cobra. Si tampoco la
// categoría tiene ranking se guarda la lectura vacía, para no pagarla de nuevo en cada pasada.
export async function leerRankingPropio(par, { ahora = new Date(), leer = leerMasVendidos, gastos = null, hasta = Infinity } = {}) {
  const { registrarGasto } = gastos ?? await import('./gastos.js')
  const filtro = { categoriaId: par.categoriaId, marcaId: par.marcaId ?? null }
  const anterior = par.marcaId ? await RankingPropio.findOne(filtro).sort({ dia: -1 }).select('sinFiltro').lean() : null
  let items = null, sinFiltro = !par.marcaId || Boolean(anterior?.sinFiltro)
  if (!sinFiltro) {
    try {
      items = await leer(rutaDeRanking(par), { hasta, cortarSinRanking: true })
    } catch (err) {
      if (!err.sinRanking) throw err
      await registrarGasto(null, config.zyteCostoListadoUsd, 'zyte') // la página llegó (y se cobra), pero sin ranking
      sinFiltro = true
    }
  }
  if (!items) {
    try {
      items = await leer(par.categoriaId, { hasta, cortarSinRanking: true })
    } catch (err) {
      if (!err.sinRanking) throw err
      items = []
    }
  }
  const dia = diaChile(ahora)
  await RankingPropio.updateOne({ ...filtro, dia }, { $set: { leidoEl: ahora, items, sinFiltro: Boolean(par.marcaId) && sinFiltro } }, { upsert: true })
  await registrarGasto(null, config.zyteCostoListadoUsd, 'zyte')
  return { ...par, dia, publicaciones: items.length, ...(par.marcaId && sinFiltro ? { sinFiltro: true } : {}) }
}

// Lo último que se intentó de cada par, en memoria: una página que no llega corta la pasada (el sitio está ocupado),
// y sin esto la pasada siguiente partía otra vez por el mismo par: uno que falla siempre dejaba esperando a todos.
const intentadoEl = new Map()

// La pasada: lee los rankings que tocan, de a pocos. Comparte el sitio con los scans, así que cede igual que el
// ranking que descubre (masVendidosWeb.js): no lee mientras un scan le pide páginas a Mercado Libre, y si una página
// no llega, corta y sigue en la próxima pasada. Son pocos pares y una lectura por semana cada uno: no lleva tope
// propio, solo el techo del mes.
export async function pasadaRankingPropios({ ahora = new Date(), max = 2, leer = leerMasVendidos, gastos = null, scansActivos = null, presupuestoMs = 120_000 } = {}) {
  if (!config.masVendidosWebActivo) return { omitido: true, motivo: 'apagado (MAS_VENDIDOS_WEB_ACTIVO)' }
  if (!config.zyteApiKey && leer === leerMasVendidos) return { omitido: true, motivo: 'sin ZYTE_API_KEY' }
  const pares = await paresDePropios()
  const ultima = new Map((await RankingPropio.aggregate([{ $group: { _id: { c: '$categoriaId', m: '$marcaId' }, el: { $max: '$leidoEl' } } }])).map((x) => [llave({ categoriaId: x._id.c, marcaId: x._id.m }), x.el]))
  const tocan = paresQueTocan(pares, ultima, { ahora, intentos: intentadoEl })
  if (!tocan.length) return { pares: pares.length, leidos: 0, pendientes: 0 }
  const { presupuesto } = gastos ?? await import('./gastos.js')
  const { scraping } = await presupuesto()
  if (scraping.agotado) return { omitido: true, motivo: scraping.motivo, pendientes: tocan.length }
  const corriendo = scansActivos ? await Promise.resolve().then(scansActivos).catch(() => 0) : 0
  if (corriendo > 0) return { omitido: true, motivo: `hay ${corriendo} ${corriendo === 1 ? 'scan' : 'scans'} leyendo Mercado Libre`, pendientes: tocan.length }
  const hasta = Date.now() + presupuestoMs
  let leidos = 0, sinLlegar = null
  for (const par of tocan.slice(0, max)) {
    if (Date.now() > hasta) break
    intentadoEl.set(llave(par), +ahora)
    try {
      await leerRankingPropio(par, { ahora, leer, gastos, hasta })
      leidos++
    } catch (err) {
      sinLlegar = err.message
      console.warn(`[ranking-propios] ${err.message}`)
      break
    }
  }
  console.log(`[ranking-propios] ${leidos} de ${tocan.length} rankings leídos (${pares.length} pares con publicación propia)${sinLlegar ? ' · uno no llegó: sigue en la próxima pasada' : ''}`)
  return { pares: pares.length, leidos, sinLlegar, pendientes: tocan.length - leidos }
}

// A pedido del dueño desde la pantalla: lee ahora el ranking de la categoría y la marca de esa publicación. Si la
// marca todavía no está anotada se le pregunta a Mercado Libre (por el servidor, que es el único que usa el token).
// Una lectura por día alcanza: si ya se leyó hoy, no se paga otra.
export async function traerRankingDe(propio, { ahora = new Date(), leer = leerMasVendidos, pedirMl = null, gastos = null, presupuestoMs = 150_000 } = {}) {
  const error = (mensaje, status) => Object.assign(new Error(mensaje), { status })
  if (!propio?.categoriaMl || propio.esCandidato) throw error('Todavía no sé en qué categoría de Mercado Libre está este producto: los más vendidos se pueden traer cuando esté publicado y medido.', 409)
  let marca = propio.marcaMl ?? null
  if (!marca) {
    const pedir = pedirMl ?? (await import('./meli.js')).meliGet
    marca = marcaDeItem(await pedir(`/items/${propio.itemIdMl ?? propio.sku}`).catch(() => null))
    if (!marca) throw error('Mercado Libre no respondió con la marca de la publicación. Prueba de nuevo en un rato.', 502)
    await ProductoPropio.updateOne({ _id: propio._id }, { $set: { marcaMl: marca } })
  }
  const par = { categoriaId: propio.categoriaMl, marcaId: marca.id ?? null }
  if (await RankingPropio.exists({ categoriaId: par.categoriaId, marcaId: par.marcaId, dia: diaChile(ahora) })) return { ...par, yaLeidoHoy: true }
  try {
    return await leerRankingPropio(par, { ahora, leer, gastos, hasta: Date.now() + presupuestoMs })
  } catch (err) {
    throw error('Mercado Libre no entregó la página de más vendidos en este intento (pasa cuando hay scans corriendo). Prueba de nuevo en unos minutos.', 502)
  }
}

// Lo que la vista de un producto propio necesita de su ranking: las publicaciones de la última lectura (si sigue
// vigente), lo último que se supo de las que ya no están y el precio de cada una en las lecturas guardadas.
export async function rankingDePropio(propio, { ahora = new Date() } = {}) {
  const par = parDePropio(propio)
  if (!par) return propio?.categoriaMl && !propio.esCandidato ? { categoriaId: propio.categoriaMl, marcaId: null, sinMarca: true, url: null, leidoEl: null, vigente: false, items: [], anteriores: new Map(), historia: new Map() } : null
  const lecturas = await RankingPropio.find({ categoriaId: par.categoriaId, marcaId: par.marcaId }).sort({ dia: -1 }).limit(LECTURAS_ATRAS).lean()
  const ultima = lecturas[0] ?? null
  const vigente = Boolean(ultima) && +ahora - +new Date(ultima.leidoEl) <= DIAS_VIGENTE * DIA
  const anteriores = new Map(), historia = new Map()
  for (const l of vigente ? lecturas.slice(1) : lecturas) for (const it of l.items ?? []) if (it?.id && !anteriores.has(it.id)) anteriores.set(it.id, { ...it, vistoEl: l.leidoEl })
  for (const l of [...lecturas].reverse()) for (const it of l.items ?? []) {
    if (!it?.id || !(it.precio > 0)) continue
    if (!historia.has(it.id)) historia.set(it.id, [])
    historia.get(it.id).push({ dia: l.dia, precio: it.precio })
  }
  // la dirección es la de la página que de verdad se leyó: la de la categoría entera cuando la filtrada no existe
  const url = urlDeRanking(ultima?.sinFiltro ? { categoriaId: par.categoriaId } : par)
  return { ...par, url, sinFiltro: Boolean(ultima?.sinFiltro), leidoEl: ultima?.leidoEl ?? null, vigente, items: vigente ? ultima.items ?? [] : [], anteriores, historia }
}

// Pura. Una publicación del ranking con la forma de las del scan de un nicho, para que la vista las trate igual.
export const productoDeRanking = (it) => ({
  sku: it.id, itemId: it.itemId ?? null, titulo: it.titulo ?? null, precio: it.precio ?? null, imagen: it.imagen ?? null, url: it.url ?? null,
  posicion: null, vendidos: it.vendidos ?? null, numReviews: null, esFull: null, esTiendaOficial: it.tiendaOficial || null, vendedor: it.vendedor ?? null,
  puestoRanking: it.posicion ?? null, soloRanking: true,
})
