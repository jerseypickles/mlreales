import { scoring } from '../../config/scoring.js'
import { envioFullPorTramo } from '../metricas.js'

// LO QUE CUESTA UNA VENTA POR PUBLICIDAD EN CADA NICHO (2-oct-2026).
//
// El score cobraba a todos los nichos el mismo CAC: $1.717, medido una vez en
// agosto (config/scoring.js). El importador lo planteó así: "el radar lanza
// nichos con mucha búsqueda, pero eso nos costará PPC si entramos y no tenemos
// impresiones". Y sus campañas lo muestran: el mismo día la pistola pagó $296
// por clic y el Set 8, $71.
//
// Dos etapas, como el resto del learning machine:
//   1. La BASE deja de ser fija: es el costo por venta medido en la cuenta
//      (gasto / unidades atribuidas, 90 días), mezclado con el fijo según la
//      evidencia, n/(n+30) — la misma regla de las reglas de publicidad.
//   2. El AJUSTE POR NICHO se aprende cruzando, producto por producto, lo que
//      costó vender por anuncio contra las señales de su nicho: el costo del
//      clic en Google y la parte del top que paga publicidad en ML. Se usa solo
//      si, dejando cada producto fuera, predice su costo mejor que la base
//      (validación cruzada). Mientras no, queda en sombra y a la vista.

export const CAC_FIJO = scoring.escalas.cacClp
const PESO_PREVIO = 30
export const MIN_PARES = 5
export const MIN_NICHOS = 3
export const MEJORA_MINIMA = 0.1
// un producto entra al cruce si su publicidad ya dijo algo
const MIN_GASTO = 3000
const MIN_UNIDADES = 3
// el ajuste por nicho no puede llevar el costo más allá de esto
const FACTOR_MIN = 0.5
const FACTOR_MAX = 2.5
export const DIAS = 90

const redondear = (n, d = 0) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null)

// Las señales del nicho, ya transformadas para el modelo. El CPC de Google va
// en log (va de US$0,07 a US$1,36: órdenes de magnitud); la parte del top que
// paga, lineal en 0-1.
export const VARIABLES = {
  cpcGoogle: (v) => (Number.isFinite(v) && v > 0 ? Math.log(v) : null),
  pctTopPaga: (v) => (Number.isFinite(v) ? v / 100 : null),
}

// Pura. Misma fórmula del componente economía del score (metricas.js): cuántas
// veces cabe el costo de una venta por publicidad en lo que deja la venta.
export function componenteEconomia(contribucion, cac) {
  if (!Number.isFinite(contribucion) || !Number.isFinite(cac) || cac <= 0) return 50
  const { cacVecesPlenas } = scoring.escalas
  return Math.min(100, Math.max(0, (100 * Math.log10(Math.max(contribucion / cac, 1))) / Math.log10(cacVecesPlenas)))
}

// Pura. La base de la cuenta: lo medido pesa según cuántas ventas por anuncio
// lo sostienen; sin medición queda el fijo.
export function cacDeCuenta({ medido, unidades }) {
  if (!Number.isFinite(medido) || medido <= 0 || !(unidades > 0)) return { cac: CAC_FIJO, fuente: 'fijo', peso: 0, medido: null, unidades: 0 }
  const peso = unidades / (unidades + PESO_PREVIO)
  return { cac: Math.round(peso * medido + (1 - peso) * CAC_FIJO), fuente: 'cuenta', peso: redondear(peso, 2), medido: Math.round(medido), unidades }
}

// Pura. Pendiente de y contra x con un piso a la varianza (con 5 puntos casi
// alineados, una pendiente sin freno explota).
function ajustar(puntos) {
  const n = puntos.length
  const xm = puntos.reduce((s, p) => s + p.x, 0) / n
  const ym = puntos.reduce((s, p) => s + p.y, 0) / n
  const cov = puntos.reduce((s, p) => s + (p.x - xm) * (p.y - ym), 0) / n
  const vari = puntos.reduce((s, p) => s + (p.x - xm) ** 2, 0) / n
  return { b: cov / Math.max(vari, 0.05), xm, ym }
}

