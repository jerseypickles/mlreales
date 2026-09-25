import { Snapshot } from '../models/Snapshot.js'
import { Producto } from '../models/Producto.js'

// PRODUCTOS NUEVOS QUE DESPEGAN: la señal más temprana de que otro importador
// trajo algo que funciona.
//
// Cada scan deja constancia de cuándo aparece una publicación por primera vez
// en un nicho. Una que apareció hace poco y ya sube de posición, gana reseñas o
// cambia de balde de vendidos, es un producto que el mercado está aceptando —
// antes de que se note en cualquier ranking. El dato se guardaba y nadie lo
// miraba (25-sep-2026).
//
// La trampa: si el NICHO es nuevo, todos sus productos parecen nuevos. Por eso
// solo cuenta lo que apareció al menos una semana después del primer scan de
// ese nicho. Y las reseñas no cuentan si el salto es de fuente (ML agrupando
// reseñas del producto: ver reseniasDiarias.saltosSospechosos).

const DIA = 86400e3
export const VENTANA_NUEVO_DIAS = 30
const DESPUES_DEL_PRIMER_SCAN_DIAS = 7

// Pura. snaps: lecturas del panel; productos: Producto (para foto, Full, etc).
export function nuevosQueDespegan(snaps, productos, { ahora = new Date(), max = 30 } = {}) {
  const ficha = new Map(productos.map((p) => [p.sku, p]))
  const primerScan = new Map()
  const serie = new Map()
  for (const s of snaps) {
    const t = +new Date(s.fecha)
    if (!Number.isFinite(t)) continue
    if (!primerScan.has(s.keyword) || t < primerScan.get(s.keyword)) primerScan.set(s.keyword, t)
    const k = `${s.keyword}|${s.sku}`
    serie.set(k, [...(serie.get(k) ?? []), s])
  }
  const salida = []
  for (const [k, lista] of serie) {
    const orden = lista.sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
    const primera = orden[0], ultima = orden.at(-1)
    const keyword = primera.keyword
    const t0 = +new Date(primera.fecha)
    if (t0 < primerScan.get(keyword) + DESPUES_DEL_PRIMER_SCAN_DIAS * DIA) continue // el nicho era nuevo, no el producto
    if (+ahora - t0 > VENTANA_NUEVO_DIAS * DIA) continue
    if (orden.length < 2 || +new Date(ultima.fecha) - t0 < 2 * DIA) continue
    const organicas = orden.filter((s) => Number.isFinite(s.posicion) && s.esAnuncio !== true)
    if (organicas.length < 2) continue // la posición comprada no dice nada
    const subida = organicas[0].posicion - organicas.at(-1).posicion
    const dias = (+new Date(ultima.fecha) - t0) / DIA
    let resenias = Number.isFinite(primera.numReviewsApi) && Number.isFinite(ultima.numReviewsApi) ? ultima.numReviewsApi - primera.numReviewsApi : null
    if (resenias != null && (resenias < 0 || (resenias > 50 && resenias > primera.numReviewsApi * 0.5))) resenias = null
    const baldeSubio = Number.isFinite(primera.vendidos) && Number.isFinite(ultima.vendidos) && ultima.vendidos > primera.vendidos
    const posicion = organicas.at(-1).posicion
    const despega = (resenias ?? 0) >= 3 || subida >= 10 || baldeSubio || (posicion <= 10 && subida >= 3)
    if (!despega) continue
    const f = ficha.get(primera.sku)
    salida.push({ sku: primera.sku, keyword, titulo: f?.titulo ?? null, imagen: f?.imagen ?? null, url: f?.url ?? null,
      apareció: new Date(t0), dias: Math.round(dias), posicionInicial: organicas[0].posicion, posicion, subida,
      reseniasGanadas: resenias, reseniasSemana: resenias != null && dias > 0 ? Math.round(resenias / dias * 7 * 10) / 10 : null,
      vendidos: ultima.vendidos ?? null, baldeSubio, precio: ultima.precio ?? null, full: f?.esFull ?? null, vendedor: f?.vendedor ?? null,
      puntaje: Math.round(((resenias ?? 0) / Math.max(1, dias) * 7 + Math.max(0, subida) / 5 + (baldeSubio ? 3 : 0) + (posicion <= 10 ? 2 : 0)) * 10) / 10 })
  }
  // un mismo producto en varios nichos: se queda la aparición con más puntaje
  const mejor = new Map()
  for (const x of salida) if (!mejor.has(x.sku) || mejor.get(x.sku).puntaje < x.puntaje) mejor.set(x.sku, x)
  return [...mejor.values()].sort((a, b) => b.puntaje - a.puntaje).slice(0, max)
}

let cache = null
export async function productosNuevosQueDespegan({ ahora = new Date(), max = 30 } = {}) {
  if (cache && +ahora - cache.en < 30 * 60e3) return cache.valor.slice(0, max)
  const snaps = await Snapshot.find({ fecha: { $gte: new Date(+ahora - 75 * DIA) } })
    .select('sku fecha keyword posicion esAnuncio numReviewsApi vendidos precio -_id').lean()
  const skus = [...new Set(snaps.map((s) => s.sku))]
  const productos = await Producto.find({ sku: { $in: skus } }).select('sku titulo imagen url esFull vendedor -_id').lean()
  const valor = nuevosQueDespegan(snaps, productos, { ahora, max: 60 })
  cache = { en: +ahora, valor }
  return valor.slice(0, max)
}
