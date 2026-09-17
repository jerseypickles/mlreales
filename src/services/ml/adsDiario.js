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

export async function resumenAdsDiario() {
  const [t] = await AdsDiaMl.aggregate([{ $match: { itemId: '*' } },
    { $group: { _id: null, dias: { $sum: 1 }, desde: { $min: '$dia' }, hasta: { $max: '$dia' }, costo: { $sum: '$costo' }, clicks: { $sum: '$clicks' },
      unidadesAds: { $sum: '$unidadesAds' }, diasConGasto: { $sum: { $cond: [{ $gt: ['$costo', 0] }, 1, 0] } } } }])
  return t ? { dias: t.dias, diasConGasto: t.diasConGasto, desde: t.desde, hasta: t.hasta, costo: Math.round(t.costo), clicks: t.clicks, unidadesAds: t.unidadesAds } : { dias: 0 }
}
