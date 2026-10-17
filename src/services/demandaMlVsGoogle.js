import { Reporte } from '../models/Reporte.js'
import { RADAR_BUSQUEDAS_MINIMAS } from './atractivoNicho.js'

// ¿SE VENDE EN ML MÁS DE LO QUE DICE GOOGLE? (17-oct-2026)
//
// Pedido del importador: "solo tengo búsqueda en mes; me fijo que pase 5.000,
// pero hay algunos bajos que no sé si en ML la tendencia es mayor". Medido el
// 17-oct sobre 121 nichos: las búsquedas de Google casi no ordenan lo que se
// vende en ML (Spearman 0,29 contra las reseñas nuevas por día), mientras las
// dos señales de ML coinciden entre sí 0,55 (reseñas y ranking de más vendidos).
// Báscula: 4.400 búsquedas y 34 reseñas al día; power bank 10000mah: 480 y 69.
//
// LA SEÑAL: reseñas nuevas por día del top del nicho, mediana de los scans de 45
// días. El nivel salta entre scans (las reseñas del CyberDay llegan una semana
// después) pero el ORDEN de los nichos es estable: 0,85 entre la primera y la
// segunda mitad de los scans de cada uno. Y no tiene el sesgo de precio de los
// vendidos acumulados (−0,02 contra −0,56); el que lo tiene es Google (+0,35:
// lo caro se googlea más).
//
// LA ESCALA ES LA DEL IMPORTADOR: cada nicho se ubica por su venta en ML entre
// los del tablero y se traduce a las búsquedas que tiene en Google un nicho en
// ese mismo puesto (cuantiles, en escala log): "vende como un nicho de ~18.000".
// Así la vara de 5.000 se mira por los dos lados.
//
// LA TEMPORADA SE APRENDE, NO SE SUPONE: la venta de hoy contra el promedio
// anual de Google castiga lo que está fuera de temporada. En cada lectura se
// prueba dividir por el peso del período en la curva de Google y se usa solo si
// ordena más parecido a Google que sin ajustar. El 17-oct no lo hacía (0,27
// contra 0,29): en ML "mochila escolar" trae mochilas de todo el año y el ajuste
// la inflaba al doble.

const DIA = 86400e3
export const DIAS_VENTANA = 45
// con un solo scan el número se muestra, pero no se afirma que pasa la vara
export const MIN_SCANS = 2
// bajo esto no hay distribución con qué comparar
const MIN_PARES = 20

const r1 = (x) => Math.round(x * 10) / 10
const r2 = (x) => Math.round(x * 100) / 100

export function mediana(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

// Pura. Cuánto pesa en Google el período medido contra el promedio del año.
// `curva`: 12 meses, 0 = enero; `meses`: los meses de los scans.
export function factorTemporada(curva, meses) {
  if (curva?.length !== 12 || !meses?.length) return null
  const prom = curva.reduce((a, b) => a + b, 0) / 12
  if (!(prom > 0)) return null
  return meses.reduce((a, m) => a + (curva[m] ?? 0), 0) / meses.length / prom
}

const rangos = (xs) => {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0])
  const r = Array(xs.length)
  for (let k = 0; k < idx.length;) {
    let m = k
    while (m + 1 < idx.length && idx[m + 1][0] === idx[k][0]) m++
    for (let t = k; t <= m; t++) r[idx[t][1]] = (k + m) / 2
    k = m + 1
  }
  return r
}

// Pura. Spearman de dos listas pareadas; los pares incompletos no cuentan.
export function spearman(a, b) {
  const pares = a.map((x, i) => [x, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  const n = pares.length
  if (n < 3) return { rho: null, n }
  const ra = rangos(pares.map((p) => p[0])), rb = rangos(pares.map((p) => p[1]))
  const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n
  let c = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) { c += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mb) ** 2 }
  return { rho: va && vb ? c / Math.sqrt(va * vb) : null, n }
}

// Pura. El puesto (0 a 1) de x en `orden` ascendente, con los empates al medio.
const percentil = (orden, x) => (orden.filter((v) => v < x).length + orden.filter((v) => v === x).length / 2) / orden.length
// Pura. El valor de `orden` ascendente en el puesto p, interpolado en escala log.
function cuantilLog(orden, p) {
  const pos = p * (orden.length - 1), i = Math.floor(pos), t = pos - i
  const a = Math.log(Math.max(orden[i], 10)), b = Math.log(Math.max(orden[Math.min(i + 1, orden.length - 1)], 10))
  return Math.exp(a + (b - a) * t)
}
const redondear = (x) => (x >= 10000 ? Math.round(x / 1000) * 1000 : x >= 1000 ? Math.round(x / 100) * 100 : Math.round(x / 10) * 10)

