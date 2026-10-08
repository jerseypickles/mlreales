import { AdsDiaMl } from '../../models/AdsDiaMl.js'
import { meliGet, hayCuentaMeli } from '../meli.js'
import { advertiserId, METRICAS_ADS } from '../ads.js'
import { diaChile } from '../inventarioFull.js'

const DIA = 86400e3
const RETENCION_DIAS = 90 // lo que Product Ads conserva
const RECALCULO_DIAS = 7 // ML atribuye conversiones con días de atraso
const n = (v) => (Number.isFinite(v) ? v : 0)

// Pura: la respuesta de un día → una fila por anuncio más el total de la cuenta.
export function filasDeAds(respuesta, dia) {
  const filas = []
  for (const ad of respuesta?.results ?? []) {
    const itemId = ad.item_id ?? ad.id
    const m = ad.metrics ?? {}
    if (!itemId) continue
    filas.push({ itemId: String(itemId), dia, campanaId: ad.campaign_id ?? null, estado: ad.status ?? null,
      prints: n(m.prints), clicks: n(m.clicks), costo: n(m.cost),
      unidadesAds: n(m.units_quantity), unidadesDirectas: n(m.direct_units_quantity), unidadesIndirectas: n(m.indirect_units_quantity),
      unidadesOrganicas: n(m.organic_units_quantity), ventaAds: n(m.total_amount) })
  }
  const suma = (k) => filas.reduce((a, f) => a + f[k], 0)
  const total = { itemId: '*', dia, campanaId: null, estado: null, anuncios: filas.length }
  for (const k of ['prints', 'clicks', 'costo', 'unidadesAds', 'unidadesDirectas', 'unidadesIndirectas', 'unidadesOrganicas', 'ventaAds']) total[k] = suma(k)
  // un anuncio sin impresiones ni gasto ese día no es una observación
  return [...filas.filter((f) => f.prints || f.clicks || f.costo || f.unidadesAds), total]
}

// Una vez al día: relee la última semana (la atribución llega tarde) y
// recupera hacia atrás los días que falten dentro de lo que ML retiene.
export async function actualizarAdsDiario({ ahora = new Date(), pedir = meliGet, maxLlamadas = 40 } = {}) {
  if (!(await hayCuentaMeli())) return { dias: 0, motivo: 'sin cuenta de Mercado Libre' }
  const ayer = diaChile(+ahora - DIA)
  const marca = await AdsDiaMl.findOne({ itemId: '*', dia: ayer }).lean()
  if (marca && +ahora - +new Date(marca.actualizadoEl) < 20 * 3600e3) return { dias: 0, motivo: 'al día' }
  const adv = await advertiserId()
  if (!adv) return { dias: 0, motivo: 'sin anunciante de Product Ads' }
  const leidos = new Set((await AdsDiaMl.find({ itemId: '*', dia: { $gte: diaChile(+ahora - RETENCION_DIAS * DIA) } }).select('dia').lean()).map((d) => d.dia))
  const pendientes = []
  for (let i = 1; i <= RETENCION_DIAS && pendientes.length < maxLlamadas; i++) {
    const dia = diaChile(+ahora - i * DIA)
    if (i <= RECALCULO_DIAS || !leidos.has(dia)) pendientes.push(dia)
  }
  let dias = 0, filasEscritas = 0
  for (const dia of pendientes) {
    const respuesta = await pedir(
      `/marketplace/advertising/MLC/advertisers/${adv}/product_ads/ads/search?limit=50&date_from=${dia}&date_to=${dia}&metrics=${METRICAS_ADS}`,
      { headers: { 'Api-Version': '2' } },
    )
    if (!Array.isArray(respuesta?.results)) throw new Error(`Product Ads devolvió ${dia} sin results`)
    const filas = filasDeAds(respuesta, dia)
    await AdsDiaMl.bulkWrite(filas.map((f) => ({ updateOne: { filter: { itemId: f.itemId, dia: f.dia }, update: { $set: { ...f, actualizadoEl: ahora } }, upsert: true } })))
    dias++
    filasEscritas += filas.length - 1
  }
  return { dias, filas: filasEscritas, faltan: Math.max(0, RETENCION_DIAS - leidos.size - dias) }
}

