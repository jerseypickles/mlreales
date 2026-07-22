import { Snapshot } from '../models/Snapshot.js'
import { Producto } from '../models/Producto.js'
import { idDesdeUrl } from './normalizadorDetalle.js'
import { reviewsOficialesSeguro, meliGet } from './meli.js'

// Sonda one-shot ANTES de migrar el conteo de reseñas a la API oficial: mide
// cobertura (¿cuántos del top 50 real responden, incluidos los /up/?), tasa
// (¿aparece un 429?) y tiempos sobre un nicho de verdad. Se activa fijando
// SONDA_REVIEWS_KEYWORD en el entorno; los resultados quedan en el log
// [sonda-reviews] y la variable se retira después de leerlos. Regla del
// proyecto: ninguna migración se decide suponiendo schemas ni límites.
export async function sondaReviewsTop(keyword) {
  const ultimo = await Snapshot.findOne({ keyword }).sort({ fecha: -1 }).select('fecha').lean()
  if (!ultimo) {
    console.warn(`[sonda-reviews] sin snapshots para "${keyword}"`)
    return
  }
  const snaps = await Snapshot.find({ keyword, fecha: ultimo.fecha })
    .sort({ posicion: 1 })
    .limit(50)
    .select('sku posicion numReviews')
    .lean()
  console.log(`[sonda-reviews] "${keyword}": ${snaps.length} items del scan ${ultimo.fecha.toISOString()}`)

  // v2 (tras el hallazgo de la v1): /reviews/item con id de ITEM devuelve el
  // bucket propio (casi vacío en items de catálogo) — la página muestra el
  // agregado del CATÁLOGO. Acá se prueba además el id embebido en la URL del
  // producto (/p/MLC… o /up/MLCU…): si ese calza con el scraper, la migración
  // va por ahí (y habría que persistir catalogProductId del nivel 2).
  const urlPorSku = new Map(
    (await Producto.find({ sku: { $in: snaps.map((s) => s.sku) } }).select('sku url').lean()).map((p) => [p.sku, p.url]),
  )
  const inicio = Date.now()
  let conConteo = 0
  let coincideItem = 0
  let conUrlId = 0
  let coincideUrlId = 0
  const muestras = []
  for (const s of snaps) {
    const rItem = await reviewsOficialesSeguro(s.sku)
    if (rItem) {
      conConteo++
      if (Number.isFinite(s.numReviews) && Math.abs(rItem.numReviews - s.numReviews) <= 2) coincideItem++
    }
    // id embebido en la URL (código de catálogo en /p/, user product en /up/)
    const urlId = idDesdeUrl(urlPorSku.get(s.sku))
    let rUrl = null
    if (urlId && urlId !== s.sku) {
      rUrl = await reviewsOficialesSeguro(urlId)
      if (rUrl) {
        conUrlId++
        if (Number.isFinite(s.numReviews) && Math.abs(rUrl.numReviews - s.numReviews) <= 2) coincideUrlId++
      }
    }
    if (muestras.length < 8 && (Number.isFinite(s.numReviews) || rUrl)) {
      muestras.push({
        pos: s.posicion,
        sku: s.sku,
        urlId: urlId !== s.sku ? urlId : undefined,
        apiItem: rItem?.numReviews ?? null,
        apiUrl: rUrl?.numReviews ?? null,
        scraper: s.numReviews ?? null,
      })
    }
  }
  const total = Date.now() - inicio
  console.log(
    `[sonda-reviews] resultado: por item ${conConteo}/${snaps.length} responden y ${coincideItem} calzan con el scraper (±2); ` +
      `por id de URL ${conUrlId} responden y ${coincideUrlId} calzan; ${Math.round(total / 1000)}s total`,
  )
  console.log(`[sonda-reviews] muestras: ${JSON.stringify(muestras)}`)

  // De pasada: ¿responde listing_prices? (comisión EXACTA por precio/categoría
  // para la calculadora de margen — mejora #2)
  try {
    const lp = await meliGet('/sites/MLC/listing_prices?price=15990')
    console.log(`[sonda-reviews] listing_prices OK — ${JSON.stringify(lp).slice(0, 400)}`)
  } catch (err) {
    console.warn(`[sonda-reviews] listing_prices: ${err.message}`)
  }
}
