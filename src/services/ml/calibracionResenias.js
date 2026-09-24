import { Snapshot } from '../../models/Snapshot.js'
import { Producto } from '../../models/Producto.js'
import { ProductoPropio } from '../../models/ProductoPropio.js'
import { VentaMl } from '../../models/VentaMl.js'
import { SeguimientoStock, LecturaStock } from '../../models/SeguimientoStock.js'
import { LecturaResenia } from '../../models/LecturaResenia.js'
import { ventaEntreLecturas } from '../metricas.js'

// ¿CUÁNTAS VENTAS HAY DETRÁS DE CADA RESEÑA? — EN MODO AUDITORÍA.
//
// Todo el aprendizaje de competidores habla en reseñas, y la estimación de
// ventas usa un factor fijo de 25 que nunca se calibró (la cuenta propia midió
// ~18). El importador pidió que la conversión reseñas → unidades quede
// "extremadamente bien trabajada, sin duplicados ni ruido". Por eso son TRES
// métodos independientes, cada uno con sus trampas cerradas, y NADA de la app
// cambia con esto: se muestra, se compara, y el factor se usa solo si los
// métodos coinciden.
//
//  1. PROPIOS: ventas exactas de las órdenes contra las reseñas de la API de la
//     misma publicación. Exacto, pocos casos.
//  2. BALDE DE VENDIDOS: cuando un competidor pasa de "+100 vendidos" a "+500",
//     en ese momento lleva ≈500 vendidos (un poco más: lo que vendió entre las
//     dos lecturas), y la API dice cuántas reseñas tiene. Da una cota: reseñas
//     por venta ≤ reseñas / balde. Cientos de casos en el historial.
//  3. STOCK EXACTO: bajas de stock con número exacto (no "+25"), del mismo
//     vendedor y sin reposición en medio, contra las reseñas diarias.
//
// Trampas cerradas: una observación por publicación y método (una misma
// publicación aparece en varios nichos); fuera catálogo (los vendidos y las
// reseñas pueden ser del producto entero); fuera trayectorias de reseñas
// compartidas; fuera cambios de vendedor; baldes chicos (5, 25) no calibran.

const DIA = 86400e3
export const MINIMOS = { propiosUnidades: 20, balde: 100, stockUnidades: 5, stockDias: 7, casosMetodo: 8 }
const cuantil = (xs, q) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * q; const a = Math.floor(i), b = Math.ceil(i); return s[a] + (s[b] - s[a]) * (i - a) }
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000)

// Pura. Resumen de un método: reseñas por venta (mediana y rango), y su
// inverso legible, ventas por reseña.
export function resumirMetodo(casos) {
  const rs = casos.map((c) => c.reseniasPorVenta).filter((x) => Number.isFinite(x) && x >= 0)
  if (!rs.length) return { casos: 0 }
  const med = cuantil(rs, 0.5)
  return { casos: rs.length, reseniasPorVenta: r3(med), p25: r3(cuantil(rs, 0.25)), p75: r3(cuantil(rs, 0.75)),
    ventasPorResenia: med > 0 ? Math.round(1 / med * 10) / 10 : null }
}

// Pura. MÉTODO 1: propios. ventasPorItem: Map itemId → unidades pagadas.
export function casosPropios(propios, ventasPorItem) {
  const vistos = new Set()
  const casos = []
  for (const p of propios) {
    const id = p.itemIdMl ?? p.sku
    if (!id || vistos.has(id)) continue
    vistos.add(id)
    const unidades = ventasPorItem.get(id) ?? 0
    const ultima = [...(p.mediciones ?? [])].filter((m) => Number.isFinite(m.numReviews)).sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha)).at(-1)
    if (unidades < MINIMOS.propiosUnidades || !ultima) continue
    casos.push({ itemId: id, titulo: p.titulo, categoria: p.categoriaMl ?? null, unidades, resenias: ultima.numReviews, reseniasPorVenta: ultima.numReviews / unidades })
  }
  return casos
}

