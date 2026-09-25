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
  // CALIDAD: entre los dos últimos días completos, un contador acumulado solo
  // sube o queda igual; una baja es anomalía (reseña borrada o cambio de fuente)
  let comparacion = null
  const dias = porDia.map((d) => d._id).sort()
  if (dias.length >= 2) {
    const [a, b] = dias.slice(-2)
    const filas = await LecturaResenia.find({ dia: { $in: [a, b] } }).select('itemId dia numReviews -_id').lean()
    const antes = new Map(filas.filter((f) => f.dia === a).map((f) => [f.itemId, f.numReviews]))
    let ambos = 0, suben = 0, bajan = 0, iguales = 0, nuevas = 0
    const saltos = []
    for (const f of filas.filter((x) => x.dia === b)) {
      if (!antes.has(f.itemId)) continue
      ambos++
      const d = f.numReviews - antes.get(f.itemId)
      if (d > 0) { suben++; nuevas += d; saltos.push({ itemId: f.itemId, antes: antes.get(f.itemId), ahora: f.numReviews, delta: d }) } else if (d < 0) bajan++; else iguales++
    }
    // ¿lo nuevo lo explican muchas publicaciones o unas pocas con saltos raros?
    saltos.sort((x, y) => y.delta - x.delta)
    const deltas = saltos.map((x) => x.delta).sort((x, y) => x - y)
    const top10 = saltos.slice(0, 10).reduce((acc, x) => acc + x.delta, 0)
    comparacion = { desde: a, hasta: b, enAmbos: ambos, suben, iguales, bajan, reseniasNuevas: nuevas,
      medianaDelta: deltas.length ? deltas[Math.floor(deltas.length / 2)] : null,
      p99Delta: deltas.length ? deltas[Math.floor(deltas.length * 0.99)] : null,
      top10Pct: nuevas ? Math.round(top10 / nuevas * 100) : null, mayoresSaltos: saltos.slice(0, 10) }
  }
  return { dia, leidasHoy, porDia: porDia.map((d) => ({ dia: d._id, lecturas: d.lecturas })), comparacion }
}
