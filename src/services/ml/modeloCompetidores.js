import { createHash } from 'node:crypto'
import { Snapshot } from '../../models/Snapshot.js'
import { Producto } from '../../models/Producto.js'
import { paresDeLecturas } from './competidores.js'
import { ajustarRidge, predecirRidge, errorPorGrupo } from './regresion.js'

// ¿QUÉ HACE VENDER A UNA PUBLICACIÓN? Aprendido de la competencia.
//
// El modelo comercial propio necesita 12 productos y 72 semanas y hoy tiene 4
// semanas. El panel de competidores tiene 15 mil pares de lecturas limpias
// (ver competidores.js). La etiqueta es la velocidad de reseñas nuevas por
// semana, contadas por la API en la publicación (no el agregado del catálogo):
// no son unidades, pero son proporcionales a ellas dentro de una categoría, y
// son la única señal de ventas ajenas que existe para miles de publicaciones.
//
// La prueba es la que importa para decidir: nichos que el modelo NUNCA vio.
// Y tiene que ganarle a las dos reglas que cualquiera usaría: "mejor posición
// vende más" y "el que ya tiene reseñas sigue ganando".

export const VERSION_COMPETIDORES = 'competidores-resenias-v1'
export const VARIABLES_COMPETIDORES = ['posicionLog', 'precioRelativoLog', 'descuento', 'full', 'tiendaOficial', 'catalogo',
  'crossBorder', 'reseniasLog', 'vendidosLog', 'reputacionVerde', 'anuncio', 'ratingCentrado', 'sinRating',
  // 24-sep: la temporada del nicho en el mes de la lectura, el cambio de precio
  // del propio producto y su lugar en el ranking oficial de más vendidos
  'estacionLog', 'sinEstacion', 'cambioPrecioLog', 'enTop', 'posTopLog', 'sinRanking']
// las primeras 13 son las del modelo original: se entrena también solo con
// ellas, sobre las mismas filas, para medir si las nuevas aportan
export const VARIABLES_BASE = 13
const diaChile = (f) => new Date(f).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
const DIAS_MIN = 3, DIAS_MAX = 15
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 : null }
const enPrueba = (keyword) => createHash('sha256').update(String(keyword)).digest()[0] % 4 === 0

// Pura. Una fila por par de lecturas con etiqueta, con las variables tal como
// estaban al INICIO del par (nada del futuro).
// contexto: { estacion: Map(keyword → 12 índices del año), ranking: Map(`id|día`
// → puesto), primerDiaRanking: 'AAAA-MM-DD' } — todo opcional
export function filasCompetidores(snaps, productos, contexto = {}) {
  const ficha = new Map(productos.map((p) => [p.sku, p]))
  const { estacion = new Map(), ranking = new Map(), primerDiaRanking = null } = contexto
  // el precio anterior del MISMO producto (la lectura previa a la del par)
  const precioPrevio = new Map()
  {
    const porSku = new Map()
    for (const x of snaps) if (x.precio > 0) porSku.set(x.sku, [...(porSku.get(x.sku) ?? []), x])
    for (const [sku, xs] of porSku) {
      const orden = xs.sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
      for (let i = 1; i < orden.length; i++) if ((+new Date(orden[i].fecha) - +new Date(orden[i - 1].fecha)) / 86400e3 >= 0.5) precioPrevio.set(`${sku}|${+new Date(orden[i].fecha)}`, orden[i - 1].precio)
    }
  }
  // puesto en el ranking de su categoría ese día (por cualquiera de sus ids)
  const puestoEn = (f, sku, fecha) => {
    const dia = diaChile(fecha)
    for (const id of [sku, f?.itemId, f?.catalogId]) { const p = id ? ranking.get(`${id}|${dia}`) : null; if (p) return p }
    return null
  }
  // precio mediano de cada scan de cada nicho, para el precio relativo
  const preciosScan = new Map()
  for (const s of snaps) {
    if (!(s.precio > 0)) continue
    const k = `${s.keyword}|${+new Date(s.fecha)}`
    preciosScan.set(k, [...(preciosScan.get(k) ?? []), s.precio])
  }
  const medianaScan = new Map([...preciosScan].map(([k, xs]) => [k, mediana(xs)]))
  const inicio = new Map(snaps.map((s) => [`${s.sku}|${+new Date(s.fecha)}`, s]))
  const filas = []
  for (const p of paresDeLecturas(snaps)) {
    if (p.resenias === null || p.dias < DIAS_MIN || p.dias > DIAS_MAX) continue
    const a = inicio.get(`${p.sku}|${+new Date(p.desde)}`)
    const f = ficha.get(p.sku)
    const med = medianaScan.get(`${a?.keyword}|${+new Date(a?.fecha)}`)
    if (!a || !f || !(a.precio > 0) || !(med > 0) || !Number.isFinite(a.posicion) || a.posicion < 1) continue
    const rating = Number.isFinite(a.rating) && a.rating > 0 ? a.rating : null
    const indices = estacion.get(a.keyword)
    const mes = Number(diaChile(a.fecha).slice(5, 7))
    const idx = Array.isArray(indices) && indices[mes - 1] > 0 ? indices[mes - 1] : null
    const prev = precioPrevio.get(`${p.sku}|${+new Date(a.fecha)}`)
    const cambio = prev > 0 ? Math.max(-1, Math.min(1, Math.log(a.precio / prev))) : 0
    // antes del primer día guardado del ranking NO es "fuera del top": no se sabe
    const conRanking = primerDiaRanking && diaChile(a.fecha) >= primerDiaRanking
    const puesto = conRanking ? puestoEn(f, p.sku, a.fecha) : null
    const puestoFin = primerDiaRanking && diaChile(p.hasta) >= primerDiaRanking ? puestoEn(f, p.sku, p.hasta) : undefined
    filas.push({ grupo: p.sku, keyword: p.keyword, fecha: +new Date(p.hasta), dias: p.dias,
      // para la segunda prueba: ¿estaba en el top al final del par? (undefined = sin ranking)
      enTopFin: puestoFin === undefined ? undefined : puestoFin != null,
      y: Math.log1p(p.resenias / p.dias * 7),
      xs: [Math.log(a.posicion), Math.log(a.precio / med), Math.max(0, Math.min(1, (a.descuentoPct ?? 0) / 100)),
        Number(f.esFull === true), Number(f.esTiendaOficial === true), Number(f.tipoListing === 'catalogo'),
        Number(f.origenCrossBorder === true), Math.log1p(a.numReviewsApi ?? 0), Math.log1p(a.vendidos ?? 0),
        Number(/^5_green/.test(f.reputacionSeller ?? '')), Number(a.esAnuncio === true),
        rating === null ? 0 : rating - 4.5, Number(rating === null),
        idx ? Math.log(idx) : 0, Number(!idx), cambio, Number(puesto != null), puesto ? Math.log(puesto) : 0, Number(!conRanking)] })
  }
  return filas
}

