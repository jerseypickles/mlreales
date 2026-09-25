import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizarMeses, indiceMes, periodoMes, variablesDemanda, ejemplosDemanda } from '../src/services/ml/series.js'
import { ajustarRidge, predecirRidge } from '../src/services/ml/regresion.js'
import { entrenarDemanda, pronosticarDemanda } from '../src/services/ml/demanda.js'
import { entrenarComercial, predecirComercial, ventanasIndependientes } from '../src/services/ml/comercial.js'
import { observacionDeProducto } from '../src/services/ml/registro.js'
import { ejecutarEntrenamiento } from '../src/services/ml/ejecutar.js'
import { conversionDe } from '../src/services/conversionPropios.js'
import { variacionInteranual, interpretar } from '../src/services/volumenBusqueda.js'
import { seriesSinteticas, comercialesSinteticas } from './helpers/mlFixtures.js'
import { interpretarVisitas } from '../src/services/meli.js'

test('ML conserva año, ceros y huecos; rechaza negativos y duplicados contradictorios', () => {
  assert.deepEqual(normalizarMeses([null, { year: 2025, month: 1, search_volume: 0 },
    { year: 2024, month: 1, search_volume: 100 }, { year: 2024, month: 1, search_volume: 100 },
    { year: 2024, month: 2, search_volume: 10 }, { year: 2024, month: 2, search_volume: 20 },
    { year: 2024, month: 13, search_volume: 20 }, { year: 2024, month: 3, search_volume: -1 }]),
  [{ periodo: '2024-01', valor: 100 }, { periodo: '2025-01', valor: 0 }])
  assert.equal(indiceMes('2024-00'), null)
  assert.equal(periodoMes(indiceMes('2025-12') + 1), '2026-01')
})

test('ML no mira el futuro al extraer variables y no cruza huecos de calendario', () => {
  const s = seriesSinteticas()[0]
  const origen = indiceMes('2024-05')
  const antes = variablesDemanda(s.meses, origen, 3)
  const alterada = s.meses.map((m) => indiceMes(m.periodo) > origen ? { ...m, valor: 99999999 } : m)
  assert.deepEqual(variablesDemanda(alterada, origen, 3), antes)
  assert.equal(variablesDemanda(s.meses.filter((m) => m.periodo !== '2023-09'), origen, 3), null)
  assert.ok(ejemplosDemanda([s]).every((f) => f.fin === f.origen + f.h && f.fin > f.origen))
})

test('comparación interanual exige 24 meses consecutivos y la interpretación conserva la serie', () => {
  const meses = seriesSinteticas()[0].meses.map((m) => {
    const [year, month] = m.periodo.split('-').map(Number)
    return { year, month, search_volume: m.valor }
  })
  assert.equal(interpretar({ keyword: 'sintetica', monthly_searches: meses }).serieMensual.length, 48)
  assert.equal(variacionInteranual(meses.filter((m) => m.year !== 2025 || m.month !== 7)), null)
})

test('ridge coincide con la solución analítica regularizada y sobrevive serialización', () => {
  const filas = [1, 2, 3, 4].map((x) => ({ grupo: String(x), xs: [x], y: 2 + 3 * x, fin: 1 }))
  const m = ajustarRidge(filas, { lambda: 2 })
  // x estandarizado: pendiente efectiva 3 * n/(n+lambda) = 2.
  assert.ok(Math.abs(predecirRidge(m, [4]) - 12.5) < 1e-9)
  assert.equal(predecirRidge(JSON.parse(JSON.stringify(m)), [3]), predecirRidge(m, [3]))
  assert.throws(() => ajustarRidge([{ ...filas[0], xs: [NaN] }]), /inválidas/)
})

test('ridge pondera productos, por lo que repetir filas de uno no crea más evidencia', () => {
  const a = { grupo: 'a', xs: [1], y: 1, fin: 1 }, b = { grupo: 'b', xs: [1], y: 9, fin: 1 }
  const m = ajustarRidge([a, a, a, a, b])
  assert.ok(Math.abs(predecirRidge(m, [1]) - 5) < 1e-8)
  const variable = { ...b, xs: [4] }
  assert.ok(Math.abs(predecirRidge(ajustarRidge([a, variable]), [2]) - predecirRidge(ajustarRidge([a, a, a, a, variable]), [2])) < 1e-8,
    'duplicar capturas tampoco cambia la fuerza efectiva de regularización')
})

