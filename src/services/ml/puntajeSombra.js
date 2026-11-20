import { scoring } from '../../config/scoring.js'

// PUNTAJE ALTERNO, EN SOMBRA. Medido el 9-nov-2026 sobre la mesa: el puntaje
// vigente casi no sigue la venta medida en Mercado Libre (orden casi nulo contra
// las reseñas nuevas por día del nicho) y sigue más al precio; su componente de
// demanda sale de las búsquedas de Google, que ya se había medido que ordenan
// poco lo que se vende en ML. El importador pidió probar otra forma sin tocar
// lo que ve.
//
// Es el MISMO puntaje con un solo cambio, para que la comparación diga algo:
// la demanda pasa a ser, en su mayor parte, la venta medida en el nicho (reseñas
// nuevas por día, en escala logarítmica). Pesos y demás componentes quedan
// igual. Se guarda al lado y se compara contra las ventas reales de lo que se
// trajo (ml/recomendadoVsVendido.js).
//
// DESDE EL 19-NOV-2026 ES EL PUNTAJE DE LA MESA (`nivelConVentaMl`, lo aplica
// tablero.js). El dueño preguntó por un nicho con muchísima búsqueda en Google y
// casi nada vendido en ML que estaba entre los primeros de la mesa, y aprobó el
// cambio. Medido ese día sobre la mesa entera: el puntaje con Google casi no
// seguía lo que se ve vendido en ML (los «+N vendidos» del top, que es otro
// contador que las reseñas) y seguía más al precio; con la venta medida lo sigue
// bastante más, y entre los veinte primeros la venta mediana se multiplica.
// Los reportes guardados no cambian (su serie exige una sola fórmula): se
// recalcula el nivel al leer, igual que los otros ajustes de la mesa.
//
// NIVELADO POR TEMPORADA. La venta medida es la de hoy; un producto de temporada
// medido fuera de su época se ve flojo sin serlo (medido ese día: una decena
// de nichos de temporada bajaba varios puntos solo por eso). Por eso la venta
// medida pesa según cuánto pesan en la curva de Google los meses en que se
// midió (`representatividad`): entera mientras pesen 0,8 del año promedio o más
// (nueve de cada diez nichos de la mesa se midieron sobre eso: bajo 1 pero cerca
// es el vaivén normal de un mes, no una temporada), nada si pesan la mitad o
// menos, y en línea entre las dos. Donde no pesa, sigue mandando la búsqueda.
// Y lo medido se lleva al nivel de un mes promedio (se divide por ese peso,
// entre la mitad y el doble): la búsqueda con que se mezcla es el promedio del
// año, y sin eso un producto en plena temporada subiría justo cuando ya es
// tarde para traerlo.

export const PESO_DEMANDA_ML = 0.7 // el resto sigue siendo la demanda del puntaje vigente
export const RESENIAS_DIA_PLENAS = 60 // con esto o más, la demanda medida vale 100
export const MIN_CASOS_PUNTAJE = 8 // productos propios medidos para leer cuál ordena mejor
export const MIN_DIAS_PUNTAJE = 7

const finito = (x) => Number.isFinite(x)

// Pura. Orden de Spearman con RANGOS PROMEDIO en los empates. Acá los empates
// son la regla y no la excepción: los puntajes son enteros y varios productos
// llevan cero ventas. Con rangos sin promediar (como el spearman de
// demandaPropia.js) el resultado depende del orden en que llegan los datos.
export function ordenConEmpates(a, b) {
  const n = a.length
  if (n < 3 || b.length !== n) return null
  const rangos = (xs) => {
    const idx = xs.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0])
    const r = new Array(n)
    for (let i = 0; i < n;) {
      let j = i
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2
      i = j + 1
    }
    return r
  }
  const ra = rangos(a), rb = rangos(b)
  const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n
  let c = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) { c += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mb) ** 2 }
  return va && vb ? Math.round((c / Math.sqrt(va * vb)) * 100) / 100 : null
}

