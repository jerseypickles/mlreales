// Contrato temporal compartido por entrenamiento e inferencia. Nunca rellenar
// meses ausentes con cero ni mezclar enero de distintos años.
export function indiceMes(periodo) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo ?? '')) return null
  const [a, m] = periodo.split('-').map(Number)
  return a * 12 + m - 1
}

export function periodoMes(indice) {
  return `${Math.floor(indice / 12)}-${String(indice % 12 + 1).padStart(2, '0')}`
}

export function normalizarMeses(filas = []) {
  const meses = new Map()
  const conflictos = new Set()
  for (const f of filas ?? []) {
    if (!f || typeof f !== 'object') continue
    const periodo = f.periodo ?? `${f.year}-${String(f.month).padStart(2, '0')}`
    const valor = f.valor ?? f.search_volume
    if (indiceMes(periodo) === null || !Number.isFinite(valor) || valor < 0) continue
    if (meses.has(periodo) && meses.get(periodo) !== valor) conflictos.add(periodo)
    meses.set(periodo, valor)
  }
  return [...meses].filter(([p]) => !conflictos.has(p)).sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, valor]) => ({ periodo, valor }))
}

export const HORIZONTES = [3, 4, 5]
export const VARIABLES_DEMANDA = ['crecimiento12m', 'impulso3m', 'estacionObjetivo', 'crecimiento6m', 'horizonte']
const log = Math.log1p
const media = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

export function variablesDemanda(filas, origen, horizonte) {
  if (!HORIZONTES.includes(horizonte)) return null
  const porMes = new Map(normalizarMeses(filas).map((m) => [indiceMes(m.periodo), m.valor]))
  // La inferencia solo lee hasta el origen, aunque le pasen toda la historia.
  const historia = Array.from({ length: 24 }, (_, i) => porMes.get(origen - 23 + i))
  if (!historia.every(Number.isFinite)) return null
  const ult = historia.slice(-12)
  const ant = historia.slice(0, 12)
  const referencia = porMes.get(origen + horizonte - 12)
  const xs = [
    log(media(ult.slice(-3))) - log(media(ant.slice(-3))),
    log(media(ult.slice(-3))) - log(media(ult.slice(-6, -3))),
    log(referencia) - log(media(ult)),
    log(media(ult.slice(-6))) - log(media(ant.slice(-6))),
    horizonte,
  ]
  return { xs, referencia, ultima: historia.at(-1), objetivo: origen + horizonte }
}

export function ejemplosDemanda(series) {
  const filas = []
  for (const s of series) {
    const meses = normalizarMeses(s.meses)
    const porMes = new Map(meses.map((m) => [indiceMes(m.periodo), m.valor]))
    for (const { periodo } of meses) {
      const origen = indiceMes(periodo)
      for (const h of HORIZONTES) {
        const v = variablesDemanda(meses, origen, h)
        const real = porMes.get(origen + h)
        if (!v || !Number.isFinite(real)) continue
        filas.push({ grupo: s.keyword, origen, fin: origen + h, h, ...v,
          real, y: log(real) - log(v.referencia) })
      }
    }
  }
  return filas
}
