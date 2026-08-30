import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clasificarNicho,
  agruparNichos,
  anidarFamilias,
  tienePrecio,
  sinBusqueda,
  madurando,
  rechazadoPeroSeBusca,
  compararOportunidades,
  bandaBusqueda,
} from '../frontend/src/lib/sidebar.js'

// Casos tomados del tablero real al 9-ago-2026 (80 nichos, 65 con veredicto de
// entrada): la regla tiene que separar lo comprable HOY del ruido.
//
// EL SIDEBAR TIENE CUATRO GRUPOS, NO NUEVE. Llegó a nueve contenedores para 81
// nichos y el importador lo cortó: "aquí hay mucho contenedor, mientras sea más
// sencillo está bien". Las distinciones no se perdieron, BAJARON DE RANGO —lo
// que era un grupo entero ahora es una marca en la fila—, y por eso cada caso
// que antes probaba un grupo propio se prueba ahora en dos partes: en qué grupo
// cae, y qué marca lleva.
const nicho = (extra = {}) => ({ keyword: 'x', veredicto: 'entrar', estado: 'activo', ...extra })
const abierta = { estado: 'ahora', desde: '2026-07', hasta: '2026-09' }

test('vendiendo: donde ya hay producto propio, es operación y no apuesta', () => {
  assert.equal(clasificarNicho(nicho({ misProductos: 2, veredicto: 'no_entrar' })), 'vendiendo')
})

// Antes era el grupo "decidir". Tener precio del proveedor ya no abre un
// contenedor: marca la fila y la manda al principio de "Comprar", que es donde
// de verdad se nota.
test('con precio en la mesa: sigue en comprar, pero marcado', () => {
  const cotizado = nicho({ ventana: abierta, exwCotizadoUsd: 2.1 })
  assert.equal(clasificarNicho(cotizado), 'comprar')
  assert.equal(tienePrecio(cotizado), true)
  // el costo puesto en Chile también cuenta como precio sobre la mesa
  const puesto = nicho({ ventana: abierta, costoPuestoClp: 3500 })
  assert.equal(clasificarNicho(puesto), 'comprar')
  assert.equal(tienePrecio(puesto), true)
  assert.equal(tienePrecio(nicho({ ventana: abierta })), false)
})

test('sin cotizar todavía: comprar esta temporada', () => {
  assert.equal(clasificarNicho(nicho({ ventana: abierta })), 'comprar')
  // un nicho sin estacionalidad no tiene ventana: se compra cuando se quiera
  assert.equal(clasificarNicho(nicho({ ventana: null })), 'comprar')
  assert.equal(clasificarNicho(nicho({ ventana: { estado: 'sin-temporada' } })), 'comprar')
})

// Antes era el grupo "aunNo". Ahora cae en "espera", que es la misma respuesta:
// no lo toques, vuelve solo.
test('la ventana futura baja el nicho aunque el score sea alto', () => {
  const n = nicho({ ventana: { estado: 'futura', mesesAl: 6 }, ultimoReporte: { scoreOportunidad: 95 } })
  assert.equal(clasificarNicho(n), 'espera')
})

test('keyword mal escrita NO baja al nicho: el producto se sigue pudiendo comprar', () => {
  // el error que hubo que revertir: "manguera extensible" (92, cotizada, en su
  // último mes para pedir) desapareció del grupo de compra por un aviso de
  // keyword. El aviso viaja al lado, no la esconde.
  const n = nicho({
    ventana: abierta,
    exwCotizadoUsd: 2.1,
    ultimoReporte: { scoreOportunidad: 92 },
    nivelBusqueda: { nivel: 'renombrar', keywordSugerida: 'manguera jardin' },
  })
  assert.equal(clasificarNicho(n), 'comprar')
  assert.equal(sinBusqueda(n), false, '"renombrar" no es "nadie lo busca"')
  // sin cotizar sigue siendo comprable esta temporada
  assert.equal(clasificarNicho({ ...n, exwCotizadoUsd: undefined }), 'comprar')
})