// Pura. MÉTODO 2: balde de vendidos. snaps: lecturas del panel; productos:
// Producto (tipoListing, itemId, categoría). Una observación por publicación:
// su PRIMER cruce de balde con reseñas de API en la lectura del cruce.
export function casosBalde(snaps, productos) {
  const ficha = new Map(productos.map((p) => [p.sku, p]))
  // reseñas compartidas: mismo valor de API en otra publicación del mismo scan
  const valores = new Map()
  for (const s of snaps) {
    if (!(s.numReviewsApi >= 10)) continue
    const k = `${s.keyword}|${+new Date(s.fecha)}|${s.numReviewsApi}`
    valores.set(k, (valores.get(k) ?? 0) + 1)
  }
  const porSku = new Map()
  for (const s of snaps) porSku.set(s.sku, [...(porSku.get(s.sku) ?? []), s])
  const vistos = new Set()
  const casos = []
  const descartes = { catalogo: 0, compartida: 0, baldeChico: 0, sinApi: 0, repetida: 0 }
  for (const [sku, lista] of porSku) {
    const f = ficha.get(sku)
    const orden = lista.filter((s) => Number.isFinite(+new Date(s.fecha))).sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
    for (let i = 1; i < orden.length; i++) {
      const a = orden[i - 1], b = orden[i]
      if (!Number.isFinite(a.vendidos) || !Number.isFinite(b.vendidos) || !(b.vendidos > a.vendidos)) continue
      // el primer cruce decide; los siguientes no se miran
      if (f?.tipoListing === 'catalogo') { descartes.catalogo++; break }
      if (b.vendidos < MINIMOS.balde) { descartes.baldeChico++; break }
      if (!Number.isFinite(b.numReviewsApi)) { descartes.sinApi++; break }
      if (b.numReviewsApi >= 10 && (valores.get(`${b.keyword}|${+new Date(b.fecha)}|${b.numReviewsApi}`) ?? 0) > 1) { descartes.compartida++; break }
      const id = f?.itemId ?? sku
      if (vistos.has(id)) { descartes.repetida++; break }
      vistos.add(id)
      casos.push({ itemId: id, sku, keyword: b.keyword, categoria: f?.categoriaML ?? null, balde: b.vendidos, baldeAntes: a.vendidos,
        dias: (+new Date(b.fecha) - +new Date(a.fecha)) / DIA, resenias: b.numReviewsApi, reseniasPorVenta: b.numReviewsApi / b.vendidos })
      break
    }
  }
  return { casos, descartes }
}

// Pura. MÉTODO 3: stock exacto. Por seguido, el tramo más largo de pares
// consecutivos exactos (sin balde, mismo vendedor, sin reposición), cruzado
// con las reseñas diarias de su publicación al inicio y al fin del tramo.
export function casosStock(seguidos, lecturasPorSku, reseniasPorItem) {
  const vistos = new Set()
  const casos = []
  for (const s of seguidos) {
    if (s.esPropio) continue // los propios ya son el método 1: no se cuentan dos veces
    const itemId = s.itemIdReal ?? (/^MLC\d+$/.test(s.sku) ? s.sku : null)
    if (!itemId || vistos.has(itemId)) continue
    vistos.add(itemId)
    const ls = (lecturasPorSku.get(s.sku) ?? []).filter((l) => l.ok).sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
    let mejor = null, actual = null
    for (let i = 1; i < ls.length; i++) {
      const v = ventaEntreLecturas({ ...ls[i - 1], esCatalogo: s.esCatalogo, vendedorEsperado: s.vendedor }, { ...ls[i], esCatalogo: s.esCatalogo, vendedorEsperado: s.vendedor })
      const valido = v && !v.otroVendedor && !v.repuso && v.unidades != null && !v.esPiso && ['confirmada', 'probable'].includes(v.atribucion)
      if (!valido) { actual = null; continue }
      actual = actual ? { ...actual, fin: ls[i].fecha, unidades: actual.unidades + v.unidades } : { inicio: ls[i - 1].fecha, fin: ls[i].fecha, unidades: v.unidades }
      if (!mejor || +new Date(actual.fin) - +new Date(actual.inicio) > +new Date(mejor.fin) - +new Date(mejor.inicio)) mejor = actual
    }
    if (!mejor) continue
    const dias = (+new Date(mejor.fin) - +new Date(mejor.inicio)) / DIA
    if (dias < MINIMOS.stockDias || mejor.unidades < MINIMOS.stockUnidades) continue
    const serie = reseniasPorItem.get(itemId) ?? []
    const en = (fecha) => { const d = new Date(fecha).toISOString().slice(0, 10); return serie.filter((x) => x.dia <= d).at(-1) ?? null }
    const r0 = en(mejor.inicio), r1 = en(mejor.fin)
    if (!r0 || !r1 || r1.dia === r0.dia) continue
    casos.push({ itemId, sku: s.sku, keyword: s.keyword, unidades: mejor.unidades, dias: Math.round(dias * 10) / 10,
      resenias: Math.max(0, r1.numReviews - r0.numReviews), reseniasPorVenta: Math.max(0, r1.numReviews - r0.numReviews) / mejor.unidades })
  }
  return casos
}