// Pura. Para cada variable: ¿dejando cada producto fuera, el modelo predice su
// costo por venta mejor que el promedio de los demás? Gana la que más mejora,
// si mejora al menos 10%, con pendiente positiva (más presión = más caro) y con
// productos de 3+ nichos distintos (los 4 sets de brochas son un solo nicho).
export function aprenderCostoAds(pares) {
  const porVariable = []
  for (const [variable, transformar] of Object.entries(VARIABLES)) {
    const puntos = pares
      .map((p) => ({ ...p, x: transformar(p[variable]), y: Math.log(p.costoPorVenta) }))
      .filter((p) => p.x != null && Number.isFinite(p.y))
    const nichos = new Set(puntos.map((p) => p.nichoId)).size
    const fila = { variable, n: puntos.length, nichos }
    if (puntos.length < MIN_PARES || nichos < MIN_NICHOS) {
      porVariable.push({ ...fila, estado: 'pocos-casos' })
      continue
    }
    let errRef = 0, errMod = 0
    for (let i = 0; i < puntos.length; i++) {
      const resto = puntos.filter((_, j) => j !== i)
      const { b, xm, ym } = ajustar(resto)
      errRef += Math.abs(puntos[i].y - ym)
      errMod += Math.abs(puntos[i].y - (ym + b * (puntos[i].x - xm)))
    }
    const { b, xm, ym } = ajustar(puntos)
    const mejora = errRef > 0 ? 1 - errMod / errRef : 0
    const estado = b > 0 && mejora >= MEJORA_MINIMA ? 'valida' : 'sin-patron'
    porVariable.push({ ...fila, estado, b: redondear(b, 3), xMedia: redondear(xm, 4), mejoraPct: redondear(mejora * 100, 1) })
  }
  const validas = porVariable.filter((v) => v.estado === 'valida').sort((a, b) => b.mejoraPct - a.mejoraPct)
  const mejor = validas[0] ?? porVariable.filter((v) => Number.isFinite(v.b)).sort((a, b) => b.mejoraPct - a.mejoraPct)[0] ?? null
  const estado = validas.length ? 'valida' : porVariable.some((v) => v.estado === 'sin-patron') ? 'sin-patron' : 'pocos-casos'
  return { estado, variable: mejor?.variable ?? null, b: mejor?.b ?? null, xMedia: mejor?.xMedia ?? null, mejoraPct: mejor?.mejoraPct ?? null, porVariable }
}

// Pura. El costo por venta que se le cobra a un nicho en el score. Con el
// modelo validado, la base ajustada por su señal; si no, la base de la cuenta,
// y el estimado por nicho viaja como sombra para poder seguirlo.
export function cacDeNicho(senales, leccion) {
  const base = leccion?.base ?? cacDeCuenta({})
  const m = leccion?.modelo
  const x = m?.variable ? VARIABLES[m.variable]?.(senales?.[m.variable]) : null
  const factor = x != null && Number.isFinite(m?.b) && Number.isFinite(m?.xMedia)
    ? Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, Math.exp(m.b * (x - m.xMedia))))
    : null
  if (m?.estado === 'valida' && factor != null) {
    return { cac: Math.round(base.cac * factor), fuente: 'nicho', base: base.cac, factor: redondear(factor, 2), variable: m.variable }
  }
  return { cac: base.cac, fuente: base.fuente, base: base.cac, sombra: factor != null ? Math.round(base.cac * factor) : null, variable: m?.variable ?? null }
}

// Pura. Cuánto cambia el score del nicho al cobrarle su costo en vez del fijo.
// Se aplica al leer la mesa y no al guardar cada scan: la serie de scores exige
// una sola fórmula (ver nivelScore en tablero.js) y mezclar romperla.
export function ajusteScore({ mediana, comisionPct = null, cac }) {
  if (!Number.isFinite(mediana) || !Number.isFinite(cac)) return 0
  const comision = Number.isFinite(comisionPct) ? comisionPct / 100 : 0.17
  const contribucion = mediana - mediana * comision - envioFullPorTramo(mediana)
  return Math.round(scoring.pesos.economia * (componenteEconomia(contribucion, cac) - componenteEconomia(contribucion, CAC_FIJO)))
}

