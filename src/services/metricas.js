import { Producto } from '../models/Producto.js'
import { Snapshot } from '../models/Snapshot.js'

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

// Scorecard Fase 1: precio + competencia + calidad sobre el top-N por posición.
// `demanda` y `scoreOportunidad` quedan en null hasta que el nivel 2 aporte `vendidos`.
export function calcularMetricas({ snapshots, productosPorSku, totalResultados = null, topN = 50 }) {
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
    competencia: {
      sellersUnicos: cuentaPorVendedor.size,
      pctTiendaOficial: pct(oficiales),
      concentracionTop3Pct: conVendedor > 0 ? redondear((itemsTop3 / conVendedor) * 100) : null,
      pctFull: pct(full),
      pctEnvioRapido: pct(rapido),
      topSellers: vendedoresOrdenados
        .slice(0, 5)
        .map(([vendedor, items]) => ({ vendedor, items, pctItems: pct(items) })),
    },
    calidad: {
      ratingPromedio: ratings.length
        ? redondear(ratings.reduce((a, b) => a + b, 0) / ratings.length, 2)
        : null,
      pctConRating: pct(ratings.length),
    },
    demanda: null, // Fase 2: requiere `vendidos` del nivel 2
    scoreOportunidad: null, // Fase 2: ver config/scoring.js
  }
}

// Arma el reporte del último scan de un nicho leyendo de Mongo.
export async function generarReporteNicho(nicho, { topN = 50 } = {}) {
  const ultimoSnap = await Snapshot.findOne({ keyword: nicho.keyword }).sort({ fecha: -1 }).lean()
  if (!ultimoSnap) return null

  const snapshots = await Snapshot.find({ keyword: nicho.keyword, fecha: ultimoSnap.fecha }).lean()
  const productos = await Producto.find({ sku: { $in: snapshots.map((s) => s.sku) } }).lean()
  const productosPorSku = new Map(productos.map((p) => [p.sku, p]))

  const metricas = calcularMetricas({
    snapshots,
    productosPorSku,
    totalResultados: nicho.ultimoTotalResultados ?? null,
    topN,
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