// La configuración de las campañas HOY (presupuesto, ROAS objetivo, estado y
// qué productos tiene cada una), una fila por campaña y día. ML no guarda la
// historia de esto: si no se anota cada día, se pierde (ver CampanaDiaMl).
export async function registrarCampanasDelDia({ ahora = new Date() } = {}) {
  const { CampanaDiaMl } = await import('../../models/CampanaDiaMl.js')
  const { resumenAds } = await import('../ads.js')
  const r = await resumenAds({ dias: 1 })
  if (!r?.campanas?.length) return { campanas: 0 }
  const dia = diaChile(ahora)
  const productosDe = new Map()
  for (const [itemId, a] of Object.entries(r.porItem ?? {})) {
    const id = a.campaign_id ?? a.campanaId
    if (id != null) productosDe.set(id, [...(productosDe.get(id) ?? []), itemId])
  }
  await CampanaDiaMl.bulkWrite(r.campanas.map((c) => ({ updateOne: { filter: { campanaId: c.id, dia }, update: { $set: {
    nombre: c.nombre ?? null, estado: c.estado ?? null, presupuestoDiario: c.presupuestoDiario ?? null, roasObjetivo: c.roasObjetivo ?? null,
    estrategia: c.estrategia ?? null, productos: productosDe.get(c.id) ?? [], actualizadoEl: ahora } }, upsert: true } })))
  return { campanas: r.campanas.length, dia }
}

export async function resumenAdsDiario({ ahora = new Date(), diasSerie = 42 } = {}) {
  const [t] = await AdsDiaMl.aggregate([{ $match: { itemId: '*' } },
    { $group: { _id: null, dias: { $sum: 1 }, desde: { $min: '$dia' }, hasta: { $max: '$dia' }, costo: { $sum: '$costo' }, clicks: { $sum: '$clicks' },
      unidadesAds: { $sum: '$unidadesAds' }, diasConGasto: { $sum: { $cond: [{ $gt: ['$costo', 0] }, 1, 0] } } } }])
  if (!t) return { dias: 0, serie: [] }
  const serie = await AdsDiaMl.find({ itemId: '*', dia: { $gte: diaChile(+ahora - diasSerie * DIA) } }).select('dia costo clicks unidadesAds').sort({ dia: 1 }).lean()
  return { dias: t.dias, diasConGasto: t.diasConGasto, desde: t.desde, hasta: t.hasta, costo: Math.round(t.costo), clicks: t.clicks, unidadesAds: t.unidadesAds,
    serie: serie.map((d) => ({ dia: d.dia, costo: Math.round(d.costo), clicks: d.clicks, unidadesAds: d.unidadesAds })) }
}

// La serie diaria de cada producto para los gráficos de Publicidad: lo de ML
// (gasto, impresiones, clics, ventas por anuncio) al lado de lo que pasó con el
// producto entero (ventas totales y visitas del libro). Y el total de la cuenta.
export async function serieAdsPorProducto({ ahora = new Date(), dias = 60 } = {}) {
  const desde = diaChile(+ahora - dias * DIA)
  const filas = await AdsDiaMl.find({ dia: { $gte: desde } }).select('-_id itemId dia campanaId estado prints clicks costo unidadesAds unidadesDirectas unidadesIndirectas unidadesOrganicas ventaAds').sort({ dia: 1 }).lean()
  const { DiaProductoMl } = await import('../../models/DiaProductoMl.js')
  const libro = await DiaProductoMl.find({ dia: { $gte: desde } }).select('-_id itemId dia unidades visitas precio').lean()
  const porProducto = {}
  const clave = (f) => `${f.itemId}|${f.dia}`
  const libroDe = new Map(libro.map((l) => [clave(l), l]))
  const items = new Set([...filas.filter((f) => f.itemId !== '*').map((f) => f.itemId), ...libro.map((l) => l.itemId)])
  const adsDe = new Map(filas.map((f) => [clave(f), f]))
  const todosLosDias = []
  for (let t = +new Date(`${desde}T12:00:00Z`); diaChile(t) < diaChile(ahora); t += DIA) todosLosDias.push(new Date(t).toISOString().slice(0, 10))
  for (const id of items) {
    porProducto[id] = todosLosDias.map((dia) => {
      const a = adsDe.get(`${id}|${dia}`), l = libroDe.get(`${id}|${dia}`)
      return { dia, gasto: Math.round(a?.costo ?? 0), prints: a?.prints ?? 0, clicks: a?.clicks ?? 0, unidadesAds: a?.unidadesAds ?? 0, ventaAds: Math.round(a?.ventaAds ?? 0),
        organicas: a?.unidadesOrganicas ?? 0, campanaId: a?.campanaId ?? null, unidades: l?.unidades ?? null, visitas: l?.visitas ?? null, precio: l?.precio ?? null }
    })
  }
  const total = todosLosDias.map((dia) => {
    const a = adsDe.get(`*|${dia}`)
    return { dia, gasto: Math.round(a?.costo ?? 0), prints: a?.prints ?? 0, clicks: a?.clicks ?? 0, unidadesAds: a?.unidadesAds ?? 0, ventaAds: Math.round(a?.ventaAds ?? 0) }
  })
  return { desde, dias: todosLosDias.length, total, porProducto }
}
