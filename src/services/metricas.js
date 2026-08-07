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
// depurar (solo reseñas): filtra los artefactos de los agregados de catálogo
// — saltos de nivel imposibles y conteos duplicados entre listings hermanos —
// que de otro modo se multiplican por el factor 25 (ver scoring.depuracionDelta).
function extraerSenal(snapshots, snapshotsPrevios, campo, { depurar = false } = {}) {
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
    const pares = []
    let fechaPrevia = null
    for (const snap of snapshots) {
      const previo = previosPorSku.get(snap.sku)
      if (!previo || !Number.isFinite(snap[campo])) continue
      pares.push({ antes: previo[campo], ahora: snap[campo] })
      fechaPrevia = previo.fecha
    }
    if (pares.length && fechaPrevia) {
      const dias = Math.max(
        (new Date(snapshots[0].fecha) - new Date(fechaPrevia)) / 86_400_000,
        1 / 24, // piso de 1 hora para no dividir por ~0 en re-scans seguidos
      )
      const dep = depurar ? scoring.depuracionDelta : null
      const vistos = new Set()
      let delta = 0
      let deltaBruto = 0
      let saltosFiltrados = 0
      let duplicadosCatalogo = 0
      for (const { antes, ahora } of pares) {
        const d = Math.max(0, ahora - antes)
        deltaBruto += d
        if (dep && d > 0 && antes >= dep.dedupeMinConteo) {
          const clave = `${antes}→${ahora}`
          if (vistos.has(clave)) {
            duplicadosCatalogo++
            continue
          }
          vistos.add(clave)
        }
        if (dep && d > Math.max(dep.pisoPorDia, dep.maxPctDia * antes) * dias) {
          saltosFiltrados++
          continue
        }
        delta += d
      }
      senal.delta = delta
      senal.periodoDias = redondear(dias, 1)
      senal.porDia = redondear(delta / dias, 1)
      senal.itemsComparables = pares.length
      if (saltosFiltrados || duplicadosCatalogo) {
        senal.deltaBruto = deltaBruto
        senal.saltosFiltrados = saltosFiltrados
        senal.duplicadosCatalogo = duplicadosCatalogo
      }
    }
  }

  return senal
}

// Segundo proxy de demanda: preguntas NUEVAS de compradores entre dos scans.
// Los ids de pregunta son únicos globales → el set deduplica solo los listings
// hermanos que comparten catálogo; la lista visible es acotada, así que el
// resultado es un PISO ("al menos N preguntas nuevas"), inmune a los saltos
// de agregado que ensucian las reseñas. Sirve de contraste: reseñas volando
// con cero preguntas nuevas = sospecha.
function extraerSenalPreguntas(snapshots, snapshotsPrevios) {
  const conIds = snapshots.filter((s) => Array.isArray(s.preguntasIds) && s.preguntasIds.length)
  if (!conIds.length || !snapshotsPrevios?.length) return null
  const previosPorSku = new Map(
    snapshotsPrevios.filter((s) => Array.isArray(s.preguntasIds)).map((s) => [s.sku, s]),
  )
  const nuevas = new Set()
  let comparables = 0
  let fechaPrevia = null
  for (const snap of conIds) {
    const previo = previosPorSku.get(snap.sku)
    if (!previo) continue
    comparables++
    fechaPrevia = previo.fecha
    const idsPrevios = new Set(previo.preguntasIds)
    for (const id of snap.preguntasIds) if (!idsPrevios.has(id)) nuevas.add(id)
  }
  if (!comparables || !fechaPrevia) return null
  const dias = Math.max((new Date(snapshots[0].fecha) - new Date(fechaPrevia)) / 86_400_000, 1 / 24)
  return {
    nuevas: nuevas.size,
    periodoDias: redondear(dias, 1),
    porDia: redondear(nuevas.size / dias, 1),
    itemsComparables: comparables,
  }
}