// Pura. filas: [{ id, google, resenasDia, scans, factor }]. Ubica la venta en ML
// de cada nicho entre los que tienen las dos medidas y la traduce a búsquedas de
// Google. Devuelve la lectura por id y el resumen de la mesa.
export function equivalenciaGoogle(filas, { vara = RADAR_BUSQUEDAS_MINIMAS, minScans = MIN_SCANS } = {}) {
  const pares = filas.filter((f) => f.google > 0 && Number.isFinite(f.resenasDia))
  if (pares.length < MIN_PARES) return { porId: new Map(), resumen: { estado: 'pocos-datos', n: pares.length } }
  // el período pesa entre la mitad y el doble: más allá, dividir solo amplifica ruido
  const ajustada = (f) => (f.factor > 0 ? f.resenasDia / Math.min(2, Math.max(0.5, f.factor)) : f.resenasDia)
  const sin = spearman(pares.map((f) => f.google), pares.map((f) => f.resenasDia))
  const con = spearman(pares.map((f) => f.google), pares.map(ajustada))
  const usaTemporada = (con.rho ?? -1) > (sin.rho ?? -1)
  const valor = (f) => (usaTemporada ? ajustada(f) : f.resenasDia)
  const google = pares.map((f) => f.google).sort((a, b) => a - b)
  const ml = pares.map(valor).sort((a, b) => a - b)
  const porId = new Map()
  let pasan = 0, flojos = 0
  for (const f of filas) {
    if (!Number.isFinite(f.resenasDia)) { porId.set(f.id, { lectura: 'sin-dato' }); continue }
    const p = percentil(ml, valor(f))
    const equivalente = redondear(cuantilLog(google, p))
    const firme = (f.scans ?? 0) >= minScans
    const lectura = !(f.google > 0) ? 'sin-google'
      : f.google < vara && equivalente >= vara ? 'pasa-por-ml'
        : f.google >= vara && equivalente < vara ? 'flojo-en-ml' : 'parejo'
    if (firme && lectura === 'pasa-por-ml') pasan++
    if (firme && lectura === 'flojo-en-ml') flojos++
    porId.set(f.id, { resenasDia: r1(f.resenasDia), scans: f.scans ?? 0, firme, percentil: Math.round(p * 100), equivalente,
      factorTemporada: Number.isFinite(f.factor) ? r2(f.factor) : null, lectura })
  }
  return { porId, resumen: { estado: 'ok', n: pares.length, acuerdo: sin.rho != null ? r2(sin.rho) : null, acuerdoConTemporada: con.rho != null ? r2(con.rho) : null, usaTemporada, vara, pasanPorMl: pasan, flojosEnMl: flojos } }
}

// La mediana de reseñas nuevas por día de cada nicho en la ventana. Los saltos
// que el juez del ruido descartó ya vienen en null (el crudo queda aparte).
export async function resenasPorNicho({ ahora = new Date(), dias = DIAS_VENTANA } = {}) {
  const filas = await Reporte.aggregate([
    { $match: { fecha: { $gte: new Date(+ahora - dias * DIA) }, 'metricas.demanda.resenasNuevasPorDia': { $ne: null } } },
    { $group: { _id: '$nichoId', valores: { $push: '$metricas.demanda.resenasNuevasPorDia' }, fechas: { $push: '$fecha' } } },
  ])
  return new Map(filas.map((f) => [String(f._id), { mediana: mediana(f.valores), scans: f.valores.length, meses: [...new Set(f.fechas.map((d) => new Date(d).getMonth()))] }]))
}

// Al leer la mesa: a cada oportunidad, su venta en ML en la escala de Google.
export async function aplicarDemandaMlVsGoogle(oportunidades, { ahora = new Date() } = {}) {
  const resenas = await resenasPorNicho({ ahora })
  const filas = oportunidades.map((o) => {
    const r = resenas.get(String(o.nichoId))
    return { id: String(o.nichoId), google: o.curvaAnual?.busquedasMes ?? null, resenasDia: r?.mediana ?? null, scans: r?.scans ?? 0, factor: factorTemporada(o.curvaAnual?.curva, r?.meses) }
  })
  const { porId, resumen } = equivalenciaGoogle(filas)
  for (const o of oportunidades) {
    const d = porId.get(String(o.nichoId))
    if (d) o.demandaMlVsGoogle = { ...d, acuerdo: resumen.acuerdo ?? null, usaTemporada: resumen.usaTemporada ?? false }
  }
  return resumen
}
