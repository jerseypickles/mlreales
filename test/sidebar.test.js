import test from 'node:test'
import assert from 'node:assert/strict'
import { clasificarNicho, agruparNichos, anidarFamilias } from '../frontend/src/lib/sidebar.js'

// Casos tomados del tablero real al 9-ago-2026 (80 nichos, 65 con veredicto de
// entrada): la regla tiene que separar lo comprable HOY del ruido.
const nicho = (extra = {}) => ({ keyword: 'x', veredicto: 'entrar', estado: 'activo', ...extra })
const abierta = { estado: 'ahora', desde: '2026-07', hasta: '2026-09' }

test('vendiendo: donde ya hay producto propio, es operación y no apuesta', () => {
  assert.equal(clasificarNicho(nicho({ misProductos: 2, veredicto: 'no_entrar' })), 'vendiendo')
})

test('con precio en la mesa y ventana abierta: solo falta decidir', () => {
  // manguera extensible: score 92, cotizada, último mes de ventana
  assert.equal(clasificarNicho(nicho({ ventana: abierta, exwCotizadoUsd: 2.1 })), 'decidir')
  // el costo puesto en Chile también cuenta como precio sobre la mesa
  assert.equal(clasificarNicho(nicho({ ventana: abierta, costoPuestoClp: 3500 })), 'decidir')
})

test('sin cotizar todavía: comprar esta temporada', () => {
  assert.equal(clasificarNicho(nicho({ ventana: abierta })), 'comprar')
  // un nicho sin estacionalidad no tiene ventana: se compra cuando se quiera
  assert.equal(clasificarNicho(nicho({ ventana: null })), 'comprar')
  assert.equal(clasificarNicho(nicho({ ventana: { estado: 'sin-temporada' } })), 'comprar')
})

test('la ventana futura baja el nicho aunque el score sea alto', () => {
  const n = nicho({ ventana: { estado: 'futura', mesesAl: 6 }, ultimoReporte: { scoreOportunidad: 95 } })
  assert.equal(clasificarNicho(n), 'aunNo')
})

test('keyword mal escrita: grupo propio, porque el producto SÍ se busca', () => {
  // "set snorkel" no existe pero "snorkel" tiene 10 búsquedas vivas: eso se
  // arregla renombrando, no descartando
  const n = nicho({
    ventana: abierta,
    ultimoReporte: { scoreOportunidad: 82 },
    nivelBusqueda: { nivel: 'renombrar', keywordSugerida: 'snorkel' },
  })
  assert.equal(clasificarNicho(n), 'renombrar')
})

test('nadie busca la keyword: fuera del embudo aunque el análisis diga entrar', () => {
  // set snorkel (82), depiladora ipl casera (87), foco solares (80): el
  // autocompletado no las registra — miden un listado que nadie ve
  const n = nicho({
    ventana: abierta,
    exwCotizadoUsd: 3,
    ultimoReporte: { scoreOportunidad: 87 },
    nivelBusqueda: { nivel: 'nulo' },
  })
  assert.equal(clasificarNicho(n), 'sinBusqueda')
})

test('nivel de búsqueda medido y sano no cambia nada', () => {
  for (const nivel of ['alto', 'medio', 'bajo']) {
    assert.equal(clasificarNicho(nicho({ ventana: abierta, nivelBusqueda: { nivel } })), 'comprar')
  }
})

test('un descartado NO se rescata por tener búsquedas: sigue fuera', () => {
  const n = nicho({ veredicto: 'no_entrar', nivelBusqueda: { nivel: 'alto' } })
  assert.equal(clasificarNicho(n), 'fuera')
  assert.equal(clasificarNicho(nicho({ estado: 'pausado' })), 'fuera')
  assert.equal(clasificarNicho(nicho({ etapaCompra: 'descartado' })), 'fuera')
})

test('pausado con fecha de regreso: vuelve solo, no es descarte', () => {
  assert.equal(clasificarNicho(nicho({ estado: 'pausado', revisarEl: '2027-04-01' })), 'vuelven')
})

test('sin veredicto firme o madurando: midiendo', () => {
  assert.equal(clasificarNicho(nicho({ veredicto: null })), 'midiendo')
  assert.equal(clasificarNicho(nicho({ madurando: true, ventana: abierta })), 'midiendo')
})

test('agruparNichos: urgencia primero, score de desempate', () => {
  const porGrupo = agruparNichos([
    nicho({ keyword: 'ventana abierta score bajo', ventana: abierta, ultimoReporte: { scoreOportunidad: 60 } }),
    nicho({ keyword: 'sin temporada score alto', ventana: null, ultimoReporte: { scoreOportunidad: 90 } }),
    nicho({ keyword: 'ultimo mes', ventana: { estado: 'ultimo-mes' }, ultimoReporte: { scoreOportunidad: 50 } }),
  ])
  assert.deepEqual(
    porGrupo.get('comprar').map((n) => n.keyword),
    ['ultimo mes', 'ventana abierta score bajo', 'sin temporada score alto'],
  )
})

test('agruparNichos: "aún no toca" se ordena por cuánto falta', () => {
  const porGrupo = agruparNichos([
    nicho({ keyword: 'lejos', ventana: { estado: 'futura', mesesAl: 8 } }),
    nicho({ keyword: 'cerca', ventana: { estado: 'futura', mesesAl: 3 } }),
  ])
  assert.deepEqual(
    porGrupo.get('aunNo').map((n) => n.keyword),
    ['cerca', 'lejos'],
  )
})

test('anidarFamilias: el hijo cuelga del líder solo si ambos están en el grupo', () => {
  const lider = nicho({ keyword: 'sabanillas perro' })
  const hijo = nicho({ keyword: 'sabanillas perro 60x60', familiaLider: 'sabanillas perro' })
  const arbol = anidarFamilias([lider, hijo])
  assert.equal(arbol.length, 1)
  assert.equal(arbol[0].nicho.keyword, 'sabanillas perro')
  assert.deepEqual(arbol[0].hijos.map((h) => h.keyword), ['sabanillas perro 60x60'])

  // con el líder en otro grupo, el hijo queda como fila suelta
  const solo = anidarFamilias([hijo])
  assert.equal(solo.length, 1)
  assert.deepEqual(solo[0].hijos, [])
})
