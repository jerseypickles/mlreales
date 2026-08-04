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
  return {
    dias,
    campanas,
    porItem: Object.fromEntries(items),
  }
}
