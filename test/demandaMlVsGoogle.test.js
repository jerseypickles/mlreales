import test from 'node:test'
import assert from 'node:assert/strict'
import { equivalenciaGoogle, factorTemporada, spearman, mediana } from '../src/services/demandaMlVsGoogle.js'

// 30 nichos donde la venta en ML acompaña a Google (con ruido chico), más los
// casos que importan: los que Google subestima y los que sobreestima.
const base = () => Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, google: 1000 * 1.15 ** i, resenasDia: 2 * 1.15 ** i * (i % 2 ? 1.05 : 0.95), scans: 4, factor: 1 }))

test('venta en ML vs Google: lo que Google subestima pasa la vara por ML; lo que sobreestima queda flojo', () => {
  const filas = [...base(),
    { id: 'bascula', google: 4400, resenasDia: 400, scans: 4, factor: 1 }, // venta de las más altas, poca búsqueda
    { id: 'kayak', google: 40_000, resenasDia: 0.2, scans: 6, factor: 1 }] // mucha búsqueda, casi no se vende
  const { porId, resumen } = equivalenciaGoogle(filas)
  const b = porId.get('bascula'), k = porId.get('kayak')
  assert.equal(b.lectura, 'pasa-por-ml')
  assert.ok(b.equivalente >= 5000 && b.percentil >= 95, `equivalente ${b.equivalente}, puesto ${b.percentil}`)
  assert.equal(k.lectura, 'flojo-en-ml')
  assert.ok(k.equivalente < 5000)
  assert.equal(resumen.pasanPorMl, 1)
  assert.equal(resumen.flojosEnMl, 1)
  assert.ok(resumen.acuerdo > 0.7, `el resto ordena igual (${resumen.acuerdo})`)
})

test('venta en ML vs Google: con un solo scan se muestra el número pero no se afirma; sin Google igual se traduce', () => {
  const filas = [...base(),
    { id: 'nuevo', google: 1200, resenasDia: 500, scans: 1, factor: 1 },
    { id: 'sin-google', google: null, resenasDia: 60, scans: 3, factor: null },
    { id: 'sin-resenas', google: 9000, resenasDia: null, scans: 0, factor: null }]
  const { porId, resumen } = equivalenciaGoogle(filas)
  assert.equal(porId.get('nuevo').firme, false)
  assert.equal(porId.get('nuevo').lectura, 'pasa-por-ml', 'la lectura queda, la pantalla la muestra tenue')
  assert.equal(resumen.pasanPorMl, 0, 'no cuenta como firme')
  assert.equal(porId.get('sin-google').lectura, 'sin-google')
  assert.ok(porId.get('sin-google').equivalente > 0)
  assert.equal(porId.get('sin-resenas').lectura, 'sin-dato')
})

test('venta en ML vs Google: con pocos nichos no hay distribución con qué comparar', () => {
  const { porId, resumen } = equivalenciaGoogle(base().slice(0, 10))
  assert.equal(resumen.estado, 'pocos-datos')
  assert.equal(porId.size, 0)
})

test('venta en ML vs Google: el ajuste de temporada se usa solo si ordena más parecido a Google', () => {
  // la venta de hoy es la del año por el peso del mes: fuera de temporada se ve chica
  const estacional = base().map((f, i) => ({ ...f, factor: [0.5, 1, 2][i % 3], resenasDia: 2 * 1.15 ** i * [0.5, 1, 2][i % 3] }))
  assert.equal(equivalenciaGoogle(estacional).resumen.usaTemporada, true)
  // la curva de Google dice temporada, pero en ML no se nota (el caso "mochila escolar")
  const plano = base().map((f, i) => ({ ...f, factor: [0.5, 1, 2][i % 3] }))
  const r = equivalenciaGoogle(plano).resumen
  assert.equal(r.usaTemporada, false)
  assert.ok(r.acuerdo > r.acuerdoConTemporada)
})

test('factor de temporada: el peso de los meses medidos contra el promedio del año', () => {
  const navidad = [13450, 3625, 4200, 3450, 3800, 5150, 8550, 16450, 29225, 100250, 409000, 334500] // árbol de navidad, 0 = enero
  assert.equal(Math.round(factorTemporada(navidad, [8, 9]) * 100) / 100, 0.83)
  assert.equal(factorTemporada(navidad, []), null)
  assert.equal(factorTemporada([1, 2, 3], [0]), null, 'sin los 12 meses no hay curva')
  assert.equal(factorTemporada(Array(12).fill(0), [3]), null)
})

test('spearman y mediana: los pares incompletos no cuentan', () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]).rho, 1)
  assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]).rho, -1)
  assert.deepEqual(spearman([1, 2, null, 4, 5], [1, 2, 3, null, 5]), { rho: 1, n: 3 })
  assert.equal(mediana([5, 1, 3]), 3)
  assert.equal(mediana([4, 1, 3, 2]), 2.5)
  assert.equal(mediana([null, undefined]), null)
})
