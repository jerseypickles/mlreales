import test from 'node:test'
import assert from 'node:assert/strict'
import { curvaDeMonthlySearches, interpretar, CHILE } from '../src/services/volumenBusqueda.js'

// respuesta REAL de DataForSEO para "arbol de navidad" en Chile (12-ago-2026),
// recortada a los campos que usamos
const ARBOL = {
  keyword: 'arbol de navidad',
  location_code: 2152,
  language_code: 'es',
  competition: 'HIGH',
  competition_index: 100,
  search_volume: 74000,
  cpc: 0.06,
  monthly_searches: [
    { year: 2026, month: 7, search_volume: 4400 },
    { year: 2026, month: 6, search_volume: 4400 },
    { year: 2026, month: 5, search_volume: 3600 },
    { year: 2026, month: 4, search_volume: 3600 },
    { year: 2026, month: 3, search_volume: 4400 },
    { year: 2026, month: 2, search_volume: 4400 },
    { year: 2026, month: 1, search_volume: 6600 },
    { year: 2025, month: 12, search_volume: 246000 },
    { year: 2025, month: 11, search_volume: 368000 },
    { year: 2025, month: 10, search_volume: 60500 },
    { year: 2025, month: 9, search_volume: 12100 },
    { year: 2025, month: 8, search_volume: 5400 },
  ],
}

test('CHILE es el código de país verificado contra el endpoint de locations', () => {
  assert.equal(CHILE, 2152)
})

test('curvaDeMonthlySearches: ordena a calendario y promedia meses repetidos', () => {
  const curva = curvaDeMonthlySearches(ARBOL.monthly_searches)
  assert.equal(curva.length, 12)
  assert.equal(curva[10], 368000, 'noviembre es el pico real del árbol de navidad')
  assert.equal(curva[0], 6600, 'enero')

  // la ventana móvil de 12 meses puede traer el mismo mes dos veces
  const repetido = curvaDeMonthlySearches([
    { year: 2026, month: 3, search_volume: 100 },
    { year: 2025, month: 3, search_volume: 300 },
  ])
  assert.equal(repetido[2], 200)

  assert.equal(curvaDeMonthlySearches([]), null)
  assert.equal(curvaDeMonthlySearches(null), null)
})

test('interpretar: saca forma y TAMAÑO, que es lo que Trends nunca dio', () => {
  const d = interpretar(ARBOL)
  assert.equal(d.mesPico, 11, 'noviembre')
  assert.equal(d.clasificacion, 'estacional')
  assert.ok(d.ratioPico > 4, `ratio real 5,25 — dio ${d.ratioPico}`)
  assert.equal(d.busquedasMes, 74000, 'el volumen absoluto permite comparar nichos entre sí')
  assert.equal(d.fuente, 'google-ads')
  assert.equal(d.competenciaAds, 'HIGH')
  assert.equal(d.cpcUsd, 0.06)
})

test('interpretar: sin meses no inventa curva', () => {
  assert.equal(interpretar({ keyword: 'x', search_volume: 100 }), null)
  assert.equal(interpretar({ keyword: 'x', monthly_searches: [] }), null)
  // volumen 0 en los 12 meses: no hay forma que describir
  assert.equal(
    interpretar({
      keyword: 'x',
      monthly_searches: Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1, search_volume: 0 })),
    }),
    null,
  )
})
