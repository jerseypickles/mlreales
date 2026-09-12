import { ejemplosDemanda, variablesDemanda, indiceMes, periodoMes, normalizarMeses, HORIZONTES, VARIABLES_DEMANDA } from './series.js'
import { ajustarRidge, predecirRidge, errorPorGrupo, cuantil } from './regresion.js'

export const VERSION_DEMANDA = 'demanda-google-v1'
const PARAMETROS = [0.1, 1, 10].flatMap((lambda) => [12, Infinity].map((semivida) => ({ lambda, semivida })))
const magnitud = (logValor) => Math.max(0, Math.expm1(Math.min(Math.log1p(Number.MAX_SAFE_INTEGER), logValor)))

function evaluarCortes(filas, cortes, parametros) {
  const resultados = []
  for (const corte of cortes) {
    // Los targets de entrenamiento deben haber ocurrido ANTES de predecir.
    const train = filas.filter((f) => f.fin <= corte)
    const test = filas.filter((f) => f.origen === corte)
    if (train.length < 40 || new Set(train.map((f) => f.grupo)).size < 3 || !test.length) continue
    const modelo = ajustarRidge(train, { ...parametros, hasta: corte })
    for (const f of test) {
      const estimado = predecirRidge(modelo, f.xs)
      resultados.push({ grupo: f.grupo, origen: corte, objetivo: f.fin, h: f.h,
        error: Math.abs(f.y - estimado), errorBase: Math.abs(f.y),
        errorPersistencia: Math.abs(Math.log1p(f.real) - Math.log1p(f.ultima)),
        sesgo: estimado - f.y })
    }
  }
  return resultados
}

export function entrenarDemanda(series) {
  const filas = ejemplosDemanda(series)
  // Solo cortes donde TODOS los horizontes pueden evaluarse sin favorecer h=3.
  const ultimoMes = Math.max(...filas.map((f) => f.fin))
  const origenes = [...new Set(filas.map((f) => f.origen))].filter((o) => o + 5 <= ultimoMes).sort((a, b) => a - b)
  const cobertura = { series: new Set(filas.map((f) => f.grupo)).size, ejemplos: filas.length, origenes: origenes.length }
  if (cobertura.series < 3 || origenes.length < 12) return { estado: 'datos-insuficientes', cobertura }
  const prueba = origenes.slice(-4)
  // La selección de hiperparámetros termina antes de que empiece la prueba.
  const ajuste = origenes.filter((o) => o + 5 <= prueba[0]).slice(-3)
  const candidatos = PARAMETROS.map((p) => {
    const errores = evaluarCortes(filas, ajuste, p)
    return { p, errores, error: errorPorGrupo(errores) }
  }).filter((c) => c.error !== null && new Set(c.errores.map((e) => e.origen)).size === 3)
  candidatos.sort((a, b) => a.error - b.error)
  if (!candidatos.length) return { estado: 'datos-insuficientes', cobertura }
  const elegido = candidatos[0]
  const errores = evaluarCortes(filas, prueba, elegido.p)
  if (new Set(errores.map((e) => e.origen)).size < 4) return { estado: 'datos-insuficientes', cobertura }
  const maeLog = errorPorGrupo(errores)
  const referenciaEstacional = errorPorGrupo(errores, 'errorBase')
  const referenciaPersistencia = errorPorGrupo(errores, 'errorPersistencia')
  const referencia = Math.min(referenciaEstacional, referenciaPersistencia)
  const evaluacion = {
    tipo: 'retrospectiva-con-historia-recuperada', metrica: 'MAE log1p balanceado por keyword',
    cortesAjuste: ajuste.map(periodoMes), cortesPrueba: prueba.map(periodoMes),
    ejemplosPrueba: errores.length, maeLog, referenciaEstacional, referenciaPersistencia,
    mejoraPct: referencia > 0 ? (1 - maeLog / referencia) * 100 : null,
    superaReferencias: referencia > 0 && maeLog < referencia * 0.95,
    porHorizonte: HORIZONTES.map((h) => ({ h, maeLog: errorPorGrupo(errores.filter((e) => e.h === h)) })),
    // Rangos empíricos: no prometer cobertura nominal con observaciones correlacionadas.
    coberturaRangoEmpirico: errores.filter((e) => e.error <= cuantil(elegido.errores.filter((x) => x.h === e.h).map((x) => x.error), 0.9)).length / errores.length,
  }
  return { estado: 'sombra', version: VERSION_DEMANDA, objetivo: 'busquedas-google', cobertura, evaluacion,
    variables: VARIABLES_DEMANDA, horizontes: HORIZONTES,
    rangos: HORIZONTES.map((h) => ({ h, errorLog: cuantil(elegido.errores.filter((e) => e.h === h).map((e) => e.error), 0.9) })),
    ajuste: ajustarRidge(filas, { ...elegido.p, hasta: ultimoMes }) }
}

export function pronosticarDemanda(modelo, serie, { origen } = {}) {
  const meses = normalizarMeses(serie.meses)
  const corte = origen ?? indiceMes(meses.at(-1)?.periodo)
  if (!modelo?.ajuste || modelo.version !== VERSION_DEMANDA || corte === null) return []
  return HORIZONTES.flatMap((h) => {
    const v = variablesDemanda(meses, corte, h)
    if (!v) return []
    const logEstimado = Math.log1p(v.referencia) + predecirRidge(modelo.ajuste, v.xs)
    const rango = modelo.rangos.find((r) => r.h === h)?.errorLog
    return [{ periodo: periodoMes(v.objetivo), horizonte: h, origen: periodoMes(corte),
      estimado: Math.round(magnitud(logEstimado)), referencia: v.referencia,
      inferior: Number.isFinite(rango) ? Math.round(magnitud(logEstimado - rango)) : null,
      superior: Number.isFinite(rango) ? Math.round(magnitud(logEstimado + rango)) : null,
      tipoRango: 'empirico-sin-garantia-de-cobertura', variables: v.xs }]
  })
}
