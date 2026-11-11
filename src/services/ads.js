import { meliGet, hayCuentaMeli } from './meli.js'
import { crearCacheVivo } from './cacheVivo.js'
import { lecturaCompletaAds } from './ml/evaluacionAds.js'
import { leerCompetitividad, describirCompetitividad } from './ml/competitividadAds.js'

// Product Ads de la cuenta conectada (Api-Version: 2 obligatorio).
//
// Las rutas son las que publica la documentación de Chile, bajo
// /advertising/{sitio}/…. Hasta el 11-nov-2026 se usaban las equivalentes bajo
// /marketplace/advertising/…, validadas el 4-ago; ese día se midió que las dos
// entregan lo mismo (mismas campañas, mismos anuncios, mismos totales), pero
// ML solo respalda las documentadas y ya apagó una generación anterior.
const SITE = 'MLC'
export const METRICAS_ADS =
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
export async function advertiserId() {
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
    `/advertising/${SITE}/advertisers/${adv}/product_ads/campaigns/search?limit=50&date_from=${desde}&date_to=${hasta}&metrics=${METRICAS_ADS}`,
    { headers: { 'Api-Version': '2' } },
  )
  // CUÁNTOS DÍAS LLEVA VIVA LA CAMPAÑA, no cuántos pide la ventana.
  //
  // Dividir el gasto por los días del rango asume que la campaña existió todo
  // ese tiempo, y con una campaña nueva eso la muestra a una fracción de lo que
  // gasta. Medido el 22-ago: Campaña 3 nació el 19 y gastaba $2.132/día sobre
  // un tope de $2.000 —el 107%, se pasaba— pero dividido por 7 daba $914, un
  // 46%, y el analista concluyó "le sobra presupuesto, bájale el objetivo". El
  // consejo exacto al revés del correcto.
  //
  // `date_created` viene en la misma respuesta y nunca se usaba.
  const hoy = new Date(`${hasta}T23:59:59Z`)
  return (r?.results ?? []).map((c) => {
    const creada = c.date_created ? new Date(c.date_created) : null
    const desdeCreacion = creada ? Math.floor((hoy - creada) / 86400e3) + 1 : null
    const diasConDatos = Number.isFinite(desdeCreacion) ? Math.max(1, Math.min(dias, desdeCreacion)) : dias
    return {
      id: c.id,
      nombre: c.name,
      estado: c.status,
      presupuestoDiario: c.budget ?? null,
      estrategia: c.strategy ?? null,
      acosObjetivo: c.acos_target ?? null,
      // ML lo entrega directo: no hace falta derivarlo de 100/acos
      roasObjetivo: c.roas_target ?? (c.acos_target ? Math.round((100 / c.acos_target) * 100) / 100 : null),
      creadaEl: c.date_created ?? null,
      diasConDatos,
      // una campaña con menos de una semana no tiene serie que leer: el gasto
      // responde en horas pero las conversiones tardan, así que su ROAS todavía
      // no significa nada
      maduraParaOpinar: diasConDatos >= 7,
      metricas: c.metrics ?? {},
    }
  })
}

// LO QUE CADA CAMPAÑA ACTIVA DEJA DE MOSTRAR, Y POR QUÉ (ver ml/competitividadAds.js).
// Una lectura por campaña: el detalle es el único recurso que trae estas métricas.
const METRICAS_COMPETITIVIDAD = 'prints,impression_share,top_impression_share,lost_impression_share_by_budget,lost_impression_share_by_ad_rank,acos_benchmark'
export async function competitividadDeCampanas(campanas, { dias = 7 } = {}) {
  const { desde, hasta } = rangoDias(dias)
  const activas = (campanas ?? []).filter((c) => c.estado === 'active')
  const pares = await Promise.all(
    activas.map(async (c) => {
      const r = await meliGet(
        `/advertising/${SITE}/product_ads/campaigns/${c.id}?date_from=${desde}&date_to=${hasta}&metrics=${METRICAS_COMPETITIVIDAD}`,
        { headers: { 'Api-Version': '2' } },
      ).catch(() => null)
      const leida = leerCompetitividad(r?.metrics)
      return [c.id, leida ? { ...leida, ...describirCompetitividad(leida) } : null]
    }),
  )
  return new Map(pares)
}

// Métricas por anuncio/item (para atribuir pagado vs orgánico por producto)
export async function adsPorItem({ dias = 30 } = {}) {
  if (!(await hayCuentaMeli())) return new Map()
  const adv = await advertiserId()
  if (!adv) return new Map()
  const { desde, hasta } = rangoDias(dias)
  const r = await meliGet(
    `/advertising/${SITE}/advertisers/${adv}/product_ads/ads/search?limit=50&date_from=${desde}&date_to=${hasta}&metrics=${METRICAS_ADS}`,
    { headers: { 'Api-Version': '2' } },
  )
  if (!Array.isArray(r?.results)) throw new Error('Lectura de anuncios incompleta')
  const porItem = new Map()
  porItem.completa = lecturaCompletaAds(r)
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
      // Product Ads: idle está disponible, pero fuera de una campaña vigente.
      campanaId: ad.status === 'idle' ? null : ad.campaign_id ?? null,
      creadoEl: ad.date_created ?? null,
      tipoPublicacion: ad.listing_type_id ?? null,
      esCatalogo: ad.catalog_listing ?? null,
      ganaBuyBox: ad.buy_box_winner ?? null,
    })
  }
  return porItem
}