// Demanda del nicho. ML no expone vendidos exactos (buckets congelados), así que la
// señal continua es el conteo de reseñas (exacto, se mueve a diario): delta de
// reseñas × factor = ventas estimadas del período — la métrica estrella.
export function calcularDemanda(
  snapshots,
  snapshotsPrevios = null,
  { minItems = scoring.umbrales.minItemsDemanda } = {},
) {
  const vendidos = extraerSenal(snapshots, snapshotsPrevios, 'vendidos')
  const reviews = extraerSenal(snapshots, snapshotsPrevios, 'numReviews', { depurar: true })
  if (!vendidos && !reviews) return null

  // representatividad: si la señal sale de una muestra ínfima (detalle aplicado
  // a medias por bloqueo de ML), diría "demanda 0" con cara seria — sin score
  // el pipeline espera el reintento en vez de vender un número falso
  if ((vendidos ?? reviews).itemsConDato < minItems) return null

  const factor = scoring.escalas.reviewsAVentasFactor
  const ventasEstimadasPorDia =
    vendidos?.porDia ?? (reviews?.porDia != null ? redondear(reviews.porDia * factor, 1) : null)
  const volumenVentasEstimado = vendidos?.total ?? (reviews ? reviews.total * factor : null)

  return {
    base: vendidos ? 'vendidos' : 'reviews',
    vendidos,
    reviews,
    preguntas: extraerSenalPreguntas(snapshots, snapshotsPrevios),
    ventasEstimadasPorDia,
    volumenVentasEstimado,
    // resolución de la medición: 1 reseña en esta ventana = este número de
    // ventas/día — un 0 medido significa "bajo este piso", no "nadie compra"
    pisoDeteccionVentasDia:
      reviews?.periodoDias != null ? redondear(factor / reviews.periodoDias, 0) : null,
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
  // misma filosofía que minItemsDemanda: con pocos productos calificados el
  // promedio no prueba nada (dos ratings 5.0 de 3 reseñas marcan "calidad 0"
  // falso) — mejor neutro que extremo con evidencia fina
  const rating = calidad.ratingPromedio
  const ratingsSuficientes = (calidad.itemsConRating ?? 0) >= (umbrales.minItemsCalidad ?? 0)
  const componenteCalidad =
    Number.isFinite(rating) && ratingsSuficientes
      ? clamp(
          ((umbrales.ratingDiferenciacion - rating) / (umbrales.ratingDiferenciacion - umbrales.ratingPiso)) * 100,
          0,
          100,
        )
      : 50 // sin ratings (o muy pocos): neutro
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
  const infoVendedor = new Map() // reputación/power seller del nivel 2, primera vista
  let oficiales = 0
  let full = 0
  let conDatoFull = 0
  let rapido = 0
  let conVendedor = 0
  for (const snap of top) {
    const prod = productosPorSku.get(snap.sku)
    if (!prod) continue
    if (prod.esTiendaOficial) oficiales++
    // esFull null = el listado no mostró el flag: no cuenta ni a favor ni en
    // contra (mismo criterio que reviews null: sin medir ≠ cero)
    if (prod.esFull != null) {
      conDatoFull++
      if (prod.esFull) full++
    }
    if (prod.envioRapido) rapido++
    if (prod.vendedor) {
      conVendedor++
      cuentaPorVendedor.set(prod.vendedor, (cuentaPorVendedor.get(prod.vendedor) ?? 0) + 1)
      if (!infoVendedor.has(prod.vendedor) && (prod.reputacionSeller || prod.powerSeller)) {
        infoVendedor.set(prod.vendedor, {
          reputacion: prod.reputacionSeller ?? null,
          powerSeller: prod.powerSeller ?? null,
        })
      }
    }
  }
  const vendedoresOrdenados = [...cuentaPorVendedor.entries()].sort((a, b) => b[1] - a[1])
  const itemsTop3 = vendedoresOrdenados.slice(0, 3).reduce((acum, [, cuenta]) => acum + cuenta, 0)

  const pct = (parte, total = n) => (total > 0 ? redondear((parte / total) * 100) : null)

  const competencia = {
    sellersUnicos: cuentaPorVendedor.size,
    pctTiendaOficial: pct(oficiales),
    concentracionTop3Pct: conVendedor > 0 ? redondear((itemsTop3 / conVendedor) * 100) : null,
    pctFull: conDatoFull > 0 ? pct(full, conDatoFull) : null,
    itemsConDatoFull: conDatoFull,
    pctEnvioRapido: pct(rapido),
    topSellers: vendedoresOrdenados
      .slice(0, 5)
      .map(([vendedor, items]) => ({ vendedor, items, pctItems: pct(items), ...(infoVendedor.get(vendedor) ?? {}) })),
  }

  const calidad = {
    ratingPromedio: ratings.length
      ? redondear(ratings.reduce((a, b) => a + b, 0) / ratings.length, 2)
      : null,
    pctConRating: pct(ratings.length),
    itemsConRating: ratings.length,
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

  // el nivel 2 puede fallar parcialmente (bloqueos de ML): para reviews/rating usar
  // el último valor conocido — son acumulativos, el dato anterior sigue siendo válido
  const sinReviews = snapshots.filter((s) => !Number.isFinite(s.numReviews)).map((s) => s.sku)
  const previos = sinReviews.length
    ? await Snapshot.aggregate([
        { $match: { sku: { $in: sinReviews }, numReviews: { $ne: null } } },
        { $sort: { fecha: -1 } },
        { $group: { _id: '$sku', numReviews: { $first: '$numReviews' }, rating: { $first: '$rating' } } },
      ])
    : []
  const reviewsPrevias = new Map(previos.map((p) => [p._id, p]))
  for (const snap of snapshots) {
    if (!Number.isFinite(snap.numReviews) && reviewsPrevias.has(snap.sku)) {
      const previo = reviewsPrevias.get(snap.sku)
      snap.numReviews = previo.numReviews
      if (!Number.isFinite(snap.rating)) snap.rating = previo.rating
    }
  }

  // velocidad POR PRODUCTO: delta de reseñas entre las dos últimas mediciones
  // reales separadas ≥12h, normalizado a ventas/día. Ordenar por reseñas
  // acumuladas dice quién ganó históricamente; esto dice quién vende AHORA.
  const historial = await Snapshot.aggregate([
    { $match: { sku: { $in: snapshots.map((s) => s.sku) }, numReviews: { $ne: null } } },
    { $sort: { fecha: -1 } },
    { $group: { _id: '$sku', mediciones: { $push: { fecha: '$fecha', numReviews: '$numReviews' } } } },
  ])
  const velocidadPorSku = new Map()
  const dep = scoring.depuracionDelta
  for (const h of historial) {
    const [ultima, ...resto] = h.mediciones
    // misma ventana mínima que el delta del nicho (resolución); si la serie es
    // nueva, cae a ≥12h para no quedarse ciego
    const previa =
      resto.find((m) => ultima.fecha - m.fecha >= dep.ventanaMinDias * 86_400_000) ??
      resto.find((m) => ultima.fecha - m.fecha >= 12 * 3600e3)
    if (!previa) continue
    const dias = (ultima.fecha - previa.fecha) / 86400e3
    const delta = Math.max(0, ultima.numReviews - previa.numReviews)
    // mismo filtro que el delta del nicho: un agregado de catálogo que saltó de
    // nivel no es velocidad de venta — mejor "sin medir" que un número absurdo
    const salto = delta > Math.max(dep.pisoPorDia, dep.maxPctDia * previa.numReviews) * dias
    velocidadPorSku.set(h._id, {
      ventasDia: salto ? null : Math.round((delta / dias) * scoring.escalas.reviewsAVentasFactor),
      reviewsDelta: delta,
      ventanaDias: Math.round(dias * 10) / 10,
      saltoCatalogo: salto || undefined,
    })
  }

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
        ventasDia: velocidadPorSku.get(s.sku)?.ventasDia ?? null,
        reviewsDelta: velocidadPorSku.get(s.sku)?.reviewsDelta ?? null,
        ventanaDias: velocidadPorSku.get(s.sku)?.ventanaDias ?? null,
        saltoCatalogo: velocidadPorSku.get(s.sku)?.saltoCatalogo ?? null,
        cuotas: s.cuotas,
        vendedor: p.vendedor ?? null,
        sellerId: p.sellerId ?? null,
        reputacionSeller: p.reputacionSeller ?? null,
        powerSeller: p.powerSeller ?? null,
        categoriaRuta: p.categoriaRuta ?? null,
        preguntas: p.preguntas ?? null,
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

// Unidades por pack declaradas en el título ("pack de 12", "x60", "60 unidades").
// null si no declara. Evita falsos positivos de dimensiones (60x40cm), medidas
// (60cm/ml/gb), potencias (60w) y promos (2x1).
export function unidadesDelTitulo(titulo) {
  const t = String(titulo ?? '').toLowerCase()
  const candidatos = []

  let m = t.match(/\bpack\s*(?:de\s*)?x?\s*(\d{1,4})\b/)
  if (m) candidatos.push(Number(m[1]))

  m = t.match(/\bset\s*(?:de\s*)?(\d{1,4})\b/)
  if (m) candidatos.push(Number(m[1]))

  m = t.match(/\b(\d{1,4})\s*(?:unidades|unidad|unid\.?|uds?\.?|und\.?|piezas|pzas\.?|sobres|rollos|pares|sachets?)\b/)
  if (m) candidatos.push(Number(m[1]))

  // "x60" suelto: no precedido por dígito (60x40) ni seguido de unidad de medida
  m = t.match(/(?<![\dx])x\s?(\d{2,4})\b(?!\s*(?:cm|mm|mts?|m\b|w\b|v\b|ml|lts?|grs?\b|kg|gb|tb|mah|led|colores|hojas))/)
  if (m) candidatos.push(Number(m[1]))

  const validos = candidatos.filter((n) => n >= 2 && n <= 1000)
  return validos.length ? Math.max(...validos) : null
}

// Distribución de precio POR UNIDAD para nichos que venden en packs: el precio
// por listing mezcla el pack de 3 con el de 60 y su mediana no compara nada.
// null si ningún listing declara pack (nicho unitario: no aporta).
export function preciosPorUnidad({ snapshots, productosPorSku }) {
  const precios = []
  let listingsConPack = 0
  for (const snap of snapshots) {
    if (!Number.isFinite(snap.precio)) continue
    const unidades = unidadesDelTitulo(productosPorSku.get(snap.sku)?.titulo)
    if (unidades) listingsConPack++
    precios.push(snap.precio / (unidades ?? 1))
  }
  if (!listingsConPack || !precios.length) return null
  precios.sort((a, b) => a - b)
  const cuantil = (p) => precios[Math.min(precios.length - 1, Math.floor(p * precios.length))]
  return {
    mediana: Math.round(cuantil(0.5)),
    p25: Math.round(cuantil(0.25)),
    p75: Math.round(cuantil(0.75)),
    listingsConPack,
    pctConPack: Math.round((listingsConPack / precios.length) * 100),
  }
}

// Sellers "gemelos": vendedores NO oficiales, chicos, que están ganando
// reseñas AHORA dentro del nicho — la prueba directa de que un entrante
// genérico (como el importador) puede vender aquí. Requiere dos scans.
export function detectarSellersGemelos({ snapshots, productosPorSku, snapshotsPrevios }) {
  if (!snapshotsPrevios?.length) return null
  const previasPorSku = new Map(snapshotsPrevios.map((s) => [s.sku, s.numReviews]))

  const porSeller = new Map()
  for (const snap of snapshots) {
    const prod = productosPorSku.get(snap.sku)
    if (!prod?.vendedor || prod.esTiendaOficial) continue
    const antes = previasPorSku.get(snap.sku)
    if (!Number.isFinite(snap.numReviews) || !Number.isFinite(antes)) continue
    const g = porSeller.get(prod.vendedor) ?? {
      vendedor: prod.vendedor,
      productos: 0,
      reviewsNuevas: 0,
      reviewsTotal: 0,
    }
    g.productos++
    g.reviewsNuevas += Math.max(0, snap.numReviews - antes)
    g.reviewsTotal += snap.numReviews
    porSeller.set(prod.vendedor, g)
  }

  // "chico" = venía con ≤500 reseñas acumuladas en el nicho antes de crecer:
  // un no-oficial gigante no es gemelo de un entrante
  return [...porSeller.values()]
    .filter((g) => g.reviewsNuevas > 0 && g.reviewsTotal - g.reviewsNuevas <= 500)
    .sort((a, b) => b.reviewsNuevas - a.reviewsNuevas)
    .slice(0, 5)
}

// Arma el reporte del último scan de un nicho leyendo de Mongo.
export async function generarReporteNicho(nicho, { topN = 50 } = {}) {
  const ultimoSnap = await Snapshot.findOne({ keyword: nicho.keyword }).sort({ fecha: -1 }).lean()
  if (!ultimoSnap) return null

  const snapshots = await Snapshot.find({ keyword: nicho.keyword, fecha: ultimoSnap.fecha }).lean()
  const productos = await Producto.find({ sku: { $in: snapshots.map((s) => s.sku) } }).lean()
  const productosPorSku = new Map(productos.map((p) => [p.sku, p]))

  // scan de referencia para el delta: el más reciente con ≥ ventanaMinDias de
  // distancia (resolución del piso de detección); si la serie es muy nueva,
  // cae al inmediatamente anterior
  const corteVentana = new Date(
    new Date(ultimoSnap.fecha).getTime() - scoring.depuracionDelta.ventanaMinDias * 86_400_000,
  )
  const snapPrevio =
    (await Snapshot.findOne({ keyword: nicho.keyword, fecha: { $lte: corteVentana } })
      .sort({ fecha: -1 })
      .lean()) ??
    (await Snapshot.findOne({ keyword: nicho.keyword, fecha: { $lt: ultimoSnap.fecha } })
      .sort({ fecha: -1 })
      .lean())
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
  const gemelos = detectarSellersGemelos({ snapshots, productosPorSku, snapshotsPrevios })
  if (gemelos) metricas.competencia.sellersGemelos = gemelos
  const porUnidad = preciosPorUnidad({ snapshots, productosPorSku })
  if (porUnidad) metricas.precio.porUnidad = porUnidad

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
