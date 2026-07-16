import { Producto } from '../models/Producto.js'
import { Snapshot } from '../models/Snapshot.js'
import { scoring } from '../config/scoring.js'

export function percentil(valoresOrdenados, p) {
  const n = valoresOrdenados.length
  if (!n) return null
  if (n === 1) return valoresOrdenados[0]
  const idx = (p / 100) * (n - 1)
  const abajo = Math.floor(idx)
  const arriba = Math.ceil(idx)
  if (abajo === arriba) return valoresOrdenados[abajo]
  return valoresOrdenados[abajo] + (valoresOrdenados[arriba] - valoresOrdenados[abajo]) * (idx - abajo)
}

function redondear(n, decimales = 1) {
  if (!Number.isFinite(n)) return null
  const factor = 10 ** decimales
  return Math.round(n * factor) / factor
}

// Banda de precio con más items. Ancho de bin por Freedman-Diaconis (robusto a
// outliers, frecuentes en listados de ML donde conviven accesorios y producto principal).
function bandaDominante(preciosOrdenados) {
  const n = preciosOrdenados.length
  if (!n) return null
  const min = preciosOrdenados[0]
  const max = preciosOrdenados[n - 1]
  if (min === max) return { desde: min, hasta: max, cantidad: n, pctItems: 100 }

  const iqr = percentil(preciosOrdenados, 75) - percentil(preciosOrdenados, 25)
  const anchoIdeal = iqr > 0 ? (2 * iqr) / Math.cbrt(n) : (max - min) / Math.min(8, n)
  const numBins = Math.min(30, Math.max(1, Math.ceil((max - min) / anchoIdeal)))
  const ancho = (max - min) / numBins

  const cuentas = new Array(numBins).fill(0)
  for (const precio of preciosOrdenados) {
    cuentas[Math.min(numBins - 1, Math.floor((precio - min) / ancho))]++
  }
  let mejor = 0
  for (let i = 1; i < numBins; i++) if (cuentas[i] > cuentas[mejor]) mejor = i

  return {
    desde: Math.round(min + mejor * ancho),
    hasta: Math.round(min + (mejor + 1) * ancho),
    cantidad: cuentas[mejor],
    pctItems: redondear((cuentas[mejor] / n) * 100),
  }
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

// Serie de un campo numérico con delta entre el scan actual y el anterior.
function extraerSenal(snapshots, snapshotsPrevios, campo) {
  const valores = snapshots.map((s) => s[campo]).filter(Number.isFinite)
  if (!valores.length) return null

  const orden = [...valores].sort((a, b) => a - b)
  const senal = {
    itemsConDato: valores.length,
    total: valores.reduce((a, b) => a + b, 0),
    mediana: redondear(percentil(orden, 50), 0),
    delta: null, // requiere >= 2 scans con el dato
    periodoDias: null,
    porDia: null,
    itemsComparables: null,
  }

  if (snapshotsPrevios?.length) {
    const previosPorSku = new Map(
      snapshotsPrevios.filter((s) => Number.isFinite(s[campo])).map((s) => [s.sku, s]),
    )
    let delta = 0
    let comparables = 0
    let fechaPrevia = null
    for (const snap of snapshots) {
      const previo = previosPorSku.get(snap.sku)
      if (!previo || !Number.isFinite(snap[campo])) continue
      comparables++
      delta += Math.max(0, snap[campo] - previo[campo])
      fechaPrevia = previo.fecha
    }
    if (comparables > 0 && fechaPrevia) {
      const dias = Math.max(
        (new Date(snapshots[0].fecha) - new Date(fechaPrevia)) / 86_400_000,
        1 / 24, // piso de 1 hora para no dividir por ~0 en re-scans seguidos
      )
      senal.delta = delta
      senal.periodoDias = redondear(dias, 1)
      senal.porDia = redondear(delta / dias, 1)
      senal.itemsComparables = comparables
    }
  }

  return senal
}

// Demanda del nicho. ML no expone vendidos exactos (buckets congelados), así que la
// señal continua es el conteo de reseñas (exacto, se mueve a diario): delta de
// reseñas × factor = ventas estimadas del período — la métrica estrella.
export function calcularDemanda(snapshots, snapshotsPrevios = null) {
  const vendidos = extraerSenal(snapshots, snapshotsPrevios, 'vendidos')
  const reviews = extraerSenal(snapshots, snapshotsPrevios, 'numReviews')
  if (!vendidos && !reviews) return null

  const factor = scoring.escalas.reviewsAVentasFactor
  const ventasEstimadasPorDia =
    vendidos?.porDia ?? (reviews?.porDia != null ? redondear(reviews.porDia * factor, 1) : null)
  const volumenVentasEstimado = vendidos?.total ?? (reviews ? reviews.total * factor : null)

  return {
    base: vendidos ? 'vendidos' : 'reviews',
    vendidos,
    reviews,
    ventasEstimadasPorDia,
    volumenVentasEstimado,
  }
}

// Score 0-100 según config/scoring.js. Devuelve null si aún no hay datos de demanda.
export function calcularScoreOportunidad({ demanda, competencia, calidad }) {
  if (!demanda || !Number.isFinite(demanda.volumenVentasEstimado)) return null
  const { pesos, umbrales, escalas } = scoring

  const componenteDemanda = clamp(
    escalas.demandaFactorLog * Math.log10(1 + demanda.volumenVentasEstimado),
    0,
    100,
  )
  const componenteCompetencia = clamp(100 - (competencia.concentracionTop3Pct ?? 100), 0, 100)
  const rating = calidad.ratingPromedio
  const componenteCalidad = Number.isFinite(rating)
    ? clamp(
        ((umbrales.ratingDiferenciacion - rating) / (umbrales.ratingDiferenciacion - umbrales.ratingPiso)) * 100,
        0,
        100,
      )
    : 50 // sin ratings: neutro
  const componenteFull = clamp(100 - (competencia.pctFull ?? 0), 0, 100)

  const score = Math.round(
    pesos.demanda * componenteDemanda +
      pesos.competencia * componenteCompetencia +
      pesos.calidad * componenteCalidad +
      pesos.full * componenteFull,
  )

  return {
    score,
    componentes: {
      demanda: Math.round(componenteDemanda),
      competencia: Math.round(componenteCompetencia),
      calidad: Math.round(componenteCalidad),
      full: Math.round(componenteFull),
    },
  }
}

// Scorecard: precio + competencia + calidad sobre el top-N por posición;
// demanda y score si el nivel 2 ya aportó `vendidos`.
export function calcularMetricas({
  snapshots,
  productosPorSku,
  totalResultados = null,
  topN = 50,
  snapshotsPrevios = null,
}) {
  const top = [...snapshots]
    .sort((a, b) => (a.posicion ?? Infinity) - (b.posicion ?? Infinity))
    .slice(0, topN)
  const n = top.length

  const precios = top
    .map((s) => s.precio)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const descuentos = top.map((s) => s.descuentoPct).filter((d) => Number.isFinite(d) && d > 0)
  const ratings = top.map((s) => s.rating).filter(Number.isFinite)

  const cuentaPorVendedor = new Map()
  let oficiales = 0
  let full = 0
  let rapido = 0
  let conVendedor = 0
  for (const snap of top) {
    const prod = productosPorSku.get(snap.sku)
    if (!prod) continue
    if (prod.esTiendaOficial) oficiales++
    if (prod.esFull) full++
    if (prod.envioRapido) rapido++
    if (prod.vendedor) {
      conVendedor++
      cuentaPorVendedor.set(prod.vendedor, (cuentaPorVendedor.get(prod.vendedor) ?? 0) + 1)
    }
  }
  const vendedoresOrdenados = [...cuentaPorVendedor.entries()].sort((a, b) => b[1] - a[1])
  const itemsTop3 = vendedoresOrdenados.slice(0, 3).reduce((acum, [, cuenta]) => acum + cuenta, 0)

  const pct = (parte, total = n) => (total > 0 ? redondear((parte / total) * 100) : null)

  const competencia = {
    sellersUnicos: cuentaPorVendedor.size,
    pctTiendaOficial: pct(oficiales),
    concentracionTop3Pct: conVendedor > 0 ? redondear((itemsTop3 / conVendedor) * 100) : null,
    pctFull: pct(full),
    pctEnvioRapido: pct(rapido),
    topSellers: vendedoresOrdenados
      .slice(0, 5)
      .map(([vendedor, items]) => ({ vendedor, items, pctItems: pct(items) })),
  }

  const calidad = {
    ratingPromedio: ratings.length
      ? redondear(ratings.reduce((a, b) => a + b, 0) / ratings.length, 2)
      : null,
    pctConRating: pct(ratings.length),
  }

  const demanda = calcularDemanda(top, snapshotsPrevios)
  const oportunidad = calcularScoreOportunidad({ demanda, competencia, calidad })

  return {
    universo: {
      productosAnalizados: n,
      totalResultadosBusqueda: totalResultados?.total ?? null,
      totalEsMinimo: totalResultados?.esMinimo ?? null,
    },
    precio: {
      mediana: redondear(percentil(precios, 50), 2),
      p25: redondear(percentil(precios, 25), 2),
      p75: redondear(percentil(precios, 75), 2),
      min: precios[0] ?? null,
      max: precios.at(-1) ?? null,
      bandaDominante: bandaDominante(precios),
      descuentoPromedioPct: descuentos.length
        ? redondear(descuentos.reduce((a, b) => a + b, 0) / descuentos.length)
        : null,
      pctConDescuento: pct(descuentos.length),
    },
    competencia,
    calidad,
    demanda, // null hasta que el nivel 2 aporte `vendidos`
    oportunidad, // { score, componentes } | null
    scoreOportunidad: oportunidad?.score ?? null,
  }
}

// Vista producto+snapshot del último scan (tabla del dashboard y análisis IA).
export async function obtenerProductosUltimoScan(nicho) {
  const ultimo = await Snapshot.findOne({ keyword: nicho.keyword }).sort({ fecha: -1 }).lean()
  if (!ultimo) return null

  const snapshots = await Snapshot.find({ keyword: nicho.keyword, fecha: ultimo.fecha })
    .sort({ posicion: 1 })
    .lean()
  const productos = await Producto.find({ sku: { $in: snapshots.map((s) => s.sku) } }).lean()
  const porSku = new Map(productos.map((p) => [p.sku, p]))

  return {
    fechaScan: ultimo.fecha,
    productos: snapshots.map((s) => {
      const p = porSku.get(s.sku) ?? {}
      return {
        sku: s.sku,
        posicion: s.posicion,
        titulo: p.titulo ?? null,
        url: p.url ?? null,
        imagen: p.imagen ?? null,
        precio: s.precio,
        precioAnterior: s.precioAnterior,
        descuentoPct: s.descuentoPct,
        rating: s.rating,
        numReviews: s.numReviews,
        cuotas: s.cuotas,
        vendedor: p.vendedor ?? null,
        sellerId: p.sellerId ?? null,
        esTiendaOficial: p.esTiendaOficial ?? false,
        esFull: p.esFull ?? false,
        envioRapido: p.envioRapido ?? false,
        origenCrossBorder: p.origenCrossBorder ?? false,
        tipoListing: p.tipoListing ?? null,
        primeraVezVisto: p.primeraVezVisto ?? null,
      }
    }),
  }
}

// Arma el reporte del último scan de un nicho leyendo de Mongo.
export async function generarReporteNicho(nicho, { topN = 50 } = {}) {
  const ultimoSnap = await Snapshot.findOne({ keyword: nicho.keyword }).sort({ fecha: -1 }).lean()
  if (!ultimoSnap) return null

  const snapshots = await Snapshot.find({ keyword: nicho.keyword, fecha: ultimoSnap.fecha }).lean()
  const productos = await Producto.find({ sku: { $in: snapshots.map((s) => s.sku) } }).lean()
  const productosPorSku = new Map(productos.map((p) => [p.sku, p]))

  // scan anterior para el delta de vendidos
  const snapPrevio = await Snapshot.findOne({ keyword: nicho.keyword, fecha: { $lt: ultimoSnap.fecha } })
    .sort({ fecha: -1 })
    .lean()
  const snapshotsPrevios = snapPrevio
    ? await Snapshot.find({ keyword: nicho.keyword, fecha: snapPrevio.fecha }).lean()
    : null

  const metricas = calcularMetricas({
    snapshots,
    productosPorSku,
    totalResultados: nicho.ultimoTotalResultados ?? null,
    topN,
    snapshotsPrevios,
  })

  const topProductos = [...snapshots]
    .sort((a, b) => (a.posicion ?? Infinity) - (b.posicion ?? Infinity))
    .slice(0, 10)
    .map((snap) => {
      const prod = productosPorSku.get(snap.sku)
      return {
        sku: snap.sku,
        posicion: snap.posicion,
        titulo: prod?.titulo ?? null,
        imagen: prod?.imagen ?? null,
        precio: snap.precio,
        descuentoPct: snap.descuentoPct,
        rating: snap.rating,
        vendedor: prod?.vendedor ?? null,
        esTiendaOficial: prod?.esTiendaOficial ?? null,
        esFull: prod?.esFull ?? null,
        tipoListing: prod?.tipoListing ?? null,
        url: prod?.url ?? null,
      }
    })

  return {
    fechaScan: ultimoSnap.fecha,
    metricas,
    topProductos,
    topSellers: metricas.competencia.topSellers,
  }
}
