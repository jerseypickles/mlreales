import { Matrix, solve } from 'ml-matrix'

// Ridge con estandarización ajustada SOLO con las filas de entrenamiento.
// Resuelve mínimos cuadrados aumentados mediante SVD, sin invertir X'X.
export function ajustarRidge(filas, { lambda = 10, semivida = Infinity, hasta = 0 } = {}) {
  if (!filas.length || !(lambda > 0)) throw new Error('entrenamiento ridge inválido')
  const p = filas[0].xs.length
  if (!p || filas.some((f) => f.xs.length !== p || !f.xs.every(Number.isFinite) || !Number.isFinite(f.y))) {
    throw new Error('variables de entrenamiento inválidas')
  }
  const cuentas = new Map()
  for (const f of filas) cuentas.set(f.grupo, (cuentas.get(f.grupo) ?? 0) + 1)
  // Un producto con más capturas no cuenta como muchos productos independientes.
  const pesos = filas.map((f) => Math.pow(0.5, Math.max(0, hasta - f.fin) / semivida) / cuentas.get(f.grupo))
  const suma = pesos.reduce((a, b) => a + b, 0)
  const escalaPeso = cuentas.size / suma
  const medias = Array.from({ length: p }, (_, j) => filas.reduce((a, f, i) => a + f.xs[j] * pesos[i], 0) / suma)
  // una columna constante no deja desviación 0 exacta sino ~1e-16 de redondeo:
  // estandarizarla por eso convertiría ruido numérico en una variable enorme
  const escalas = medias.map((m, j) => {
    const e = Math.sqrt(filas.reduce((a, f, i) => a + (f.xs[j] - m) ** 2 * pesos[i], 0) / suma)
    return e > 1e-9 * Math.max(1, Math.abs(m)) ? e : 1
  })
  const x = filas.map((f, i) => {
    const w = Math.sqrt(pesos[i] * escalaPeso)
    return [w, ...f.xs.map((v, j) => (v - medias[j]) / escalas[j] * w)]
  })
  const y = filas.map((f, i) => [f.y * Math.sqrt(pesos[i] * escalaPeso)])
  for (let j = 1; j <= p; j++) {
    x.push(Array.from({ length: p + 1 }, (_, k) => k === j ? Math.sqrt(lambda) : 0))
    y.push([0])
  }
  const coeficientes = solve(new Matrix(x), new Matrix(y), true).to1DArray()
  if (!coeficientes.every(Number.isFinite)) throw new Error('coeficientes no finitos')
  return { algoritmo: 'ridge-svd-v1', lambda, semivida: Number.isFinite(semivida) ? semivida : null, medias, escalas, coeficientes }
}

export function predecirRidge(modelo, xs) {
  if (xs.length !== modelo.medias.length || !xs.every(Number.isFinite)) throw new Error('contrato de variables inválido')
  return modelo.coeficientes[0] + xs.reduce((a, v, j) => a + (v - modelo.medias[j]) / modelo.escalas[j] * modelo.coeficientes[j + 1], 0)
}

export function errorPorGrupo(filas, campo = 'error') {
  if (!filas.length) return null
  const grupos = new Map()
  for (const f of filas) grupos.set(f.grupo, [...(grupos.get(f.grupo) ?? []), f[campo]])
  return [...grupos.values()].reduce((a, xs) => a + xs.reduce((b, x) => b + x, 0) / xs.length, 0) / grupos.size
}

export function cuantil(valores, q) {
  const xs = [...valores].sort((a, b) => a - b)
  return xs.length ? xs[Math.min(xs.length - 1, Math.ceil(q * (xs.length + 1)) - 1)] : null
}
