import test from 'node:test'
import assert from 'node:assert/strict'
import { variacionInteranual, saludDelNicho, desde4Anos } from '../src/services/volumenBusqueda.js'

// La pregunta del importador, textual: "no voy a traer un producto que está
// muerto en búsquedas". El sistema no la podía contestar.
//
// `curvaDeMonthlySearches` recibe los meses de VARIOS años y los promedia en
// una forma de 12: deja bien la estacionalidad y TIRA la tendencia. Con 12
// valores no se puede separar "baja porque es su temporada baja" de "baja
// porque el producto se muere".
const meses = (desdeAno, vals) =>
  vals.map((v, i) => ({ year: desdeAno + Math.floor(i / 12), month: (i % 12) + 1, search_volume: v }))

test('comparar 12 contra 12 cancela la estacionalidad', () => {
  // un estacional puro: mismo patrón los dos años, volumen idéntico
  const patron = [100, 100, 200, 400, 800, 1600, 1600, 800, 400, 200, 100, 100]
  const estacional = meses(2024, [...patron, ...patron])
  assert.equal(variacionInteranual(estacional).pct, 0, 'la temporada no se confunde con tendencia')
  assert.equal(saludDelNicho(variacionInteranual(estacional)), 'estable')
})

test('un mercado que se achica se detecta aunque sea estacional', () => {
  const patron = [100, 100, 200, 400, 800, 1600, 1600, 800, 400, 200, 100, 100]
  const mitad = patron.map((v) => v / 2)
  const v = variacionInteranual(meses(2024, [...patron, ...mitad]))
  assert.equal(v.pct, -50)
  assert.equal(saludDelNicho(v), 'muriendo')
})

test('los cortes son anchos: el volumen de Google viene en baldes', () => {
  const base = Array(12).fill(1000)
  // ±5% puede ser el mismo balde visto dos veces, no un mercado que se mueve
  assert.equal(saludDelNicho(variacionInteranual(meses(2024, [...base, ...Array(12).fill(1050)]))), 'estable')
  assert.equal(saludDelNicho(variacionInteranual(meses(2024, [...base, ...Array(12).fill(1200)]))), 'subiendo')
  assert.equal(saludDelNicho(variacionInteranual(meses(2024, [...base, ...Array(12).fill(1400)]))), 'despegando')
  assert.equal(saludDelNicho(variacionInteranual(meses(2024, [...base, ...Array(12).fill(850)]))), 'bajando')
})

// Sin 24 meses no hay con qué comparar, y ahí NO se opina: inventar una
// tendencia con 12 meses es exactamente el error que esto viene a corregir.
test('con menos de 24 meses no se opina', () => {
  assert.equal(variacionInteranual(meses(2025, Array(12).fill(100))), null)
  assert.equal(variacionInteranual([]), null)
  assert.equal(variacionInteranual(null), null)
  assert.equal(saludDelNicho(null), null)
})

test('un año anterior en cero no produce una división infinita', () => {
  assert.equal(variacionInteranual(meses(2024, [...Array(12).fill(0), ...Array(12).fill(500)])), null)
})

// Sin `date_from` Google devuelve 12 meses y no hay comparación posible. El
// mínimo que acepta el endpoint son 4 años hacia atrás.
test('se piden 4 años de historia', () => {
  const d = desde4Anos(new Date('2026-08-31T00:00:00Z'))
  assert.equal(d, '2022-08-31')
})