// Los pares producto ↔ nicho y la lección. Corre a diario con el aprendizaje
// de publicidad.
export async function actualizarCostoAdsNicho({ ahora = new Date() } = {}) {
  const [{ AdsDiaMl }, { ProductoPropio }, { Nicho }, { CurvaEstacional }, { Reporte }, { Aprendizaje }] = await Promise.all([
    import('../../models/AdsDiaMl.js'), import('../../models/ProductoPropio.js'), import('../../models/Nicho.js'),
    import('../../models/CurvaEstacional.js'), import('../../models/Reporte.js'), import('../../models/Aprendizaje.js'),
  ])
  const desde = new Date(+ahora - DIAS * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
  const ads = await AdsDiaMl.aggregate([
    { $match: { itemId: { $ne: '*' }, dia: { $gte: desde } } },
    { $group: { _id: '$itemId', costo: { $sum: '$costo' }, clicks: { $sum: '$clicks' }, unidades: { $sum: '$unidadesAds' } } },
  ])
  const totalCosto = ads.reduce((s, a) => s + a.costo, 0)
  const totalUnidades = ads.reduce((s, a) => s + a.unidades, 0)
  const base = cacDeCuenta({ medido: totalUnidades ? totalCosto / totalUnidades : null, unidades: totalUnidades })

  // el id de ML vive en itemIdMl o, en los propios importados, en el sku (igual
  // que en actualizarAprendizajePublicidad)
  const propios = (await ProductoPropio.find({ nichoId: { $ne: null } }).select('itemIdMl sku titulo nichoId').lean())
    .map((p) => ({ ...p, itemIdMl: p.itemIdMl ?? p.sku }))
    .filter((p) => p.itemIdMl)
  const nichos = new Map((await Nicho.find({ _id: { $in: propios.map((p) => p.nichoId) } }).select('keyword').lean()).map((n) => [String(n._id), n]))
  const curvas = new Map((await CurvaEstacional.find({ keyword: { $in: [...nichos.values()].map((n) => n.keyword) } }).select('keyword cpcUsd').lean()).map((c) => [c.keyword, c]))
  const presion = new Map()
  for (const id of nichos.keys()) {
    const r = await Reporte.findOne({ nichoId: id, 'metricas.publicidad': { $ne: null } }).sort({ fecha: -1 }).select('metricas.publicidad').lean()
    if (r) presion.set(id, r.metricas.publicidad)
  }
  const porItem = new Map(ads.map((a) => [a._id, a]))
  const pares = []
  for (const p of propios) {
    const a = porItem.get(p.itemIdMl)
    if (!a || a.costo < MIN_GASTO || a.unidades < MIN_UNIDADES) continue
    const nicho = nichos.get(String(p.nichoId))
    pares.push({
      itemId: p.itemIdMl, titulo: p.titulo ?? null, nichoId: String(p.nichoId), keyword: nicho?.keyword ?? null,
      gasto: Math.round(a.costo), clicks: a.clicks, unidades: a.unidades,
      cpc: a.clicks ? Math.round(a.costo / a.clicks) : null,
      costoPorVenta: Math.round(a.costo / a.unidades),
      cpcGoogle: curvas.get(nicho?.keyword)?.cpcUsd ?? null,
      pctTopPaga: presion.get(String(p.nichoId))?.pctTopPaga ?? null,
    })
  }
  const modelo = aprenderCostoAds(pares)
  const leccion = { base, modelo, pares, dias: DIAS, calculadoEl: ahora }
  const texto = `Una venta por publicidad cuesta ~$${base.cac.toLocaleString('es-CL')} en la cuenta (medido $${(base.medido ?? CAC_FIJO).toLocaleString('es-CL')} en ${base.unidades} ventas por anuncio, ${DIAS} días). ${
    modelo.estado === 'valida'
      ? `Por nicho cambia según ${modelo.variable === 'cpcGoogle' ? 'el costo del clic en Google' : 'la parte del top que paga publicidad'}: predice ${modelo.mejoraPct}% mejor que la base.`
      : 'Todavía no se puede estimar por nicho: faltan productos propios con publicidad en nichos distintos.'
  }`
  await Aprendizaje.findOneAndUpdate({ tipo: 'formato-gana', keyword: '__costo-ads-nicho__' },
    { $set: { leccion: texto, evidencia: leccion, actualizadoEl: ahora } }, { upsert: true })
  console.log(`[ml-costo-ads] base $${base.cac} (${base.fuente}, peso ${base.peso}) · ${pares.length} pares en ${new Set(pares.map((p) => p.nichoId)).size} nichos · modelo ${modelo.estado}`)
  return leccion
}

export async function leccionCostoAds() {
  const { Aprendizaje } = await import('../../models/Aprendizaje.js')
  const doc = await Aprendizaje.findOne({ tipo: 'formato-gana', keyword: '__costo-ads-nicho__' }).lean()
  return doc?.evidencia ?? null
}
