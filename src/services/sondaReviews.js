import { Snapshot } from '../models/Snapshot.js'
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

  const inicio = Date.now()
  let conConteo = 0
  let sinConteo = 0
  let coincide = 0
  const muestras = []
  for (const s of snaps) {
    const t0 = Date.now()
    const r = await reviewsOficialesSeguro(s.sku)
    const ms = Date.now() - t0
    if (r) {
      conConteo++
      // ¿el conteo oficial calza con lo que midió el scraper? (validación cruzada)
      if (Number.isFinite(s.numReviews) && Math.abs(r.numReviews - s.numReviews) <= 2) coincide++
      if (muestras.length < 5) muestras.push({ pos: s.posicion, sku: s.sku, api: r.numReviews, scraper: s.numReviews ?? null, ms })
    } else {
      sinConteo++
    }
  }
  const total = Date.now() - inicio
  console.log(
    `[sonda-reviews] resultado: ${conConteo}/${snaps.length} con conteo oficial, ${sinConteo} sin dato, ` +
      `${coincide} calzan con el scraper (±2), ${Math.round(total / 1000)}s total (~${Math.round(total / Math.max(1, snaps.length))}ms/item)`,
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