test('demanda aprende crecimiento sobre estacionalidad y reserva la prueba futura', () => {
  const series = seriesSinteticas()
  const modelo = entrenarDemanda(series)
  assert.equal(modelo.estado, 'sombra')
  assert.ok(modelo.evaluacion.maeLog < modelo.evaluacion.referenciaEstacional)
  assert.ok(indiceMes(modelo.evaluacion.cortesAjuste.at(-1)) + 5 <= indiceMes(modelo.evaluacion.cortesPrueba[0]))
  const predicciones = pronosticarDemanda(modelo, series[0])
  assert.deepEqual(predicciones.map((p) => p.horizonte), [3, 4, 5])
  assert.ok(predicciones.every((p) => p.estimado > p.referencia && p.inferior <= p.estimado && p.superior >= p.estimado))
  assert.deepEqual(pronosticarDemanda(JSON.parse(JSON.stringify(modelo)), series[0]), predicciones)
  const inicioPrueba = indiceMes(modelo.evaluacion.cortesPrueba[0])
  const alteradas = series.map((s) => ({ ...s, meses: s.meses.map((m) => indiceMes(m.periodo) > inicioPrueba ? { ...m, valor: m.valor * 20 } : m) }))
  const conFuturoDistinto = entrenarDemanda(alteradas)
  assert.equal(conFuturoDistinto.ajuste.lambda, modelo.ajuste.lambda, 'la prueba final no elige lambda')
  assert.equal(conFuturoDistinto.ajuste.semivida, modelo.ajuste.semivida, 'la prueba final no elige recencia')
})

test('un patrón estacional ya exacto no recibe una mejora ficticia; pocos datos no entrenan', () => {
  const modelo = entrenarDemanda(seriesSinteticas({ crecimiento: 0 }))
  assert.equal(modelo.evaluacion.referenciaEstacional, 0)
  assert.equal(modelo.evaluacion.superaReferencias, false)
  assert.equal(entrenarDemanda(seriesSinteticas({ meses: 24 })).estado, 'datos-insuficientes')
  assert.equal(entrenarDemanda([]).estado, 'datos-insuficientes')
})

test('la conversión no divide seis días de ventas por siete de visitas ni usa acumulados caídos', () => {
  const hoy = Date.UTC(2026, 8, 11, 12)
  const punto = (dias, vendidos) => ({ fecha: new Date(hoy - dias * 86400e3), vendidos, visitas: 700, precio: 1000 })
  assert.equal(conversionDe({ mediciones: [punto(6, 100), punto(0, 105)] }, { hoy }), null)
  assert.equal(conversionDe({ mediciones: [punto(7, 100), punto(0, 107)] }, { hoy }).conversionPct, 1)
  assert.equal(conversionDe({ mediciones: [punto(7, 100), punto(0, 90)] }, { hoy }), null)
})

test('ventanas comerciales incluyen cero ventas pero eliminan solapamiento y poca exposición', () => {
  const [o] = comercialesSinteticas()
  const dia = 86400e3
  const otra = { ...o, desde: new Date(+o.desde + dia), hasta: new Date(+o.hasta + dia) }
  assert.equal(ventanasIndependientes([o, otra, { ...o, visitas: 2 }]).length, 1)
  assert.equal(ventanasIndependientes([{ ...o, unidades: 0 }]).length, 1)
})

test('el modelo comercial valida productos no vistos y se abstiene fuera del dominio', () => {
  const datos = comercialesSinteticas()
  const m = entrenarComercial(datos)
  assert.equal(m.estado, 'sombra')
  assert.ok(m.evaluacion.productosTrain >= 8)
  assert.ok(m.evaluacion.productosPrueba >= 3)
  assert.equal(predecirComercial(m, { categoria: 'nueva', precio: 10000, full: true }), null)
  assert.equal(predecirComercial(m, { categoria: 'categoria-0', precio: 1000000, full: true }), null)
  assert.equal(predecirComercial(m, { categoria: 'categoria-0', precio: 10000, full: true }).rentabilidad, 'no-estimada')
  assert.equal(entrenarComercial(comercialesSinteticas({ productos: 2 })).estado, 'datos-insuficientes')
})

