import { meliGet, hayCuentaMeli } from './meli.js'

// Product Ads de la cuenta conectada. Rutas /marketplace/advertising validadas
// en vivo el 4-ago contra las campañas reales (Api-Version: 2 obligatorio).
const SITE = 'MLC'
const METRICAS =
  'clicks,prints,cost,cpc,acos,organic_units_quantity,direct_units_quantity,indirect_units_quantity,units_quantity,direct_amount,indirect_amount,total_amount'

// LAS FECHAS SE CUENTAN EN CHILE, NO EN UTC, Y AMBOS EXTREMOS ENTRAN.
//
// Dos errores que se sumaban y desalineaban todo contra el panel de ML:
//
// 1) `date_from = hoy − dias` con ML incluyendo los dos extremos hace que "30d"
//    traiga 31 días. En "1d" era peor: traía AYER y HOY, y al dividir por 1
//    salía un gasto diario casi del doble del real.
// 2) La fecha se sacaba de toISOString(), que es UTC. Entre las 20:00 y la
//    medianoche de Chile eso ya es el día siguiente, así que la ventana se
//    corría un día justo en las horas en que el importador mira el tablero.
//
// Con `dias` inclusivo: 1 = solo hoy, 7 = hoy y los seis anteriores.
const dia = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
const rangoDias = (dias) => {
  const hasta = new Date()
  const desde = new Date(hasta.getTime() - Math.max(0, dias - 1) * 86400e3)
  return { desde: dia(desde), hasta: dia(hasta) }
}

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
  const { desde, hasta } = rangoDias(dias)
  const r = await meliGet(
    `/marketplace/advertising/${SITE}/advertisers/${adv}/product_ads/campaigns/search?limit=50&date_from=${desde}&date_to=${hasta}&metrics=${METRICAS}`,
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
  const { desde, hasta } = rangoDias(dias)
  const r = await meliGet(
    `/marketplace/advertising/${SITE}/advertisers/${adv}/product_ads/ads/search?limit=50&date_from=${desde}&date_to=${hasta}&metrics=${METRICAS}`,
    { headers: { 'Api-Version': '2' } },
  )
  const porItem = new Map()
  for (const ad of r?.results ?? []) {
    const id = ad.item_id ?? ad.id
    if (!id) continue
    porItem.set(id, {
      titulo: ad.title ?? null,
      estado: ad.status ?? null,
      metricas: ad.metrics ?? {},
      // la ficha del anuncio: ML ya las manda en el mismo payload y se
      // descartaban. Son las que permiten mostrar el producto como producto
      // (foto, link, precio) y no como un id.
      foto: ad.thumbnail ? ad.thumbnail.replace(/^http:/, 'https:') : null,
      permalink: ad.permalink ?? null,
      precio: ad.price ?? null,
      campanaId: ad.campaign_id ?? null,
      creadoEl: ad.date_created ?? null,
      tipoPublicacion: ad.listing_type_id ?? null,
      esCatalogo: ad.catalog_listing ?? null,
      ganaBuyBox: ad.buy_box_winner ?? null,
    })
  }
  return porItem
}

// CACHÉ CORTA, PORQUE LA PANTALLA SE MIRA SEGUIDO.
//
// Armar el resumen son dos llamadas a ML más la economía por anuncio: ~2
// segundos. Con tres campañas corriendo el tab se abre y se recarga todo el
// rato, y cada apertura pagaba los 2 segundos completos y una llamada a la API
// de ML.
//
// 60 segundos es lo que corresponde al dato de abajo: ML no actualiza las
// métricas de Product Ads en tiempo real —el gasto se mueve en minutos, las
// conversiones tardan— así que refrescar más seguido no traería nada nuevo,
// solo consumiría cuota. `refrescoEl` viaja al frontend para que pueda mostrar
// cuán fresco es lo que está viendo en vez de aparentar tiempo real.
const cacheResumen = new Map()
const TTL_RESUMEN_MS = 60_000

export function invalidarCacheAds() {
  cacheResumen.clear()
}

export async function resumenAds({ dias = 30, forzar = false } = {}) {
  const clave = `d${dias}`
  const hit = cacheResumen.get(clave)
  if (!forzar && hit && Date.now() - hit.el < TTL_RESUMEN_MS) {
    return { ...hit.valor, refrescoEl: new Date(hit.el).toISOString(), deCache: true }
  }
  const valor = await construirResumenAds({ dias })
  if (valor) cacheResumen.set(clave, { valor, el: Date.now() })
  return valor ? { ...valor, refrescoEl: new Date().toISOString(), deCache: false } : valor
}

async function construirResumenAds({ dias = 30 } = {}) {
  const campanas = await campanasConMetricas({ dias })
  if (!campanas) return null
  // el rango exacto viaja a la mesa: sin él no se puede cuadrar contra el panel
  // de ML, que por defecto muestra el MES EN CURSO y no 30 días rodantes
  const rango = rangoDias(dias)
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

  // TOTALES DE CAMPAÑA, que es lo que ML cobra. Sumar los productos deja
  // afuera lo que la campaña gasta sin atribuirse a un anuncio puntual: medido
  // el 20-ago, $818 sobre $133.390 (0,6%). Chico, pero es la diferencia entre
  // cuadrar con el panel de ML y no cuadrar.
  const totales = (campanas ?? []).reduce(
    (a, c) => {
      const m = c.metricas ?? {}
      return {
        gasto: a.gasto + (m.cost ?? 0),
        venta: a.venta + (m.total_amount ?? 0),
        unidades: a.unidades + (m.units_quantity ?? 0),
        impresiones: a.impresiones + (m.prints ?? 0),
        clicks: a.clicks + (m.clicks ?? 0),
      }
    },
    { gasto: 0, venta: 0, unidades: 0, impresiones: 0, clicks: 0 },
  )

  return { dias, rango, totales, campanas, porItem, economia, experimento }
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