// Con 60% de pares en cero reseñas, los empates son la mayoría: sin rango
// promedio el orden entre ceros sería arbitrario y ensuciaría la comparación.
function rangos(valores) {
  const orden = valores.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const r = new Array(valores.length)
  for (let i = 0; i < orden.length;) {
    let j = i
    while (j + 1 < orden.length && orden[j + 1][0] === orden[i][0]) j++
    for (let k = i; k <= j; k++) r[orden[k][1]] = (i + j) / 2
    i = j + 1
  }
  return r
}

function spearman(a, b) {
  const ra = rangos(a), rb = rangos(b), n = a.length
  const ma = ra.reduce((x, y) => x + y, 0) / n, mb = rb.reduce((x, y) => x + y, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2 }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null
}

// orden dentro de cada nicho y fecha: ¿acierta quién vende más que quién?
function ordenPorScan(filas, campo) {
  const grupos = new Map()
  for (const f of filas) { const k = `${f.keyword}|${f.fecha}`; grupos.set(k, [...(grupos.get(k) ?? []), f]) }
  const rs = [...grupos.values()].filter((g) => g.length >= 8).map((g) => spearman(g.map((f) => f[campo]), g.map((f) => f.y))).filter((r) => r !== null)
  return rs.length ? { spearman: rs.reduce((a, b) => a + b, 0) / rs.length, grupos: rs.length } : null
}

const soloVariable = (filas, j) => filas.map((f) => ({ ...f, xs: [f.xs[j]] }))

