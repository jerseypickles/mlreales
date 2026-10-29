import { ejemplosDemanda, variablesDemanda, indiceMes, periodoMes, normalizarMeses, HORIZONTES, VARIABLES_DEMANDA } from './series.js'
import { ajustarRidge, predecirRidge, errorPorGrupo, cuantil } from './regresion.js'

export const VERSION_DEMANDA = 'demanda-google-v1'
export const VERSION_GUIA_DEMANDA = 'guia-validada-v1'
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
        error: Math.abs(f.y - estimado), errorBase: Math.abs(f.y), y: f.y, estimado, impulso: f.xs[0],
        errorPersistencia: Math.abs(Math.log1p(f.real) - Math.log1p(f.ultima)),
        sesgo: estimado - f.y })
    }
  }
  return resultados
}

// Rangos promedio: los empates comparten posición.
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
  const ma = (n - 1) / 2
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - ma); da += (ra[i] - ma) ** 2; db += (rb[i] - ma) ** 2 }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null
}

// ¿ACIERTA CUÁL NICHO CRECE MÁS QUE OTRO? El error absoluto lo hunde una
// deriva común a todas las keywords (el mercado entero bajó en 2025 y subió
// en 2026). Comparando keywords del mismo mes y horizonte esa deriva se
// cancela, y queda lo que sirve para elegir: el orden. La referencia es el
// impulso (lo que ya crece interanual sigue creciendo); "repetir el año
// pasado" le da cero a todas y no ordena nada.
export function evaluarRanking(resultados, { minimo = 10 } = {}) {
  const grupos = new Map()
  for (const r of resultados) {
    const k = `${r.origen}:${r.h}`
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push(r)
  }
  const acumulado = { modelo: [], impulso: [], topModelo: [], topImpulso: [] }
  for (const filas of grupos.values()) {
    if (filas.length < minimo) continue
    const reales = filas.map((f) => f.y)
    const sm = spearman(filas.map((f) => f.estimado), reales), si = spearman(filas.map((f) => f.impulso), reales)
    if (sm === null || si === null) continue
    acumulado.modelo.push(sm)
    acumulado.impulso.push(si)
    // del quinto que se predice crecer más, cuánto terminó en el quinto real
    const n = Math.max(1, Math.floor(filas.length / 5))
    const top = (campo) => new Set([...filas.keys()].sort((a, b) => filas[b][campo] - filas[a][campo]).slice(0, n))
    const real = top('y')
    acumulado.topModelo.push([...top('estimado')].filter((i) => real.has(i)).length / n)
    acumulado.topImpulso.push([...top('impulso')].filter((i) => real.has(i)).length / n)
  }
  if (!acumulado.modelo.length) return null
  const prom = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  const spearmanModelo = prom(acumulado.modelo), spearmanImpulso = prom(acumulado.impulso)
  return { metrica: 'Spearman por mes y horizonte (la deriva común se cancela)', grupos: acumulado.modelo.length,
    spearman: spearmanModelo, spearmanImpulso, topQuintil: prom(acumulado.topModelo), topQuintilImpulso: prom(acumulado.topImpulso),
    topQuintilAzar: 0.2, ordenaMejor: spearmanModelo > 0.1 && spearmanModelo > spearmanImpulso + 0.02 }
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
    ranking: evaluarRanking(errores),
    coberturaRangoEmpirico: errores.filter((e) => e.error <= cuantil(elegido.errores.filter((x) => x.h === e.h).map((x) => x.error), 0.9)).length / errores.length,
  }
  return { estado: 'sombra', version: VERSION_DEMANDA, objetivo: 'busquedas-google', cobertura, evaluacion,
    variables: VARIABLES_DEMANDA, horizontes: HORIZONTES,
    rangos: HORIZONTES.map((h) => ({ h, errorLog: cuantil(elegido.errores.filter((e) => e.h === h).map((e) => e.error), 0.9) })),
    ajuste: ajustarRidge(filas, { ...elegido.p, hasta: ultimoMes }) }
}

// La validación del modelo emitido decide la guía. Se conserva el candidato
// experimental para medirlo después, sin reescribir su historia ni sus errores.
export function seleccionarGuiaDemanda(datos, modelo) {
  const e = modelo?.evaluacion
  const referencias = [['estacional', e?.referenciaEstacional, datos.referencia], ['persistencia', e?.referenciaPersistencia, datos.persistencia]]
    .filter(([, error, valor]) => Number.isFinite(error) && error >= 0 && Number.isFinite(valor) && valor >= 0)
    .sort((a, b) => a[1] - b[1])
  const mejor = referencias[0]
  const estimadoModelo = datos.estimadoModelo ?? datos.estimado
  const erroresRef = [e?.referenciaEstacional, e?.referenciaPersistencia]
  const gana = Number.isFinite(estimadoModelo) && erroresRef.every(x => Number.isFinite(x) && x >= 0) &&
    Number.isFinite(e?.maeLog) && e.maeLog >= 0 && e.maeLog < Math.min(...erroresRef) * 0.95
  const metodo = gana ? 'modelo' : mejor?.[0] ?? 'estacional'
  return { ...datos, estimadoModelo, metodo, politica: VERSION_GUIA_DEMANDA,
    estimado: gana ? estimadoModelo : mejor?.[2] ?? datos.referencia ?? null,
    inferiorModelo: datos.inferiorModelo ?? datos.inferior ?? null,
    superiorModelo: datos.superiorModelo ?? datos.superior ?? null,
    inferior: gana ? datos.inferiorModelo ?? datos.inferior ?? null : null,
    superior: gana ? datos.superiorModelo ?? datos.superior ?? null : null,
    tipoRango: gana ? 'empirico-sin-garantia-de-cobertura' : 'sin-rango-calibrado-para-referencia',
    rankingValidado: e?.ranking?.ordenaMejor === true,
    motivoGuia: gana ? 'Modelo supera las referencias en validación histórica; pendiente confirmar con meses nuevos.'
      : mejor ? 'Se usa la referencia con menor error histórico; el modelo sigue en observación.' : 'Sin validación suficiente: referencia estacional, sin modelo promovido.' }
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
    return [seleccionarGuiaDemanda({ periodo: periodoMes(v.objetivo), horizonte: h, origen: periodoMes(corte),
      estimado: Math.round(magnitud(logEstimado)), referencia: v.referencia, persistencia: v.ultima,
      inferior: Number.isFinite(rango) ? Math.round(magnitud(logEstimado - rango)) : null,
      superior: Number.isFinite(rango) ? Math.round(magnitud(logEstimado + rango)) : null,
      tipoRango: 'empirico-sin-garantia-de-cobertura', variables: v.xs }, modelo)]
  })
}
