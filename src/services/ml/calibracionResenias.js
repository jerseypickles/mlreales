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
//
// LAS RESEÑAS LLEGAN TARDE. Medido el 1-oct-2026 en las 21 reseñas propias con
// fecha de compra: mediana 5 días entre compra y reseña, y 1 de cada 4 tarda
// más de 3 semanas (hasta 41 días). Contar todas las ventas contra las reseñas
// de hoy mete en el denominador las compras del último mes, que todavía no
// alcanzan a reseñar: el factor sale inflado. Con `maduras` (unidades vendidas
// antes del corte) y `resenias` (total de la API + fechas de compra de las que
// se pueden paginar) se cuentan solo las compras de hace más de DIAS_MADURAS
// días y la fracción de reseñas que vino de ellas.
export const DIAS_MADURAS = 30
export function casosPropios(propios, ventasPorItem, { maduras = null, resenias = null, corte = null } = {}) {
  const vistos = new Set()
  const casos = []
  for (const p of propios) {
    const id = p.itemIdMl ?? p.sku
    if (!id || vistos.has(id)) continue
    vistos.add(id)
    const api = resenias?.get(id)
    if (maduras && api && corte) {
      const unidades = maduras.get(id) ?? 0
      if (unidades < MINIMOS.propiosUnidades) continue
      const fechas = api.fechasCompra ?? []
      const antes = fechas.filter((f) => f && new Date(f) <= corte).length
      // sin fechas paginables: todas cuentan como maduras (cota alta)
      const resMaduras = fechas.length ? api.total * antes / fechas.length : api.total
      casos.push({ itemId: id, titulo: p.titulo, categoria: p.categoriaMl ?? null, unidades, unidadesTotales: ventasPorItem.get(id) ?? 0,
        resenias: Math.round(resMaduras * 10) / 10, reseniasTotales: api.total, maduras: true, reseniasPorVenta: resMaduras / unidades })
      continue
    }
    const unidades = ventasPorItem.get(id) ?? 0
    const ultima = [...(p.mediciones ?? [])].filter((m) => Number.isFinite(m.numReviews)).sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha)).at(-1)
    if (unidades < MINIMOS.propiosUnidades || !ultima) continue
    casos.push({ itemId: id, titulo: p.titulo, categoria: p.categoriaMl ?? null, unidades, resenias: ultima.numReviews, reseniasPorVenta: ultima.numReviews / unidades })
  }
  return casos
}

// Pura. Días entre compra y reseña: cuánto hay que esperar antes de contar.
export function demoraResenias(pares) {
  const dias = pares.map(([compra, resenia]) => (+new Date(resenia) - +new Date(compra)) / DIA).filter((x) => Number.isFinite(x) && x >= 0)
  if (!dias.length) return null
  return { casos: dias.length, mediana: Math.round(cuantil(dias, 0.5)), p75: Math.round(cuantil(dias, 0.75)), max: Math.round(Math.max(...dias)),
    pctMas21: Math.round(dias.filter((x) => x > 21).length / dias.length * 100) }
}

// Pura. Agrupado: suma de reseñas / suma de unidades. La mediana por producto
// esconde que unos productos reseñan y otros no (juguete y gadget: 0 de 62).
export function agrupado(casos) {
  const u = casos.reduce((a, c) => a + c.unidades, 0), r = casos.reduce((a, c) => a + c.resenias, 0)
  return u ? { unidades: u, resenias: Math.round(r * 10) / 10, reseniasPorVenta: r3(r / u), ventasPorResenia: r > 0 ? Math.round(u / r * 10) / 10 : null,
    sinResenias: casos.filter((c) => c.resenias === 0).length } : null
}