// Pura. Entrena con nichos de entrenamiento y mide en nichos no vistos.
export function entrenarCompetidores(filasEntrada, { lambda = 10 } = {}) {
  // sin recencia: ajustarRidge descuenta por `fin`, y sin él el peso es NaN
  const filas = filasEntrada.map((f) => ({ ...f, fin: 0 }))
  const train = filas.filter((f) => !enPrueba(f.keyword)), test = filas.filter((f) => enPrueba(f.keyword))
  const cobertura = { filas: filas.length, publicaciones: new Set(filas.map((f) => f.grupo)).size, nichos: new Set(filas.map((f) => f.keyword)).size,
    nichosPrueba: new Set(test.map((f) => f.keyword)).size, filasPrueba: test.length }
  if (train.length < 500 || test.length < 150 || cobertura.nichosPrueba < 8) return { estado: 'datos-insuficientes', version: VERSION_COMPETIDORES, cobertura }
  const modelo = ajustarRidge(train, { lambda })
  const jPos = VARIABLES_COMPETIDORES.indexOf('posicionLog'), jRes = VARIABLES_COMPETIDORES.indexOf('reseniasLog')
  const soloPos = ajustarRidge(soloVariable(train, jPos), { lambda }), soloRes = ajustarRidge(soloVariable(train, jRes), { lambda })
  const media = train.reduce((a, f) => a + f.y, 0) / train.length
  const evaluadas = test.map((f) => ({ ...f, estimado: predecirRidge(modelo, f.xs), porPosicion: predecirRidge(soloPos, [f.xs[jPos]]),
    porResenias: predecirRidge(soloRes, [f.xs[jRes]]) }))
  const mae = (campo) => errorPorGrupo(evaluadas.map((f) => ({ ...f, error: Math.abs(f[campo] - f.y) })))
  const maeLog = mae('estimado')
  const referencias = { promedio: errorPorGrupo(evaluadas.map((f) => ({ ...f, error: Math.abs(media - f.y) }))), posicion: mae('porPosicion'), resenias: mae('porResenias') }
  const mejorRef = Math.min(...Object.values(referencias))
  const orden = { modelo: ordenPorScan(evaluadas, 'estimado'), posicion: ordenPorScan(evaluadas, 'porPosicion'), resenias: ordenPorScan(evaluadas, 'porResenias') }
  // ¿APORTAN LAS VARIABLES NUEVAS? El mismo modelo con solo las originales,
  // mismas filas y mismo corte
  const base = filas[0].xs.length > VARIABLES_BASE ? (() => {
    const recorta = (f) => ({ ...f, xs: f.xs.slice(0, VARIABLES_BASE) })
    const m = ajustarRidge(train.map(recorta), { lambda })
    const ev = test.map((f) => ({ ...f, estimado: predecirRidge(m, f.xs.slice(0, VARIABLES_BASE)) }))
    return { maeLog: errorPorGrupo(ev.map((f) => ({ ...f, error: Math.abs(f.estimado - f.y) }))), orden: ordenPorScan(ev, 'estimado') }
  })() : null
  // SEGUNDA PRUEBA, CON OTRA FUENTE: lo que el modelo pone arriba, ¿ML lo pone
  // en su ranking? Por cada nicho y fecha con publicaciones dentro y fuera del
  // top, qué parte de los pares (dentro, fuera) el modelo ordena bien. Azar = 0,5
  const aciertoTop = (campo) => {
    let bien = 0, total = 0
    const grupos = new Map()
    for (const f of evaluadas) if (f.enTopFin !== undefined) { const k = `${f.keyword}|${f.fecha}`; grupos.set(k, [...(grupos.get(k) ?? []), f]) }
    for (const g of grupos.values()) {
      const dentro = g.filter((f) => f.enTopFin), fuera = g.filter((f) => !f.enTopFin)
      for (const a of dentro) for (const b of fuera) { total++; if (a[campo] > b[campo]) bien++; else if (a[campo] === b[campo]) bien += 0.5 }
    }
    return total ? { acierto: Math.round(bien / total * 1000) / 1000, pares: total } : null
  }
  const conRanking = { modelo: aciertoTop('estimado'), posicion: aciertoTop('porPosicion'), resenias: aciertoTop('porResenias') }
  // el ajuste final usa todo; los pesos se entregan en unidades legibles:
  // cuánto multiplica la velocidad de reseñas cada variable, con el resto igual
  const final = ajustarRidge(filas, { lambda })
  const pesos = Object.fromEntries(VARIABLES_COMPETIDORES.map((v, j) => [v, final.coeficientes[j + 1] / final.escalas[j]]))
  return { estado: 'sombra', version: VERSION_COMPETIDORES, objetivo: 'resenias-por-semana', cobertura,
    evaluacion: { tipo: 'nichos-no-vistos', metrica: 'MAE log1p(reseñas/semana) balanceado por publicación', maeLog, referencias,
      mejoraPct: (1 - maeLog / mejorRef) * 100, superaReferencias: maeLog < mejorRef * 0.95, orden,
      ordenaMejor: !!orden.modelo && orden.modelo.spearman > Math.max(orden.posicion?.spearman ?? 0, orden.resenias?.spearman ?? 0) + 0.02,
      sinVariablesNuevas: base, contraRankingMl: conRanking },
    variables: VARIABLES_COMPETIDORES, pesos, ajuste: final }
}