// Antes era el grupo "sinBusqueda". Ahora cae en "fuera" con su marca.
test('nadie busca la keyword: fuera del embudo aunque el análisis diga entrar', () => {
  // set snorkel (82), depiladora ipl casera (87), foco solares (80): el
  // autocompletado no las registra — miden un listado que nadie ve
  const n = nicho({
    ventana: abierta,
    exwCotizadoUsd: 3,
    ultimoReporte: { scoreOportunidad: 87 },
    nivelBusqueda: { nivel: 'nulo' },
  })
  assert.equal(clasificarNicho(n), 'fuera')
  assert.equal(sinBusqueda(n), true)
})

test('nivel de búsqueda medido y sano no cambia nada', () => {
  for (const nivel of ['alto', 'medio', 'bajo']) {
    assert.equal(clasificarNicho(nicho({ ventana: abierta, nivelBusqueda: { nivel } })), 'comprar')
  }
})

// Antes era el grupo "revisar". El rechazo sobre una búsqueda viva sigue siendo
// una duda y no un cierre, pero se comunica con una marca en la fila.
test('no_entrar sobre una búsqueda VIVA queda marcado, no silenciado', () => {
  // caso paleta maquillaje: rechazada por dominancia de marca (42% oficial)
  // con ~850 ventas/día medidas y la keyword #3 de su prefijo. El rechazo
  // puede estar mal leído: se revisa, no se cierra.
  for (const nivel of ['alto', 'medio']) {
    const n = nicho({ veredicto: 'no_entrar', nivelBusqueda: { nivel } })
    assert.equal(clasificarNicho(n), 'fuera')
    assert.equal(rechazadoPeroSeBusca(n), true)
  }
  // aunque ya lo hayan pausado, sigue mereciendo la revisión
  const pausado = nicho({ veredicto: 'no_entrar', estado: 'pausado', nivelBusqueda: { nivel: 'alto' } })
  assert.equal(rechazadoPeroSeBusca(pausado), true)
})

test('un descartado sin búsqueda viva no lleva marca de revisión', () => {
  for (const extra of [
    { veredicto: 'no_entrar', nivelBusqueda: { nivel: 'nulo' } },
    { veredicto: 'no_entrar', nivelBusqueda: { nivel: 'bajo' } },
    // sin medir todavía no se rescata nada: no se sabe
    { veredicto: 'no_entrar' },
    { estado: 'pausado' },
    { etapaCompra: 'descartado' },
  ]) {
    const n = nicho(extra)
    assert.equal(clasificarNicho(n), 'fuera')
    assert.equal(rechazadoPeroSeBusca(n), false)
  }
})

// Antes era el grupo "vuelven".
test('pausado con fecha de regreso: vuelve solo, no es descarte', () => {
  assert.equal(clasificarNicho(nicho({ estado: 'pausado', revisarEl: '2027-04-01' })), 'espera')
})

// Antes era el grupo "midiendo".
test('sin veredicto firme o madurando: en espera y marcado', () => {
  const sinVeredicto = nicho({ veredicto: null })
  assert.equal(clasificarNicho(sinVeredicto), 'espera')
  assert.equal(madurando(sinVeredicto), true)
  const enMaduracion = nicho({ madurando: true, ventana: abierta })
  assert.equal(clasificarNicho(enMaduracion), 'espera')
  assert.equal(madurando(enMaduracion), true)
})

// El orden reemplaza a los contenedores: lo que era el grupo "decidir" ahora es
// el primer criterio de ordenamiento dentro de "Comprar".
test('agruparNichos: el precio sobre la mesa manda, después la urgencia', () => {
  const porGrupo = agruparNichos([
    nicho({ keyword: 'ultimo mes', ventana: { estado: 'ultimo-mes' }, ultimoReporte: { scoreOportunidad: 50 } }),
    nicho({ keyword: 'cotizado sin urgencia', ventana: null, exwCotizadoUsd: 2.1, ultimoReporte: { scoreOportunidad: 40 } }),
    nicho({ keyword: 'sin temporada score alto', ventana: null, ultimoReporte: { scoreOportunidad: 90 } }),
  ])
  assert.deepEqual(
    porGrupo.get('comprar').map((n) => n.keyword),
    ['cotizado sin urgencia', 'ultimo mes', 'sin temporada score alto'],
  )
})

