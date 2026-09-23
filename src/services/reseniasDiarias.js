import { Snapshot } from '../models/Snapshot.js'
import { Producto } from '../models/Producto.js'
import { LecturaResenia } from '../models/LecturaResenia.js'
import { conteosPorItem } from './reviewsApi.js'
import { diaChile } from './inventarioFull.js'

// RESEÑAS DE LA COMPETENCIA, TODOS LOS DÍAS Y GRATIS.
//
// El modelo de competidores aprende de la velocidad de reseñas nuevas, y hoy
// cada publicación se lee una vez por scan (~cada 6 días). La API de reseñas
// no cuesta nada: el único límite es que ML frena tras ~115 consultas seguidas
// (reviewsApi.js ya lo maneja). Leyendo a diario el panel activo, cada
// publicación da una etiqueta de 7 días exactos desde cualquier scan, en vez de
// esperar al scan siguiente.
//
// Se reparte en pasadas cortas cada hora: la cola de tendencias corre de a un
// trabajo y la cuota de ML la comparten el scan de propios y las órdenes.

export const PANEL_MAX = 5000
export const VENTANA_PANEL_DIAS = 14
const POR_PASADA = 400
const PRESUPUESTO_MS = 4 * 60e3

// Pura. El panel: publicaciones vistas en los scans recientes, con su item de
// ML, priorizando la mejor posición alcanzada (lo que vende está arriba).
export function elegirPanel(vistas, productos, { max = PANEL_MAX } = {}) {
  const item = new Map(productos.filter((p) => /^MLC\d+$/.test(p.itemId ?? '')).map((p) => [p.sku, p.itemId]))
  const mejor = new Map()
  for (const v of vistas) {
    const id = item.get(v.sku)
    if (!id) continue
    const pos = Number.isFinite(v.posicion) ? v.posicion : 999
    const previo = mejor.get(id)
    if (!previo || pos < previo.posicion) mejor.set(id, { itemId: id, sku: v.sku, posicion: pos })
  }
  return [...mejor.values()].sort((a, b) => a.posicion - b.posicion || a.itemId.localeCompare(b.itemId)).slice(0, max)
}

// el panel cambia con los scans, no con la hora: se arma una vez por día
let panelDelDia = null
async function panelActual(ahora) {
  const dia = diaChile(ahora)
  if (panelDelDia?.dia === dia) return panelDelDia.panel
  const vistas = await Snapshot.aggregate([
    { $match: { fecha: { $gte: new Date(+ahora - VENTANA_PANEL_DIAS * 86400e3) } } },
    { $group: { _id: '$sku', posicion: { $min: '$posicion' } } },
  ])
  const productos = await Producto.find({ sku: { $in: vistas.map((v) => v._id) } }).select('sku itemId -_id').lean()
  const panel = elegirPanel(vistas.map((v) => ({ sku: v._id, posicion: v.posicion })), productos)
  panelDelDia = { dia, panel }
  return panel
}

export async function pasadaResenias({ ahora = new Date(), porPasada = POR_PASADA, presupuestoMs = PRESUPUESTO_MS, contar } = {}) {
  const dia = diaChile(ahora)
  const panel = await panelActual(ahora)
  const hechas = new Set(await LecturaResenia.distinct('itemId', { dia }))
  const pendientes = panel.filter((p) => !hechas.has(p.itemId)).slice(0, porPasada)
  if (!pendientes.length) return { dia, panel: panel.length, leidasHoy: hechas.size, pedidas: 0, guardadas: 0 }
  const porItem = await conteosPorItem(pendientes.map((p) => p.itemId), { presupuestoMs, concurrencia: 2, ...(contar ? { contar } : {}) })
  const sku = new Map(pendientes.map((p) => [p.itemId, p.sku]))
  const ops = [...porItem].map(([itemId, numReviews]) => ({ updateOne: {
    filter: { itemId, dia }, update: { $setOnInsert: { itemId, sku: sku.get(itemId), dia, numReviews, leidaEl: ahora } }, upsert: true,
  } }))
  const r = ops.length ? await LecturaResenia.bulkWrite(ops, { ordered: false }) : { upsertedCount: 0 }
  const resultado = { dia, panel: panel.length, leidasHoy: hechas.size + r.upsertedCount, pedidas: pendientes.length, guardadas: r.upsertedCount }
  console.log(`[resenias-diarias] ${dia}: ${resultado.guardadas}/${resultado.pedidas} leídas · ${resultado.leidasHoy}/${resultado.panel} del panel hoy`)
  return resultado
}

export async function estadoResenias({ ahora = new Date() } = {}) {
  const dia = diaChile(ahora)
  const [porDia, leidasHoy] = await Promise.all([
    LecturaResenia.aggregate([{ $group: { _id: '$dia', lecturas: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 14 }]),
    LecturaResenia.countDocuments({ dia }),
  ])
  return { dia, leidasHoy, porDia: porDia.map((d) => ({ dia: d._id, lecturas: d.lecturas })) }
}