test('registro propio exige cobertura de órdenes y stock, y deduplica órdenes en la misma ventana', () => {
  const hasta = new Date('2026-09-11T12:00:00Z')
  const p = { sku: 'MLC1', categoriaMl: 'CAT', envioMl: { logistica: 'fulfillment' },
    mediciones: [{ fecha: hasta, visitas: 100, visitasDesde: new Date(+hasta - 7 * 86400e3), visitasHasta: hasta, precioEfectivo: 10000 }],
    stockDiario: Array.from({ length: 8 }, (_, i) => ({ dia: `2026-09-${String(11 - i).padStart(2, '0')}`, mediciones: 30, conStock: 30 })) }
  const v = { orderId: 'o1', estado: 'paid', fecha: new Date('2026-09-10'), items: [{ itemId: 'MLC1', cantidad: 2 }] }
  const opts = { desdeSincronizado: new Date('2026-08-01'), ahora: hasta }
  assert.equal(observacionDeProducto(p, [v, v], opts).unidades, 2)
  assert.equal(observacionDeProducto(p, [], opts).unidades, 0)
  assert.deepEqual(observacionDeProducto({ ...p, costoUnitarioClp: null }, [v], opts),
    observacionDeProducto({ ...p, costoUnitarioClp: 999999 }, [v], opts),
    'el costo del stock antiguo no influye en el aprendizaje de ventas y visitas')
  assert.equal(observacionDeProducto(p, [v], { ...opts, desdeSincronizado: hasta }), null)
  assert.equal(observacionDeProducto({ ...p, stockDiario: [] }, [v], opts), null)
  assert.equal(observacionDeProducto({ ...p, historialPrecios: [{ fecha: new Date('2026-09-09') }] }, [v], opts), null)
  assert.equal(observacionDeProducto({ ...p, mediciones: [{ fecha: hasta, visitas: 100, precio: 10000 }] }, [v], opts), null,
    'sin fechas declaradas de visitas no se inventa el intervalo')
})

test('la conversión ML usa los límites devueltos por Mercado Libre, no la hora del scan', () => {
  const ventana = interpretarVisitas({ total_visits: 100, date_from: '2026-09-04T12:00:00Z', date_to: '2026-09-11T12:00:00Z' })
  const capturada = new Date('2026-09-11T16:00:00Z')
  const p = { sku: 'MLC1', categoriaMl: 'CAT', envioMl: { logistica: 'fulfillment' },
    mediciones: [{ fecha: capturada, visitas: ventana.total, visitasDesde: ventana.desde, visitasHasta: ventana.hasta, precio: 10000 }],
    stockDiario: Array.from({ length: 8 }, (_, i) => ({ dia: `2026-09-${String(11 - i).padStart(2, '0')}`, mediciones: 30, conStock: 30 })) }
  const ordenes = [{ orderId: 'vieja', estado: 'paid', fecha: new Date('2026-09-11T11:00:00Z'), items: [{ itemId: 'MLC1', cantidad: 1 }] },
    { orderId: 'posterior', estado: 'paid', fecha: new Date('2026-09-11T15:00:00Z'), items: [{ itemId: 'MLC1', cantidad: 9 }] }]
  assert.equal(observacionDeProducto(p, ordenes, { ahora: capturada, desdeSincronizado: new Date('2026-08-01') }).unidades, 1)
  assert.equal(interpretarVisitas({ total_visits: 10 }).desde, null)
})

test('el entrenamiento real corre en un worker y devuelve el mismo artefacto que la función pura', async () => {
  const datos = seriesSinteticas()
  assert.deepEqual(await ejecutarEntrenamiento('busquedas-google', datos), entrenarDemanda(datos))
})

