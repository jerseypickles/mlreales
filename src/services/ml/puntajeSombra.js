import { scoring } from '../../config/scoring.js'
import { spearman } from './demandaPropia.js'

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
// igual. No decide nada: se guarda al lado y se compara contra las ventas
// reales de lo que se trajo (ml/recomendadoVsVendido.js).

export const PESO_DEMANDA_ML = 0.7 // el resto sigue siendo la demanda del puntaje vigente
export const RESENIAS_DIA_PLENAS = 60 // con esto o más, la demanda medida vale 100
export const MIN_CASOS_PUNTAJE = 8 // productos propios medidos para leer cuál ordena mejor
export const MIN_DIAS_PUNTAJE = 7

const finito = (x) => Number.isFinite(x)

// Pura. 0-100 desde las reseñas nuevas por día del nicho.
export function demandaMedida(reseniasDia) {
  if (!finito(reseniasDia) || reseniasDia < 0) return null
  return Math.min(100, Math.round(100 * Math.log10(1 + reseniasDia) / Math.log10(1 + RESENIAS_DIA_PLENAS)))
}

// Pura. componentes: los del reporte ({demanda, constancia, entrada, economia,
// competencia}, 0-100). null si falta un componente o la venta medida.
export function puntajeAlterno({ componentes, reseniasDia, confianza = 1 }) {
  const c = componentes ?? {}
  const medida = demandaMedida(reseniasDia)
  if (medida == null || !['demanda', 'constancia', 'entrada', 'economia', 'competencia'].every((k) => finito(c[k]))) return null
  const p = scoring.pesos
  const demanda = PESO_DEMANDA_ML * medida + (1 - PESO_DEMANDA_ML) * c.demanda
  const bruto = p.demanda * demanda + p.constancia * c.constancia + p.entrada * c.entrada + p.economia * c.economia + p.competencia * c.competencia
  return Math.round(bruto * (finito(confianza) ? confianza : 1))
}

// Pura. El alterno de un reporte guardado (usa el mismo descuento por búsqueda
// que ya traía el puntaje vigente).
export function alternoDeReporte(reporte) {
  const o = reporte?.metricas?.oportunidad
  return puntajeAlterno({ componentes: o?.componentes, reseniasDia: reporte?.metricas?.demanda?.resenasNuevasPorDia, confianza: o?.confianzaBusqueda ?? 1 })
}

// Pura. casos: [{actual, alterno, ventaDia}] de productos propios con días de
// stock suficientes. Cuál de los dos ordena mejor la venta real.
export function compararPuntajes(casos) {
  const utiles = casos.filter((c) => finito(c.actual) && finito(c.alterno) && finito(c.ventaDia))
  const actual = spearman(utiles.map((c) => c.actual), utiles.map((c) => c.ventaDia))
  const alterno = spearman(utiles.map((c) => c.alterno), utiles.map((c) => c.ventaDia))
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
  const lugar = (campo) => new Map([...utiles].sort((a, b) => b[campo] - a[campo]).map((f, i) => [f.keyword, i + 1]))
  const la = lugar('actual'), lb = lugar('alterno')
  const mov = utiles.map((f) => ({ ...f, lugarActual: la.get(f.keyword), lugarAlterno: lb.get(f.keyword), salto: la.get(f.keyword) - lb.get(f.keyword) }))
  const deciles = (campo) => { const o = utiles.map((f) => f[campo]).sort((a, b) => a - b); return o.length ? [o[Math.floor((o.length - 1) * 0.1)], o[Math.floor((o.length - 1) * 0.9)]] : [null, null] }
  return {
    nichos: utiles.length, sinVentaMedida: filas.length - utiles.length,
    parecido: spearman(utiles.map((f) => f.actual), utiles.map((f) => f.alterno)),
    rangoActual: deciles('actual'), rangoAlterno: deciles('alterno'),
    suben: [...mov].sort((a, b) => b.salto - a.salto).slice(0, cuantos).filter((m) => m.salto > 0),
    bajan: [...mov].sort((a, b) => a.salto - b.salto).slice(0, cuantos).filter((m) => m.salto < 0),
  }
}