// Pura. ¿Coinciden? Dos métodos con casos suficientes y medianas a ±35%.
export function veredictoCalibracion(metodos) {
  const listos = Object.entries(metodos).filter(([, m]) => m.casos >= MINIMOS.casosMetodo && m.reseniasPorVenta > 0)
  if (listos.length < 2) return { estado: 'faltan-datos', listos: listos.map(([k]) => k), motivo: 'hace falta que al menos dos métodos tengan casos suficientes' }
  const valores = listos.map(([, m]) => m.reseniasPorVenta)
  const max = Math.max(...valores), min = Math.min(...valores)
  const coinciden = max / min <= 1.35
  return { estado: coinciden ? 'coinciden' : 'no-coinciden', listos: listos.map(([k]) => k), diferencia: Math.round((max / min - 1) * 100),
    ventasPorResenia: coinciden ? Math.round(1 / cuantil(valores, 0.5) * 10) / 10 : null }
}

let cache = null
export async function calibracionResenias({ ahora = new Date() } = {}) {
  if (cache && +ahora - cache.en < 30 * 60e3) return cache.valor
  // 1. propios
  const propios = await ProductoPropio.find({}).select('sku itemIdMl titulo categoriaMl mediciones.fecha mediciones.numReviews').lean()
  const ids = propios.map((p) => p.itemIdMl ?? p.sku).filter(Boolean)
  const ventas = await VentaMl.find({ estado: 'paid', 'items.itemId': { $in: ids } }).select('items').lean()
  const ventasPorItem = new Map()
  for (const v of ventas) for (const it of v.items ?? []) if (ids.includes(it.itemId) && it.cantidad > 0) ventasPorItem.set(it.itemId, (ventasPorItem.get(it.itemId) ?? 0) + it.cantidad)
  const propiosCasos = casosPropios(propios, ventasPorItem)
  // 2. balde
  const snaps = await Snapshot.find({ fecha: { $gte: new Date(+ahora - 120 * DIA) }, vendidos: { $ne: null } }).select('sku fecha keyword vendidos numReviewsApi -_id').lean()
  const productos = await Producto.find({ sku: { $in: [...new Set(snaps.map((s) => s.sku))] } }).select('sku itemId tipoListing categoriaML -_id').lean()
  const balde = casosBalde(snaps, productos)
  // 3. stock
  const seguidos = await SeguimientoStock.find({}).select('sku keyword esPropio esCatalogo vendedor itemIdReal').lean()
  const lecturas = await LecturaStock.find({ sku: { $in: seguidos.map((s) => s.sku) }, ok: true }).select('sku fecha ok stock topado fuente sellerId vendedorLeido -_id').lean()
  const lecturasPorSku = new Map()
  for (const l of lecturas) lecturasPorSku.set(l.sku, [...(lecturasPorSku.get(l.sku) ?? []), l])
  const items = seguidos.map((s) => s.itemIdReal ?? s.sku).filter(Boolean)
  const res = await LecturaResenia.find({ itemId: { $in: items } }).select('itemId dia numReviews -_id').sort({ dia: 1 }).lean()
  const reseniasPorItem = new Map()
  for (const r of res) reseniasPorItem.set(r.itemId, [...(reseniasPorItem.get(r.itemId) ?? []), r])
  const stockCasos = casosStock(seguidos, lecturasPorSku, reseniasPorItem)

  const metodos = { propios: resumirMetodo(propiosCasos), balde: resumirMetodo(balde.casos), stock: resumirMetodo(stockCasos) }
  // por categoría, solo el método con más casos (balde): para ver si varía
  const porCategoria = new Map()
  for (const c of balde.casos) if (c.categoria) porCategoria.set(c.categoria, [...(porCategoria.get(c.categoria) ?? []), c])
  const valor = {
    modo: 'auditoria', usaLaApp: false, factorActual: { ventasPorResenia: 25, origen: 'fijo, sin calibrar' },
    metodos, veredicto: veredictoCalibracion(metodos),
    notas: { balde: 'cota: al cruzar el balde lleva un poco más que el balde vendido, así que reseñas/venta real es un poco menor (y ventas/reseña un poco mayor)', stock: 'solo stock exacto del mismo vendedor, sin reposición; las reseñas llegan días después de la compra' },
    descartesBalde: balde.descartes,
    porCategoriaBalde: [...porCategoria].filter(([, cs]) => cs.length >= MINIMOS.casosMetodo).map(([categoria, cs]) => ({ categoria, ...resumirMetodo(cs) })).sort((a, b) => b.casos - a.casos),
    casos: { propios: propiosCasos, balde: balde.casos.slice(0, 40), stock: stockCasos },
  }
  cache = { en: +ahora, valor }
  return valor
}