// Pura. Los promedios crudos detrás de cada peso: antes de creerle a un
// coeficiente hay que ver si el dato lo sostiene sin el resto del modelo.
export function diagnosticoCompetidores(filas) {
  const prom = (fs) => fs.length ? { n: fs.length, resenasSemana: Math.round(fs.reduce((a, f) => a + Math.expm1(f.y), 0) / fs.length * 100) / 100,
    conVenta: Math.round(fs.filter((f) => f.y > 0).length / fs.length * 100) } : { n: 0 }
  const binarias = Object.fromEntries(['full', 'tiendaOficial', 'catalogo', 'anuncio', 'sinRating', 'reputacionVerde'].map((v) => {
    const j = VARIABLES_COMPETIDORES.indexOf(v)
    return [v, { si: prom(filas.filter((f) => f.xs[j] === 1)), no: prom(filas.filter((f) => f.xs[j] === 0)) }]
  }))
  const posicion = Object.fromEntries([[1, 10], [11, 25], [26, 50], [51, 100], [101, Infinity]].map(([a, b]) =>
    [`${a}-${b === Infinity ? '+' : b}`, prom(filas.filter((f) => { const p = Math.round(Math.exp(f.xs[0])); return p >= a && p <= b }))]))
  const conDescuento = { si: prom(filas.filter((f) => f.xs[2] > 0)), no: prom(filas.filter((f) => f.xs[2] === 0)) }
  return { binarias, posicion, conDescuento }
}

let cache = null
export async function modeloCompetidores({ dias = 90, ahora = new Date() } = {}) {
  if (cache && +ahora - cache.en < 30 * 60e3) return cache.valor
  const snaps = await Snapshot.find({ fecha: { $gte: new Date(+ahora - dias * 86400e3) } })
    .select('sku fecha keyword precio descuentoPct posicion esAnuncio numReviewsApi vendidos rating preguntasIds -_id').lean()
  const skus = [...new Set(snaps.map((s) => s.sku))]
  const productos = await Producto.find({ sku: { $in: skus } })
    .select('sku itemId catalogId esFull esTiendaOficial tipoListing origenCrossBorder reputacionSeller -_id').lean()
  // la forma del año de cada nicho (índice de cada mes contra lo normal)
  const estacion = new Map()
  try {
    const { CurvaEstacional } = await import('../../models/CurvaEstacional.js')
    const { periodosDelAnio } = await import('../estacionalidad.js')
    const { seriesActuales } = await import('./servicio.js')
    const keywords = [...new Set(snaps.map((x) => x.keyword))]
    const curvas = await CurvaEstacional.find({ keyword: { $in: keywords } }).select('keyword keywordMedida serieMensual').lean()
    const series = new Map((await seriesActuales({ keywords: [...new Set(curvas.map((c) => c.keywordMedida || c.keyword))] })).map((x) => [x.keyword, x.meses]))
    for (const c of curvas) {
      const serie = c.serieMensual?.length >= 24 ? c.serieMensual : series.get(c.keywordMedida || c.keyword)
      const p = periodosDelAnio(serie, { keyword: c.keyword })
      if (p) estacion.set(c.keyword, p.meses.map((m) => m.indice))
    }
  } catch { /* sin forma del año: la variable queda "sin dato" */ }
  // el ranking oficial por id y día
  const ranking = new Map()
  let primerDiaRanking = null
  try {
    const { RankingMasVendidos } = await import('../../models/RankingMasVendidos.js')
    const docs = await RankingMasVendidos.find({}).select('dia items -_id').lean()
    for (const d of docs) {
      if (!primerDiaRanking || d.dia < primerDiaRanking) primerDiaRanking = d.dia
      for (const i of d.items ?? []) if (i.id && i.posicion) ranking.set(`${i.id}|${d.dia}`, i.posicion)
    }
  } catch { /* sin ranking: todas las filas quedan "sin dato" */ }
  const filas = filasCompetidores(snaps, productos, { estacion, ranking, primerDiaRanking })
  const { ajuste, ...modelo } = entrenarCompetidores(filas)
  const valor = { ...modelo, diagnostico: diagnosticoCompetidores(filas),
    datosNuevos: { nichosConForma: estacion.size, diasDeRanking: new Set([...ranking.keys()].map((k) => k.split('|')[1])).size,
      filasEnTop: filas.filter((f) => f.xs[VARIABLES_COMPETIDORES.indexOf('enTop')] === 1).length,
      filasConCambioPrecio: filas.filter((f) => f.xs[VARIABLES_COMPETIDORES.indexOf('cambioPrecioLog')] !== 0).length } }
  cache = { en: +ahora, valor }
  return valor
}