// LO GUARDADO SE ENTREGA AL TIRO Y SE REFRESCA DETRÁS (11-nov-2026).
//
// Armar el resumen son las lecturas de Product Ads más la economía por anuncio.
// Tenía una caché de 60 segundos, que es lo que corresponde al dato: ML no
// actualiza las métricas en tiempo real —el gasto se mueve en minutos, las
// conversiones tardan— así que refrescar más seguido solo consumiría cuota.
// Pero pasado el minuto cada visita pagaba el armado entero. Medido el 11-nov:
// ya no son dos segundos sino entre cinco y siete, la pantalla de Publicidad
// pide dos ventanas a la vez y no mostraba nada hasta tener las dos. Pedido del
// importador ese día: «varias interfaces cuesta mucho que carguen».
//
// Ahora la pantalla recibe lo último guardado, marcado `refrescando`, y lo
// vuelve a pedir a los segundos; `refrescoEl` le dice cuán fresco es lo que ve.
// Quien calcula con el resumen (el plan de campañas, el analista) no acepta uno
// pasado: espera el nuevo, como antes.
const TTL_RESUMEN_MS = 60_000
const cachesResumen = new Map()
function cacheResumen(dias) {
  let c = cachesResumen.get(dias)
  if (!c) {
    c = crearCacheVivo({
      nombre: `anuncios-${dias}d`,
      frescoMs: TTL_RESUMEN_MS,
      // un costo, un precio o un presupuesto que cambia el dueño cambia la economía del resumen
      cambiaCon: ['/api/propios', '/api/meli'],
      calcular: async () => {
        const valor = await construirResumenAds({ dias })
        // sin cuenta no hay nada que guardar: se vuelve a intentar en la visita siguiente
        if (!valor) throw new SinPublicidad()
        return valor
      },
    })
    cachesResumen.set(dias, c)
  }
  return c
}
class SinPublicidad extends Error {
  constructor() {
    super('sin cuenta de Mercado Libre conectada o sin advertiser de Product Ads')
  }
}
// Las dos ventanas con que abre la pantalla quedan anotadas desde el arranque:
// se precalientan y se rearman con cada medición de los productos propios.
for (const dias of [30, 1]) cacheResumen(dias)

export function invalidarCacheAds() {
  for (const c of cachesResumen.values()) c.invalidar()
}

// forzar: vuelve a preguntarle a ML y espera (el botón «actualizar»).
// viejaSirve: si lo guardado pasó el minuto se entrega igual, marcado
// `refrescando`, y se rearma detrás. Solo la pantalla la pide.
export async function resumenAds({ dias = 30, forzar = false, viejaSirve = false } = {}) {
  const pedidoEl = Date.now()
  let leido
  try {
    leido = await cacheResumen(dias).leer({ fresca: forzar, soloFresca: !viejaSirve })
  } catch (err) {
    if (err instanceof SinPublicidad) return null
    throw err
  }
  const { valor, calculadoEl, refrescando } = leido
  return { ...valor, refrescoEl: calculadoEl.toISOString(), deCache: calculadoEl.getTime() < pedidoEl, refrescando }
}

async function construirResumenAds({ dias = 30 } = {}) {
  const campanas = await campanasConMetricas({ dias })
  if (!campanas) return null
  // La competitividad se lee en ventanas de una semana o más: ML la calcula una vez al día, así que la de
  // «hoy» viene vacía. Si falla, el resumen sale igual sin ella.
  if (dias >= 7) {
    try {
      const competitividad = await competitividadDeCampanas(campanas, { dias })
      for (const c of campanas) c.competitividad = competitividad.get(c.id) ?? null
    } catch (err) {
      console.warn(`[ads] competitividad de campañas no disponible: ${err.message}`)
    }
  }
  // el rango exacto viaja a la mesa: sin él no se puede cuadrar contra el panel
  // de ML, que por defecto muestra el MES EN CURSO y no 30 días rodantes
  const rango = rangoDias(dias)
  const items = await adsPorItem({ dias }).catch(() => null)
  const lecturaAnunciosCompleta = items?.completa === true
  const porItem = Object.fromEntries(items ?? [])

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
    // envío FACTURADO por unidad
    // (cada cobro cruzado con su orden; ventana mínima de 60 días para que
    // las órdenes caras, que son 15-30%, pesen lo que pesan)
    const envioFacturado = new Map()
    try {
      const { envioRealPorItem } = await import('./cargosMl.js')
      for (const [itemId, e] of await envioRealPorItem({ dias: Math.max(60, dias) })) envioFacturado.set(itemId, e.porUnidad)
    } catch (err) {
      console.warn(`[ads] envío facturado no disponible, se usa la tarifa: ${err.message}`)
    }
    economia = await economiaPorAnuncio(porItem, propios, { envioFacturado })
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

  return { dias, rango, totales, campanas, porItem, lecturaAnunciosCompleta, economia, experimento }
}

// Métricas de una campaña desde una fecha: el "después" del experimento, con la
// misma forma que el baseline para poder ponerlos lado a lado.
export async function ventanaDesde(campanaId, desde) {
  if (!(await hayCuentaMeli())) return null
  const adv = await advertiserId()
  if (!adv) return null
  const hasta = new Date()
  const r = await meliGet(
    `/advertising/${SITE}/advertisers/${adv}/product_ads/campaigns/search?limit=20&date_from=${dia(
      new Date(desde),
    )}&date_to=${dia(hasta)}&metrics=${METRICAS_ADS}`,
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