test('agruparNichos: en espera, lo que vuelve antes va primero', () => {
  const porGrupo = agruparNichos([
    nicho({ keyword: 'lejos', ventana: { estado: 'futura', mesesAl: 8 } }),
    nicho({ keyword: 'cerca', ventana: { estado: 'futura', mesesAl: 3 } }),
  ])
  assert.deepEqual(
    porGrupo.get('espera').map((n) => n.keyword),
    ['cerca', 'lejos'],
  )
})

test('los cuatro grupos existen siempre, aunque vengan vacíos', () => {
  const porGrupo = agruparNichos([])
  assert.deepEqual([...porGrupo.keys()].sort(), ['comprar', 'espera', 'fuera', 'vendiendo'])
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
  assert.equal(solo[0].nicho.keyword, 'sabanillas perro 60x60')
})

// ── El orden de la mesa de compra ──────────────────────────────────────────
//
// EL NIVEL NO ES EL VOLUMEN, Y ORDENAR POR NIVEL ERA EL BUG.
//
// `nivelBusqueda.nivel` mide la posición de la keyword en el autocompletado de
// ML dentro de SU PREFIJO: es relativo. Medido el 30-ago-2026 sobre los 76
// nichos de la mesa, dentro de "alto" el volumen iba de 140 a 49.500 —354
// veces— y "waflera electrica" con 22.200 al mes quedaba DEBAJO de un "alto"
// de 140. El importador lo vio en pantalla: "máquina de coser tiene 1.000 por
// mes, bien poco… lo veo bien raro".
const opo = (extra = {}) => ({ keyword: 'x', score: 50, ...extra })
const conVolumen = (busquedasMes, extra = {}) =>
  opo({ curvaAnual: { busquedasMes }, ...extra })

test('el orden lo manda el volumen absoluto, no el nivel del autocompletado', () => {
  const grande = conVolumen(22_200, { keyword: 'waflera', nivelBusqueda: { nivel: 'medio' } })
  const chico = conVolumen(140, { keyword: 'algo', nivelBusqueda: { nivel: 'alto' } })
  assert.ok(compararOportunidades(grande, chico) < 0, 'el de 22.200 va antes que el de 140')
})

// En bandas y no por el número crudo: 8.100 y 8.200 son la misma decisión, y
// reordenar la mesa por esa diferencia hace perder el hilo entre visitas.
test('las bandas evitan que la mesa se reordene por diferencias que no deciden', () => {
  assert.equal(bandaBusqueda(conVolumen(8_100)), bandaBusqueda(conVolumen(8_200)))
  assert.notEqual(bandaBusqueda(conVolumen(25_000)), bandaBusqueda(conVolumen(9_000)))
  // más volumen, banda más baja (mejor)
  assert.ok(bandaBusqueda(conVolumen(30_000)) < bandaBusqueda(conVolumen(500)))
})

// "Nadie la busca" no es un volumen bajo: es otra cosa. Va al fondo aunque
// Google le mida tráfico, porque en ML ese escaparate no se abre.
test('el nicho que nadie busca cae al fondo aunque tenga volumen en Google', () => {
  const nulo = conVolumen(40_000, { nivelBusqueda: { nivel: 'nulo' } })
  const chico = conVolumen(400)
  assert.ok(bandaBusqueda(nulo) > bandaBusqueda(chico))
})

test('sin volumen medido queda en el medio, no adelanta ni cae al fondo', () => {
  const sinMedir = opo({})
  assert.ok(bandaBusqueda(sinMedir) > bandaBusqueda(conVolumen(30_000)))
  assert.ok(bandaBusqueda(sinMedir) < bandaBusqueda(conVolumen(200)))
})

// Dentro de la banda sigue mandando el momento: un nicho con la ventana
// cerrada no se compra por bueno que sea.
test('a igual banda manda la ventana, y después el score', () => {
  const ahora = conVolumen(25_000, { ventana: { estado: 'ahora' }, score: 60 })
  const futura = conVolumen(25_000, { ventana: { estado: 'futura' }, score: 95 })
  assert.ok(compararOportunidades(ahora, futura) < 0)
  const a = conVolumen(25_000, { ventana: { estado: 'ahora' }, score: 80 })
  const b = conVolumen(25_000, { ventana: { estado: 'ahora' }, score: 60 })
  assert.ok(compararOportunidades(a, b) < 0)
})