// Pura. 0-100 desde las reseñas nuevas por día del nicho.
export function demandaMedida(reseniasDia) {
  if (!finito(reseniasDia) || reseniasDia < 0) return null
  return Math.min(100, Math.round(100 * Math.log10(1 + reseniasDia) / Math.log10(1 + RESENIAS_DIA_PLENAS)))
}

// Pura. componentes: los del reporte ({demanda, constancia, entrada, economia,
// competencia}, 0-100). null si falta un componente o la venta medida.
export function puntajeAlterno({ componentes, reseniasDia, confianza = 1, peso = PESO_DEMANDA_ML }) {
  const c = componentes ?? {}
  const medida = demandaMedida(reseniasDia)
  if (medida == null || !['demanda', 'constancia', 'entrada', 'economia', 'competencia'].every((k) => finito(c[k]))) return null
  const p = scoring.pesos
  const demanda = peso * medida + (1 - peso) * c.demanda
  const bruto = p.demanda * demanda + p.constancia * c.constancia + p.entrada * c.entrada + p.economia * c.economia + p.competencia * c.competencia
  return Math.round(bruto * (finito(confianza) ? confianza : 1))
}

// Pura. El alterno de un reporte guardado (usa el mismo descuento por búsqueda
// que ya traía el puntaje vigente).
export function alternoDeReporte(reporte) {
  const o = reporte?.metricas?.oportunidad
  return puntajeAlterno({ componentes: o?.componentes, reseniasDia: reporte?.metricas?.demanda?.resenasNuevasPorDia, confianza: o?.confianzaBusqueda ?? 1 })
}

// Pura. Cuánto dice la venta de hoy sobre la del año, de 0 a 1, según el peso
// (`factorTemporada` de demandaMlVsGoogle.js) que tienen en la curva de Google
// los meses en que se midió. Sin curva no se descuenta nada.
export const PESO_TEMPORADA_PLENA = 0.8 // desde acá el mes medido es un mes normal: la venta de hoy cuenta entera
export const PESO_TEMPORADA_NULA = 0.5 // meses que pesan la mitad del año promedio o menos: la venta de hoy no cuenta
export function representatividad(factorTemporada) {
  if (!finito(factorTemporada)) return 1
  return Math.min(1, Math.max(0, (factorTemporada - PESO_TEMPORADA_NULA) / (PESO_TEMPORADA_PLENA - PESO_TEMPORADA_NULA)))
}

// Pura. El nivel de un nicho en la mesa con la demanda medida en ML.
// `serie`: los reportes que arman su nivel, del más nuevo al más viejo, cada uno
// { s: puntaje guardado, c: componentes, k: descuento por búsqueda }. La venta es
// una sola para toda la serie (la mediana de los scans de 45 días: el orden entre
// nichos es estable, el número de un scan no). Devuelve siempre de dónde sale el
// puntaje y por qué; `score` solo cuando la venta medida entra.
export const MIN_SCANS_VENTA = 2 // con una sola medición el número se muestra, pero no mueve el puntaje
export function nivelConVentaMl(serie, { reseniasDia = null, scans = 0, factorTemporada = null } = {}) {
  const como = { fuente: 'busqueda-google', motivo: null, pesoMl: 0, reseniasDia: finito(reseniasDia) ? Math.round(reseniasDia * 10) / 10 : null, scans: scans ?? 0,
    factorTemporada: finito(factorTemporada) ? Math.round(factorTemporada * 100) / 100 : null }
  if (!finito(reseniasDia) || (scans ?? 0) < MIN_SCANS_VENTA) return { ...como, motivo: 'sin-venta-medida' }
  const peso = Math.round(PESO_DEMANDA_ML * representatividad(factorTemporada) * 100) / 100
  if (peso <= 0) return { ...como, motivo: 'fuera-de-temporada' }
  // al nivel de un mes promedio: lo medido en temporada alta se baja y lo de temporada baja se sube, hasta el doble
  const nivelada = finito(factorTemporada) && factorTemporada > 0 ? reseniasDia / Math.min(2, Math.max(0.5, factorTemporada)) : reseniasDia
  como.reseniasNiveladas = Math.round(nivelada * 10) / 10
  const xs = (serie ?? []).map((r) => puntajeAlterno({ componentes: r?.c, reseniasDia: nivelada, confianza: finito(r?.k) ? r.k : 1, peso })).filter(finito)
  if (!xs.length) return { ...como, motivo: 'sin-componentes' }
  return { ...como, fuente: 'venta-ml', motivo: peso < PESO_DEMANDA_ML ? 'temporada-baja' : null, pesoMl: peso,
    score: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), scoreUltimo: xs[0], dispersion: xs.length >= 3 ? Math.max(...xs) - Math.min(...xs) : null }
}