// Pura. MÉTODO 2: balde de vendidos. snaps: lecturas del panel; productos:
// Producto (tipoListing, itemId, categoría). Una observación por publicación:
// su PRIMER cruce de balde con reseñas de API en la lectura del cruce.
export function casosBalde(snaps, productos) {
  const ficha = new Map(productos.map((p) => [p.sku, p]))
  // reseñas compartidas: mismo valor de API en otra publicación del mismo scan
  const valores = new Map()
  // ML cerró la API para ajenos el 29-sep-2026: en publicaciones SUELTAS la
  // ficha da el mismo conteo que la API (11 de 11 medidas), así que sigue
  // calibrando con la ficha. En catálogo no: ahí la ficha suma a todos los
  // vendedores, y el catálogo ya está fuera de este método.
  const conteo = (s) => (Number.isFinite(s.numReviewsApi) ? s.numReviewsApi : Number.isFinite(s.numReviews) ? s.numReviews : null)
  const fuenteDe = (s) => (Number.isFinite(s.numReviewsApi) ? 'api' : 'ficha')
  for (const s of snaps) {
    if (!(conteo(s) >= 10)) continue
    const k = `${s.keyword}|${+new Date(s.fecha)}|${conteo(s)}`
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
      const n = conteo(b)
      if (!Number.isFinite(n)) { descartes.sinApi++; break }
      if (n >= 10 && (valores.get(`${b.keyword}|${+new Date(b.fecha)}|${n}`) ?? 0) > 1) { descartes.compartida++; break }
      const id = f?.itemId ?? sku
      if (vistos.has(id)) { descartes.repetida++; break }
      vistos.add(id)
      casos.push({ itemId: id, sku, keyword: b.keyword, categoria: f?.categoriaML ?? null, balde: b.vendidos, baldeAntes: a.vendidos,
        dias: (+new Date(b.fecha) - +new Date(a.fecha)) / DIA, resenias: n, fuente: fuenteDe(b), reseniasPorVenta: n / b.vendidos })
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
    // un salto de fuente dentro de la ventana (ML agrupó reseñas) no es venta
    const tramo = serie.filter((x) => x.dia >= r0.dia && x.dia <= r1.dia)
    if (tramo.some((x, i) => i > 0 && x.numReviews - tramo[i - 1].numReviews > 50 && x.numReviews - tramo[i - 1].numReviews > tramo[i - 1].numReviews * 0.5)) continue
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
  // las reseñas PROPIAS siguen abiertas en la API: total + fechas de compra
  const corte = new Date(+ahora - DIAS_MADURAS * DIA)
  const maduras = new Map()
  const ventasMaduras = await VentaMl.find({ estado: 'paid', 'items.itemId': { $in: ids }, fecha: { $lte: corte } }).select('items').lean()
  for (const v of ventasMaduras) for (const it of v.items ?? []) if (ids.includes(it.itemId) && it.cantidad > 0) maduras.set(it.itemId, (maduras.get(it.itemId) ?? 0) + it.cantidad)
  const resenias = new Map()
  const pares = []
  try {
    const { meliGet } = await import('../meli.js')
    for (const id of ids.filter((i) => (ventasPorItem.get(i) ?? 0) >= MINIMOS.propiosUnidades)) {
      const r = await meliGet(`/reviews/item/${id}?limit=50`).catch(() => null)
      if (!Number.isFinite(r?.paging?.total)) continue
      const lista = r.reviews ?? []
      resenias.set(id, { total: r.paging.total, fechasCompra: lista.map((x) => x.buying_date).filter(Boolean) })
      for (const x of lista) if (x.buying_date && x.date_created) pares.push([x.buying_date, x.date_created])
    }
  } catch {
    // sin API propia queda el método crudo
  }
  const propiosCasos = casosPropios(propios, ventasPorItem, resenias.size ? { maduras, resenias, corte } : {})
  // 2. balde
  const snaps = await Snapshot.find({ fecha: { $gte: new Date(+ahora - 120 * DIA) }, vendidos: { $ne: null } }).select('sku fecha keyword vendidos numReviewsApi numReviews -_id').lean()
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
    propiosAgrupado: agrupado(propiosCasos),
    demoraResenias: demoraResenias(pares),
    baldePorFuente: { api: balde.casos.filter((c) => c.fuente === 'api').length, ficha: balde.casos.filter((c) => c.fuente === 'ficha').length },
    notas: { balde: 'cota: al cruzar el balde lleva un poco más que el balde vendido, así que reseñas/venta real es un poco menor (y ventas/reseña un poco mayor)', stock: 'solo stock exacto del mismo vendedor, sin reposición; las reseñas llegan días después de la compra' },
    descartesBalde: balde.descartes,
    porCategoriaBalde: [...porCategoria].filter(([, cs]) => cs.length >= MINIMOS.casosMetodo).map(([categoria, cs]) => ({ categoria, ...resumirMetodo(cs) })).sort((a, b) => b.casos - a.casos),
    casos: { propios: propiosCasos, balde: balde.casos.slice(0, 40), stock: stockCasos },
  }
  cache = { en: +ahora, valor }
  return valor
}
