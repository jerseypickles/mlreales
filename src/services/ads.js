import { meliGet, hayCuentaMeli } from './meli.js'

// Product Ads de la cuenta conectada. Rutas /marketplace/advertising validadas
// en vivo el 4-ago contra las campañas reales (Api-Version: 2 obligatorio).
const SITE = 'MLC'
const METRICAS =
  'clicks,prints,cost,cpc,acos,organic_units_quantity,direct_units_quantity,indirect_units_quantity,units_quantity,direct_amount,indirect_amount,total_amount'

const dia = (d) => d.toISOString().slice(0, 10)

let cacheAdvertiser = null
async function advertiserId() {
  if (cacheAdvertiser) return cacheAdvertiser
  const r = await meliGet('/advertising/advertisers?product_id=PADS', { headers: { 'Api-Version': '1' } })
  cacheAdvertiser = r?.advertisers?.[0]?.advertiser_id ?? null
  return cacheAdvertiser
}

// Campañas con métricas del rango (default: últimos 30 días)
export async function campanasConMetricas({ dias = 30 } = {}) {
  if (!(await hayCuentaMeli())) return null
  const adv = await advertiserId()
  if (!adv) return null
  const hasta = new Date()
  const desde = new Date(hasta.getTime() - dias * 86400e3)
  const r = await meliGet(
    `/marketplace/advertising/${SITE}/advertisers/${adv}/product_ads/campaigns/search?limit=50&date_from=${dia(desde)}&date_to=${dia(hasta)}&metrics=${METRICAS}`,
    { headers: { 'Api-Version': '2' } },
  )
  return (r?.results ?? []).map((c) => ({
    id: c.id,
    nombre: c.name,
    estado: c.status,
    presupuestoDiario: c.budget ?? null,
    estrategia: c.strategy ?? null,
    acosObjetivo: c.acos_target ?? null,
    metricas: c.metrics ?? {},
  }))
}

// Métricas por anuncio/item (para atribuir pagado vs orgánico por producto)
export async function adsPorItem({ dias = 30 } = {}) {
  if (!(await hayCuentaMeli())) return new Map()
  const adv = await advertiserId()
  if (!adv) return new Map()
  const hasta = new Date()
  const desde = new Date(hasta.getTime() - dias * 86400e3)
  const r = await meliGet(
    `/marketplace/advertising/${SITE}/advertisers/${adv}/product_ads/ads/search?limit=50&date_from=${dia(desde)}&date_to=${dia(hasta)}&metrics=${METRICAS}`,
    { headers: { 'Api-Version': '2' } },
  )
  const porItem = new Map()
  for (const ad of r?.results ?? []) {
    const id = ad.item_id ?? ad.id
    if (id) porItem.set(id, { titulo: ad.title ?? null, estado: ad.status ?? null, metricas: ad.metrics ?? {} })
  }
  return porItem
}

export async function resumenAds({ dias = 30 } = {}) {
  const campanas = await campanasConMetricas({ dias })
  if (!campanas) return null
  const items = await adsPorItem({ dias }).catch(() => new Map())
  const porItem = Object.fromEntries(items)

  // LA ECONOMÍA, que es lo que ML no puede darte: su panel compara el gasto
  // contra la VENTA, y lo que decide si ganas es la contribución. Con el precio
  // real de cada propio, su comisión exacta y la tarifa Full escalonada sale el
  // ROAS de equilibrio de cada anuncio — el número que dice a partir de dónde
  // cada peso de publicidad destruye margen.
  let economia = null
  try {
    const [{ economiaPorAnuncio }, { ProductoPropio }] = await Promise.all([
      import('./economiaAds.js'),
      import('../models/ProductoPropio.js'),
    ])
    const propios = await ProductoPropio.find().lean()
    economia = await economiaPorAnuncio(porItem, propios)
  } catch (err) {
    console.warn(`[ads] economía por anuncio no disponible: ${err.message}`)
  }

  // el experimento en curso: sin el antes congelado, comparar es recordar
  let experimento = null
  try {
    const { ExperimentoAds } = await import('../models/ExperimentoAds.js')
    experimento = await ExperimentoAds.findOne({ estado: 'corriendo' }).sort({ inicioEl: -1 }).lean()
    if (experimento) {
      experimento.ahora = await ventanaDesde(experimento.campanaId, experimento.inicioEl).catch(() => null)
      experimento.diasCorridos = Math.max(
        0,
        Math.floor((Date.now() - new Date(experimento.inicioEl)) / 86400e3),
      )
    }
  } catch {
    // sin experimento el tab funciona igual
  }

  return { dias, campanas, porItem, economia, experimento }
}

// Métricas de una campaña desde una fecha: el "después" del experimento, con la
// misma forma que el baseline para poder ponerlos lado a lado.
export async function ventanaDesde(campanaId, desde) {
  if (!(await hayCuentaMeli())) return null
  const adv = await advertiserId()
  if (!adv) return null
  const hasta = new Date()
  const r = await meliGet(
    `/marketplace/advertising/${SITE}/advertisers/${adv}/product_ads/campaigns/search?limit=20&date_from=${dia(
      new Date(desde),
    )}&date_to=${dia(hasta)}&metrics=${METRICAS}`,
    { headers: { 'Api-Version': '2' } },
  )
  const c = (r?.results ?? []).find((x) => x.id === campanaId)
  if (!c?.metrics) return null
  const m = c.metrics
  const dias = Math.max(1, Math.round((hasta - new Date(desde)) / 86400e3))
  return {
    dias,
    prints: m.prints,
    clicks: m.clicks,
    costo: m.cost,
    cpc: m.cpc,
    acos: m.acos,
    unidades: m.units_quantity,
    venta: m.total_amount,
    organicas: m.organic_units_quantity,
    roasReal: m.cost > 0 ? Math.round((m.total_amount / m.cost) * 100) / 100 : null,
  }
}