test('una promo dentro de la ventana no anula la semana: el precio es el promedio ponderado y el motivo de descarte se declara', async () => {
  const { diagnosticoObservacion } = await import('../src/services/ml/registro.js')
  const hasta = new Date('2026-09-11T00:00:00Z'), desde = new Date(+hasta - 7 * 86400e3)
  const p = { sku: 'MLC1', categoriaMl: 'CAT', envioMl: { logistica: 'fulfillment' },
    mediciones: [{ fecha: new Date(+hasta + 3600e3), visitas: 100, visitasDesde: desde, visitasHasta: hasta, precioEfectivo: 9000 }],
    stockDiario: Array.from({ length: 9 }, (_, i) => ({ dia: `2026-09-${String(11 - i).padStart(2, '0')}`, mediciones: 24, conStock: 24 })),
    // 3,5 días a 10.000 y 3,5 a 9.000
    historialPrecios: [{ fecha: new Date(+desde + 3.5 * 86400e3), anterior: 10000, nuevo: 9000 }] }
  const opts = { desdeSincronizado: new Date('2026-08-01'), ahora: new Date(+hasta + 3600e3) }
  const { observacion } = diagnosticoObservacion(p, [], opts)
  assert.equal(observacion.precio, 9500)
  assert.deepEqual([observacion.precioMin, observacion.precioMax, observacion.cambiosPrecio], [9000, 10000, 1])
  assert.equal(ventanasIndependientes([observacion]).length, 1, '11% de variación entra al entrenamiento')
  const grande = diagnosticoObservacion({ ...p, historialPrecios: [{ fecha: new Date(+desde + 86400e3), anterior: 10000, nuevo: 6900 }] }, [], opts).observacion
  assert.equal(grande.cambiosPrecio, 1)
  assert.equal(ventanasIndependientes([grande]).length, 0, 'una rebaja de 31% se guarda pero no entrena')
  assert.match(diagnosticoObservacion({ ...p, stockDiario: p.stockDiario.map((s, i) => i === 3 ? { ...s, conStock: 0 } : s) }, [], opts).motivo, /sin stock parte del 2026-09-08/)
  assert.match(diagnosticoObservacion({ ...p, historialLogistica: [{ fecha: new Date(+desde + 86400e3) }] }, [], opts).motivo, /logística/)
  const pausada = { ...p, estadoMl: 'paused', mediciones: [{ ...p.mediciones[0], visitas: 0, stock: 0 }] }
  assert.equal(diagnosticoObservacion(pausada, [], opts).motivo, 'pausada por quiebre de stock')
  assert.equal(diagnosticoObservacion({ ...pausada, mediciones: p.mediciones }, [], opts).motivo, 'publicación pausada en ML')
  assert.ok(diagnosticoObservacion({ ...p, estadoMl: 'active' }, [], opts).observacion)
})

test('evaluarRanking: mide el orden dentro de cada mes, sin que la deriva común lo castigue', async () => {
  const { evaluarRanking } = await import('../src/services/ml/demanda.js')
  // 20 keywords en dos meses; el mes 2 tiene una deriva de −0,5 para TODAS
  const filas = [1, 2].flatMap((origen) => Array.from({ length: 20 }, (_, i) => ({
    grupo: `k${i}`, origen, h: 3, y: i / 10 - (origen === 2 ? 0.5 : 0), estimado: i / 10, impulso: (i * 7) % 20,
  })))
  const r = evaluarRanking(filas)
  assert.equal(r.grupos, 2)
  assert.ok(Math.abs(r.spearman - 1) < 1e-9, 'el orden es perfecto aunque el nivel falle por 0,5')
  assert.equal(r.topQuintil, 1)
  assert.ok(r.spearmanImpulso < 0.5)
  assert.equal(r.ordenaMejor, true)
  assert.equal(evaluarRanking(filas.slice(0, 5)), null, 'con menos de 10 keywords no hay orden que medir')
})

test('ordenarPorTendencia: lugar de cada nicho con la emisión vigente y solo meses futuros', async () => {
  const { ordenarPorTendencia } = await import('../src/api/routes/aprendizaje.js')
  const hoy = '2026-09-21T13:31:00Z', vieja = '2026-09-07T13:31:00Z'
  const nicho = (nombre, factor) => ({ nicho: nombre, meses: [
    { periodo: '2026-08', estimado: 999999, referencia: 1, real: 5, emitidoEl: vieja }, // ya pasó: no cuenta
    { periodo: '2026-12', estimado: 100 * factor, referencia: 100, real: null, emitidoEl: hoy },
    { periodo: '2027-01', estimado: 100 * factor, referencia: 100, real: null, emitidoEl: hoy },
  ] })
  const salida = ordenarPorTendencia([nicho('a', 0.5), nicho('b', 1), nicho('c', 1.1), nicho('d', 1.2), nicho('e', 2), { nicho: 'sin', meses: [] }])
  const por = Object.fromEntries(salida.map((n) => [n.nicho, n.tendencia]))
  assert.equal(por.e.grupo, 'arriba')
  assert.equal(por.a.grupo, 'abajo')
  assert.equal(por.c.grupo, 'medio')
  assert.equal(por.e.vsAnioPasadoPct, 100)
  assert.equal(por.sin, null)
})

