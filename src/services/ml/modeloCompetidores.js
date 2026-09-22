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
  'crossBorder', 'reseniasLog', 'vendidosLog', 'reputacionVerde', 'anuncio', 'ratingCentrado', 'sinRating']
const DIAS_MIN = 3, DIAS_MAX = 15
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 : null }
const enPrueba = (keyword) => createHash('sha256').update(String(keyword)).digest()[0] % 4 === 0

// Pura. Una fila por par de lecturas con etiqueta, con las variables tal como
// estaban al INICIO del par (nada del futuro).
export function filasCompetidores(snaps, productos) {
  const ficha = new Map(productos.map((p) => [p.sku, p]))
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
    filas.push({ grupo: p.sku, keyword: p.keyword, fecha: +new Date(p.hasta), dias: p.dias,
      y: Math.log1p(p.resenias / p.dias * 7),
      xs: [Math.log(a.posicion), Math.log(a.precio / med), Math.max(0, Math.min(1, (a.descuentoPct ?? 0) / 100)),
        Number(f.esFull === true), Number(f.esTiendaOficial === true), Number(f.tipoListing === 'catalogo'),
        Number(f.origenCrossBorder === true), Math.log1p(a.numReviewsApi ?? 0), Math.log1p(a.vendidos ?? 0),
        Number(/^5_green/.test(f.reputacionSeller ?? '')), Number(a.esAnuncio === true),
        rating === null ? 0 : rating - 4.5, Number(rating === null)] })
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
  // el ajuste final usa todo; los pesos se entregan en unidades legibles:
  // cuánto multiplica la velocidad de reseñas cada variable, con el resto igual
  const final = ajustarRidge(filas, { lambda })
  const pesos = Object.fromEntries(VARIABLES_COMPETIDORES.map((v, j) => [v, final.coeficientes[j + 1] / final.escalas[j]]))
  return { estado: 'sombra', version: VERSION_COMPETIDORES, objetivo: 'resenias-por-semana', cobertura,
    evaluacion: { tipo: 'nichos-no-vistos', metrica: 'MAE log1p(reseñas/semana) balanceado por publicación', maeLog, referencias,
      mejoraPct: (1 - maeLog / mejorRef) * 100, superaReferencias: maeLog < mejorRef * 0.95, orden,
      ordenaMejor: !!orden.modelo && orden.modelo.spearman > Math.max(orden.posicion?.spearman ?? 0, orden.resenias?.spearman ?? 0) + 0.02 },
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
    .select('sku esFull esTiendaOficial tipoListing origenCrossBorder reputacionSeller -_id').lean()
  const filas = filasCompetidores(snaps, productos)
  const { ajuste, ...modelo } = entrenarCompetidores(filas)
  const valor = { ...modelo, diagnostico: diagnosticoCompetidores(filas) }
  cache = { en: +ahora, valor }
  return valor
}
