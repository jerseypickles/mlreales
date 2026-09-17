import { RankingMasVendidos, FichaMasVendido } from '../models/RankingMasVendidos.js'
import { Nicho } from '../models/Nicho.js'
import { Producto } from '../models/Producto.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { masVendidosDeCategoria } from './senalesOficiales.js'
import { meliGet } from './meli.js'
import { diaChile } from './inventarioFull.js'

const DIA = 86400e3

// Las categorías que importan: la dominante del listado de cada nicho activo y
// las de los productos propios. categoriaId → [keywords de nicho].
export async function categoriasDelTablero() {
  const nichos = await Nicho.find({ estado: 'activo' }).select('keyword').lean()
  const filas = await Producto.aggregate([
    { $match: { keywordOrigen: { $in: nichos.map((n) => n.keyword) }, categoriaML: { $ne: null } } },
    { $group: { _id: { k: '$keywordOrigen', c: '$categoriaML' }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ])
  const dominante = new Map()
  for (const f of filas) if (!dominante.has(f._id.k)) dominante.set(f._id.k, f._id.c)
  const porCategoria = new Map()
  for (const [keyword, cat] of dominante) porCategoria.set(cat, [...(porCategoria.get(cat) ?? []), keyword])
  for (const p of await ProductoPropio.find({ categoriaMl: { $ne: null } }).select('categoriaMl').lean()) {
    if (!porCategoria.has(p.categoriaMl)) porCategoria.set(p.categoriaMl, [])
  }
  return porCategoria
}

// El ranking trae ids pelados. Primero se busca en lo que ya se escaneó (gratis
// y con foto); lo que falte y sea producto de catálogo se le pregunta a la API
// oficial, que responde para catálogos de terceros. Las publicaciones sueltas
// ajenas dan 403: quedan con su enlace y sin nombre.
async function resolverFichas(ids, { ahora = new Date(), pedir = meliGet } = {}) {
  const conocidas = new Map((await FichaMasVendido.find({ id: { $in: ids.map((i) => i.id) } }).lean()).map((f) => [f.id, f]))
  const faltan = ids.filter((i) => !conocidas.get(i.id)?.titulo && (conocidas.get(i.id)?.intentos ?? 0) < 3)
  if (!faltan.length) return 0
  const buscados = faltan.map((i) => i.id)
  const enScan = await Producto.find({ $or: [{ sku: { $in: buscados } }, { itemId: { $in: buscados } }, { catalogId: { $in: buscados } }] })
    .select('sku itemId catalogId titulo imagen url').lean()
  const porId = new Map()
  for (const p of enScan) for (const k of [p.sku, p.itemId, p.catalogId]) if (k && !porId.has(k)) porId.set(k, p)
  let resueltas = 0
  for (const { id, tipo } of faltan) {
    let ficha = null
    const p = porId.get(id)
    if (p?.titulo) ficha = { titulo: p.titulo, imagen: p.imagen ?? null, url: p.url ?? null, fuente: 'scan' }
    else if (tipo === 'catalogo') {
      try {
        const r = await pedir(`/products/${id}`)
        if (r?.name) ficha = { titulo: r.name, imagen: r.pictures?.[0]?.url?.replace(/^http:/, 'https:') ?? null, precio: r.buy_box_winner?.price ?? null,
          url: r.permalink ?? `https://www.mercadolibre.cl/p/${id}`, fuente: 'catalogo' }
      } catch { /* sin ficha: queda el enlace */ }
    }
    // la url va SOLO en $set: repetirla en $setOnInsert es un conflicto de ruta
    // que Mongo rechaza, y como el error se tragaba, ninguna ficha se resolvía
    const url = ficha?.url ?? (tipo === 'catalogo' ? `https://www.mercadolibre.cl/p/${id}` : `https://articulo.mercadolibre.cl/${id.replace(/^MLC/, 'MLC-')}`)
    await FichaMasVendido.updateOne({ id }, { $set: { tipo, ...(ficha ?? {}), url, ...(ficha ? { resueltoEl: ahora } : {}) }, $inc: { intentos: 1 } }, { upsert: true })
    if (ficha) resueltas++
  }
  return resueltas
}

// Una vez al día por categoría. Gratis: es la API oficial.
export async function capturarRankings({ ahora = new Date(), obtener = masVendidosDeCategoria } = {}) {
  const dia = diaChile(ahora)
  const categorias = await categoriasDelTablero()
  const hechas = new Set((await RankingMasVendidos.find({ dia }).select('categoriaId').lean()).map((r) => r.categoriaId))
  let capturadas = 0, sinRespuesta = 0, fichas = 0
  for (const [categoriaId, nichos] of categorias) {
    if (hechas.has(categoriaId)) continue
    const items = await obtener(categoriaId)
    if (!items?.length) { sinRespuesta++; continue }
    await RankingMasVendidos.updateOne({ categoriaId, dia }, { $setOnInsert: { categoriaId, dia, nichos, items, capturadoEl: ahora } }, { upsert: true })
    fichas += await resolverFichas(items, { ahora }).catch((err) => { console.warn(`[ranking] fichas de ${categoriaId}: ${err.message}`); return 0 })
    capturadas++
  }
  // lo ya capturado hoy que siga sin nombre (una corrida anterior que falló)
  if (!capturadas) {
    for (const r of await RankingMasVendidos.find({ dia }).select('items categoriaId').lean()) {
      fichas += await resolverFichas(r.items, { ahora }).catch((err) => { console.warn(`[ranking] fichas de ${r.categoriaId}: ${err.message}`); return 0 })
    }
  }
  return { dia, categorias: categorias.size, capturadas, yaEstaban: hechas.size, sinRespuesta, fichasResueltas: fichas }
}

// Pura. Qué se movió entre dos rankings de la misma categoría.
export function movimientosDeRanking(hoy, antes) {
  const previo = new Map((antes ?? []).map((i) => [i.id, i.posicion]))
  return (hoy ?? []).map((i) => {
    const p = previo.get(i.id)
    return { ...i, posicionAntes: p ?? null, nuevo: antes ? p == null : false, subio: p != null ? p - i.posicion : 0 }
  })
}

// El ranking de hoy de cada categoría comparado contra el de hace ~7 días (o el
// más viejo que haya), con la ficha de cada producto y en cuántos días de los
// guardados estuvo en el top.
export async function rankingsConMovimiento({ ahora = new Date(), dias = 7, nicho = null } = {}) {
  const desde = diaChile(+ahora - 35 * DIA)
  const filtro = { dia: { $gte: desde }, ...(nicho ? { nichos: nicho } : {}) }
  const docs = await RankingMasVendidos.find(filtro).sort({ dia: 1 }).lean()
  const porCat = new Map()
  for (const d of docs) porCat.set(d.categoriaId, [...(porCat.get(d.categoriaId) ?? []), d])
  const ids = new Set()
  const salida = []
  for (const [categoriaId, serie] of porCat) {
    const ultimo = serie.at(-1)
    const objetivo = diaChile(+new Date(`${ultimo.dia}T12:00:00Z`) - dias * DIA)
    const base = serie.length > 1 ? [...serie].reverse().find((d) => d.dia <= objetivo) ?? serie[0] : null
    const presencia = new Map()
    for (const d of serie) for (const i of d.items) presencia.set(i.id, (presencia.get(i.id) ?? 0) + 1)
    const items = movimientosDeRanking(ultimo.items, base && base.dia !== ultimo.dia ? base.items : null)
      .map((i) => ({ ...i, diasEnElTop: presencia.get(i.id), diasGuardados: serie.length }))
    items.forEach((i) => ids.add(i.id))
    salida.push({ categoriaId, nichos: ultimo.nichos, dia: ultimo.dia, comparadoCon: base && base.dia !== ultimo.dia ? base.dia : null, diasGuardados: serie.length, items })
  }
  const fichas = new Map((await FichaMasVendido.find({ id: { $in: [...ids] } }).lean()).map((f) => [f.id, f]))
  for (const c of salida) c.items = c.items.map((i) => ({ ...i, titulo: fichas.get(i.id)?.titulo ?? null, imagen: fichas.get(i.id)?.imagen ?? null,
    precio: fichas.get(i.id)?.precio ?? null, url: fichas.get(i.id)?.url ?? null, enNuestroScan: fichas.get(i.id)?.fuente === 'scan' }))
  return salida
}

// Lo que el radar lee: productos que ENTRARON al top 20 o subieron fuerte, con
// nombre. Vacío hasta que haya dos días guardados — no se inventa movimiento.
export async function entradasAlTop({ ahora = new Date(), max = 25 } = {}) {
  const cats = await rankingsConMovimiento({ ahora })
  return cats.flatMap((c) => c.items.filter((i) => c.comparadoCon && i.titulo && (i.nuevo || i.subio >= 5))
    .map((i) => ({ titulo: i.titulo, posicion: i.posicion, nuevo: i.nuevo, subio: i.subio, nichos: c.nichos, desde: c.comparadoCon })))
    .sort((a, b) => a.posicion - b.posicion).slice(0, max)
}