test('panel de competidores: la reseña compartida por catálogo y la caída de fuente no son ventas', async () => {
  const { paresDeLecturas, auditarPanel } = await import('../src/services/ml/competidores.js')
  const d = (n) => new Date(Date.UTC(2026, 8, 1 + n))
  const snaps = [
    // propia: 100 → 104 en una semana = 4 reseñas
    { sku: 'A', keyword: 'k', fecha: d(0), numReviewsApi: 100, vendidos: 100, preguntasIds: ['1'] },
    { sku: 'A', keyword: 'k', fecha: d(7), numReviewsApi: 104, vendidos: 500, preguntasIds: ['1', '2', '3'] },
    // B y C comparten el conteo del catálogo en los dos scans
    { sku: 'B', keyword: 'k', fecha: d(0), numReviewsApi: 572 }, { sku: 'C', keyword: 'k', fecha: d(0), numReviewsApi: 572 },
    { sku: 'B', keyword: 'k', fecha: d(7), numReviewsApi: 634 }, { sku: 'C', keyword: 'k', fecha: d(7), numReviewsApi: 634 },
    // D pasa de un agregado a su propia cuenta
    { sku: 'D', keyword: 'k', fecha: d(0), numReviewsApi: 1538 }, { sku: 'D', keyword: 'k', fecha: d(7), numReviewsApi: 70 },
    // E: listado y ficha del mismo scan no son un par
    { sku: 'E', keyword: 'k', fecha: d(0), numReviewsApi: 5 }, { sku: 'E', keyword: 'k', fecha: new Date(+d(0) + 3600e3), numReviewsApi: 5 },
  ]
  const pares = paresDeLecturas(snaps)
  const por = Object.fromEntries(pares.map((p) => [p.sku, p]))
  assert.equal(por.A.resenias, 4)
  assert.equal(por.A.preguntas, 2)
  assert.equal(por.A.balde, 'subio')
  assert.equal(por.B.motivo, 'compartida-catalogo')
  assert.equal(por.D.motivo, 'caida')
  assert.equal(por.E, undefined)
  const a = auditarPanel(snaps, pares)
  assert.equal(a.resenias.paresUtiles, 1)
  assert.deepEqual(a.resenias.descartes, { 'compartida-catalogo': 2, caida: 1 })
})

test('panel de competidores: dos publicaciones chicas con la misma cifra no son un catálogo', async () => {
  const { paresDeLecturas } = await import('../src/services/ml/competidores.js')
  const d = (n) => new Date(Date.UTC(2026, 8, 1 + n))
  const snaps = [
    { sku: 'X', keyword: 'k', fecha: d(0), numReviewsApi: 2 }, { sku: 'X', keyword: 'k', fecha: d(7), numReviewsApi: 3 },
    { sku: 'Y', keyword: 'k', fecha: d(0), numReviewsApi: 2 }, { sku: 'Y', keyword: 'k', fecha: d(7), numReviewsApi: 3 },
    // misma foto inicial, distinto destino: tampoco es catálogo
    { sku: 'Z', keyword: 'k', fecha: d(0), numReviewsApi: 50 }, { sku: 'Z', keyword: 'k', fecha: d(7), numReviewsApi: 52 },
    { sku: 'W', keyword: 'k', fecha: d(0), numReviewsApi: 50 }, { sku: 'W', keyword: 'k', fecha: d(7), numReviewsApi: 51 },
  ]
  assert.deepEqual(paresDeLecturas(snaps).map((p) => p.resenias), [1, 1, 2, 1])
})

test('panel de competidores: un salto de fuente (ML agrupa reseñas) no es venta', async () => {
  const { paresDeLecturas } = await import('../src/services/ml/competidores.js')
  const d = (n) => new Date(Date.UTC(2026, 8, 1 + n))
  const pares = paresDeLecturas([
    { sku: 'S', keyword: 'k', fecha: d(0), numReviewsApi: 100 }, { sku: 'S', keyword: 'k', fecha: d(7), numReviewsApi: 938 },
    { sku: 'N', keyword: 'k', fecha: d(0), numReviewsApi: 2000 }, { sku: 'N', keyword: 'k', fecha: d(7), numReviewsApi: 2090 },
  ])
  assert.equal(pares.find((p) => p.sku === 'S').motivo, 'salto-fuente')
  assert.equal(pares.find((p) => p.sku === 'N').resenias, 90, 'un top que gana 90 en una semana es crecimiento real')
})