// Pura. casos: [{actual, alterno, ventaDia}] de productos propios con días de
// stock suficientes. Cuál de los dos ordena mejor la venta real.
export function compararPuntajes(casos) {
  const utiles = casos.filter((c) => finito(c.actual) && finito(c.alterno) && finito(c.ventaDia))
  const actual = ordenConEmpates(utiles.map((c) => c.actual), utiles.map((c) => c.ventaDia))
  const alterno = ordenConEmpates(utiles.map((c) => c.alterno), utiles.map((c) => c.ventaDia))
  const conMuestra = utiles.length >= MIN_CASOS_PUNTAJE
  return {
    casos: utiles.length, minimoCasos: MIN_CASOS_PUNTAJE, ordenActual: actual, ordenAlterno: alterno,
    estado: !conMuestra ? 'pocos-casos' : alterno > actual + 0.1 ? 'gana-alterno' : actual > alterno + 0.1 ? 'gana-actual' : 'empate',
  }
}

// Pura. filas: [{keyword, actual, alterno}] de la mesa. Qué cambiaría: cuánto se
// parecen los dos órdenes y quién sube o baja más de lugar.
export function cambiosEnLaMesa(filas, { cuantos = 6 } = {}) {
  const utiles = filas.filter((f) => finito(f.actual) && finito(f.alterno))
  // en un empate todos comparten el mejor lugar del grupo: sin eso, dos nichos
  // con el mismo puntaje "suben" o "bajan" según el orden en que llegaron
  const lugar = (campo) => { const m = new Map(); let previo = null, puesto = 0; [...utiles].sort((a, b) => b[campo] - a[campo]).forEach((f, i) => { if (f[campo] !== previo) { puesto = i + 1; previo = f[campo] } m.set(f.keyword, puesto) }); return m }
  const la = lugar('actual'), lb = lugar('alterno')
  const mov = utiles.map((f) => ({ ...f, lugarActual: la.get(f.keyword), lugarAlterno: lb.get(f.keyword), salto: la.get(f.keyword) - lb.get(f.keyword) }))
  const deciles = (campo) => { const o = utiles.map((f) => f[campo]).sort((a, b) => a - b); return o.length ? [o[Math.floor((o.length - 1) * 0.1)], o[Math.floor((o.length - 1) * 0.9)]] : [null, null] }
  return {
    nichos: utiles.length, sinVentaMedida: filas.length - utiles.length,
    parecido: ordenConEmpates(utiles.map((f) => f.actual), utiles.map((f) => f.alterno)),
    rangoActual: deciles('actual'), rangoAlterno: deciles('alterno'),
    suben: [...mov].sort((a, b) => b.salto - a.salto).slice(0, cuantos).filter((m) => m.salto > 0),
    bajan: [...mov].sort((a, b) => a.salto - b.salto).slice(0, cuantos).filter((m) => m.salto < 0),
  }
}
