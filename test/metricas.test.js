import test from 'node:test'
import assert from 'node:assert/strict'
import {
  percentil,
  calcularMetricas,
  calcularDemanda,
  calcularScoreOportunidad,
} from '../src/services/metricas.js'

test('percentil: interpolación lineal', () => {
  assert.equal(percentil([], 50), null)
  assert.equal(percentil([10], 50), 10)
  assert.equal(percentil([10, 20], 50), 15)
  assert.equal(percentil([10, 20, 30], 50), 20)
  assert.equal(percentil([10, 20, 30, 40], 25), 17.5)
})

function armarDatos() {
  const snapshots = [
    { sku: 'A1', precio: 10000, descuentoPct: 20, rating: 4.6, posicion: 1 },
    { sku: 'A2', precio: 12000, descuentoPct: null, rating: 4.2, posicion: 2 },
    { sku: 'B1', precio: 12000, descuentoPct: 10, rating: null, posicion: 3 },
    { sku: 'C1', precio: 14000, descuentoPct: null, rating: null, posicion: 4 },
    { sku: 'D1', precio: 30000, descuentoPct: null, rating: null, posicion: 5 },
  ]
  const productosPorSku = new Map([
    ['A1', { sku: 'A1', vendedor: 'EOLAND', esTiendaOficial: true, esFull: true, envioRapido: true }],
    ['A2', { sku: 'A2', vendedor: 'EOLAND', esTiendaOficial: true, esFull: true, envioRapido: false }],
    ['B1', { sku: 'B1', vendedor: 'IMPORTADORA', esTiendaOficial: false, esFull: false, envioRapido: false }],
    ['C1', { sku: 'C1', vendedor: 'TIENDA C', esTiendaOficial: false, esFull: false, envioRapido: false }],
    ['D1', { sku: 'D1', vendedor: null, esTiendaOficial: false, esFull: false, envioRapido: false }],
  ])
  return { snapshots, productosPorSku }
}

test('calcularMetricas: precio y competencia', () => {
  const { snapshots, productosPorSku } = armarDatos()
  const m = calcularMetricas({
    snapshots,
    productosPorSku,
    totalResultados: { total: 9999, esMinimo: true },
  })

  assert.equal(m.universo.productosAnalizados, 5)
  assert.equal(m.universo.totalResultadosBusqueda, 9999)
  assert.equal(m.universo.totalEsMinimo, true)

  assert.equal(m.precio.mediana, 12000)
  assert.equal(m.precio.min, 10000)
  assert.equal(m.precio.max, 30000)
  assert.equal(m.precio.descuentoPromedioPct, 15)
  assert.equal(m.precio.pctConDescuento, 40)
  assert.ok(m.precio.bandaDominante.cantidad >= 2)

  assert.equal(m.competencia.sellersUnicos, 3)
  assert.equal(m.competencia.pctTiendaOficial, 40)
  // EOLAND(2) + IMPORTADORA(1) + TIENDA C(1) sobre 4 items con vendedor
  assert.equal(m.competencia.concentracionTop3Pct, 100)
  assert.equal(m.competencia.pctFull, 40)
  assert.equal(m.competencia.pctEnvioRapido, 20)
  assert.equal(m.competencia.topSellers[0].vendedor, 'EOLAND')
  assert.equal(m.competencia.topSellers[0].items, 2)

  assert.equal(m.calidad.ratingPromedio, 4.4)
  assert.equal(m.calidad.pctConRating, 40)

  assert.equal(m.demanda, null)
  assert.equal(m.scoreOportunidad, null)
})

test('calcularMetricas: respeta topN por posición', () => {
  const snapshots = Array.from({ length: 60 }, (_, i) => ({
    sku: `S${i}`,
    precio: 1000 + i,
    posicion: i + 1,
    rating: null,
    descuentoPct: null,
  }))
  const productosPorSku = new Map(snapshots.map((s) => [s.sku, { sku: s.sku, vendedor: `V${s.sku}` }]))
  const m = calcularMetricas({ snapshots, productosPorSku, topN: 50 })

  assert.equal(m.universo.productosAnalizados, 50)
  assert.equal(m.precio.max, 1049) // los items 51-60 quedan fuera
})

test('calcularMetricas: sin datos no revienta', () => {
  const m = calcularMetricas({ snapshots: [], productosPorSku: new Map() })
  assert.equal(m.universo.productosAnalizados, 0)
  assert.equal(m.precio.mediana, null)
  assert.equal(m.precio.bandaDominante, null)
  assert.equal(m.competencia.sellersUnicos, 0)
})

test('calcularDemanda: sin vendidos devuelve null', () => {
  assert.equal(calcularDemanda([{ sku: 'A', vendidos: null }]), null)
})

test('calcularDemanda: muestra bajo el mínimo no mide (mejor null que demanda falsa)', () => {
  // caso cooler portatil: el detalle aplicó a 1 de 30 por bloqueo de ML y ese
  // producto tenía 0 reseñas — sin mínimo, el nicho daba "demanda 0" con score 32
  const fecha = new Date('2026-07-16T12:00:00Z')
  const pocos = [
    { sku: 'A', numReviews: 0, fecha },
    { sku: 'B', fecha },
    { sku: 'C', fecha },
  ]
  assert.equal(calcularDemanda(pocos), null)

  const suficientes = Array.from({ length: 5 }, (_, i) => ({ sku: `S${i}`, numReviews: 10 * i, fecha }))
  const d = calcularDemanda(suficientes)
  assert.equal(d.base, 'reviews')
  assert.equal(d.reviews.itemsConDato, 5)
})

// LA DEMANDA SE MIDE CON RESEÑAS, Y `vendidos` DEJÓ DE SER UNA BASE.
//
// Hasta el 14-ago `calcularDemanda` podía apoyarse en el badge "+N vendidos" y
// sacarle delta y tasa. No se puede: ML lo publica EN BALDES —medido el
// 29-ago-2026 sobre seis nichos, los únicos valores son 25, 50, 100, 500, 1.000
// y 5.000—, así que un producto se queda meses en "100" y después salta a 500.
// De ahí no sale un ritmo, sale un escalón.
//
// El badge sigue guardándose y sirve para comparar TAMAÑO entre nichos
// (senalVendidos, el muro del líder), pero no alimenta la demanda.
test('calcularDemanda: sin reseñas no hay demanda, aunque sobren vendidos', () => {
  const fecha = new Date('2026-07-16T12:00:00Z')
  const soloVendidos = [
    { sku: 'A', vendidos: 5000, fecha },
    { sku: 'B', vendidos: 1000, fecha },
    { sku: 'C', vendidos: 500, fecha },
  ]
  assert.equal(calcularDemanda(soloVendidos, null, { minItems: 1 }), null)
})

test('calcularDemanda: con reseñas medidas, la base es reviews', () => {
  const previa = new Date('2026-07-14T12:00:00Z')
  const actual = new Date('2026-07-16T12:00:00Z') // 2 días después
  const d = calcularDemanda(
    [
      { sku: 'A', numReviews: 150, vendidos: 5000, fecha: actual },
      { sku: 'B', numReviews: 500, vendidos: 1000, fecha: actual },
    ],
    [
      { sku: 'A', numReviews: 100, fecha: previa },
      { sku: 'B', numReviews: 480, fecha: previa },
    ],
    { minItems: 1 },
  )
  assert.equal(d.base, 'reviews')
  assert.equal(d.reviews.delta, 70) // (150-100) + (500-480)
  assert.equal(d.reviews.periodoDias, 2)
  assert.equal(d.resenasNuevasPorDia, 35)
  // el badge de vendidos viaja en el snapshot pero NO como demanda
  assert.equal(d.vendidos, undefined)
})

// Una señal sacada de tres items de un listado de cien diría "demanda 0" con
// cara seria. Sin representatividad se devuelve null y el pipeline reintenta,
// en vez de publicar un número falso.
test('calcularDemanda: muestra ínfima no publica demanda', () => {
  const previa = new Date('2026-07-14T12:00:00Z')
  const actual = new Date('2026-07-16T12:00:00Z')
  const args = [
    [{ sku: 'A', numReviews: 150, fecha: actual }],
    [{ sku: 'A', numReviews: 100, fecha: previa }],
  ]
  assert.ok(calcularDemanda(...args, { minItems: 1 }), 'con el mínimo en 1 sí publica')
  assert.equal(calcularDemanda(...args, { minItems: 5 }), null)
})

test('calcularDemanda: una ventana de minutos no publica tasa (ni 0 ni inflada)', () => {
  // caso pastillas freno 9-ago: el cron de maduración escaneó y una hora después
  // corrió un re-scan manual. Con 1 h de ventana el piso de detección son ~600
  // ventas/día: el 0 no es "no vende" y un +1 no es "vende 600" — no hay tasa.
  const fechaPrevia = new Date('2026-08-09T02:00:00Z')
  const fechaActual = new Date('2026-08-09T03:00:00Z')
  const actuales = Array.from({ length: 5 }, (_, i) => ({ sku: `S${i}`, numReviews: 100, fecha: fechaActual }))
  const previos = Array.from({ length: 5 }, (_, i) => ({ sku: `S${i}`, numReviews: 100, fecha: fechaPrevia }))

  const quieto = calcularDemanda(actuales, previos, { minItems: 1 })
  assert.equal(quieto.reviews.ventanaInsuficiente, true)
  assert.equal(quieto.reviews.porDia, null)
  assert.equal(quieto.resenasNuevasPorDia, null, 'un 0 de resolución no puede viajar como medición')

  const conVenta = calcularDemanda(
    actuales.map((s, i) => (i === 0 ? { ...s, numReviews: 101 } : s)),
    previos,
    { minItems: 1 },
  )
  assert.equal(conVenta.reviews.delta, 1, 'el delta crudo se conserva como hecho')
  assert.equal(conVenta.resenasNuevasPorDia, null, 'pero no se extrapola a una tasa')
})


test('calcularDemanda: un salto de catálogo imposible queda fuera del delta', () => {
  // caso mancuernas 30-jul: un item de catálogo pasó 811→1483 (+672 en 6 días,
  // +83% del acumulado) porque ML consolidó la familia — eso no son ventas
  const fechaPrevia = new Date('2026-07-24T12:00:00Z')
  const fechaActual = new Date('2026-07-30T12:00:00Z') // 6 días
  const actuales = [
    { sku: 'SALTO', numReviews: 1483, fecha: fechaActual },
    { sku: 'B', numReviews: 110, fecha: fechaActual },
  ]
  const previos = [
    { sku: 'SALTO', numReviews: 811, fecha: fechaPrevia },
    { sku: 'B', numReviews: 100, fecha: fechaPrevia },
  ]
  const d = calcularDemanda(actuales, previos, { minItems: 1 })
  assert.equal(d.reviews.delta, 10) // solo el crecimiento orgánico de B
  assert.equal(d.reviews.deltaBruto, 682)
  assert.equal(d.reviews.saltosFiltrados, 1)
  assert.equal(d.reviews.itemsComparables, 2) // la canasta reporta lo medido
})

test('calcularDemanda: dos listings con el mismo conteo de catálogo cuentan una vez', () => {
  // caso Overfit: dos SKUs hermanos muestran el agregado idéntico del catálogo
  const fechaPrevia = new Date('2026-07-24T12:00:00Z')
  const fechaActual = new Date('2026-07-30T12:00:00Z')
  const actuales = [
    { sku: 'GEMELO-1', numReviews: 5148, fecha: fechaActual },
    { sku: 'GEMELO-2', numReviews: 5148, fecha: fechaActual },
    { sku: 'B', numReviews: 110, fecha: fechaActual },
  ]
  const previos = [
    { sku: 'GEMELO-1', numReviews: 5119, fecha: fechaPrevia },
    { sku: 'GEMELO-2', numReviews: 5119, fecha: fechaPrevia },
    { sku: 'B', numReviews: 100, fecha: fechaPrevia },
  ]
  const d = calcularDemanda(actuales, previos, { minItems: 1 })
  assert.equal(d.reviews.delta, 39) // 29 (una vez) + 10
  assert.equal(d.reviews.duplicadosCatalogo, 1)
  assert.equal(d.reviews.itemsComparables, 3)
})

test('calcularDemanda: preguntas nuevas por id, con dedupe de hermanos de catálogo', () => {
  const fechaPrevia = new Date('2026-07-29T12:00:00Z')
  const fechaActual = new Date('2026-07-30T12:00:00Z') // 1 día
  const actuales = [
    // gana las preguntas q3 y q4; q4 también aparece en el hermano de catálogo
    { sku: 'A', numReviews: 10, preguntasIds: ['q1', 'q2', 'q3', 'q4'], fecha: fechaActual },
    { sku: 'A2', numReviews: 10, preguntasIds: ['q1', 'q2', 'q3', 'q4'], fecha: fechaActual },
    { sku: 'B', numReviews: 5, preguntasIds: ['z1'], fecha: fechaActual },
    { sku: 'NUEVO', numReviews: 1, preguntasIds: ['n1'], fecha: fechaActual }, // sin previo: no compara
  ]
  const previos = [
    { sku: 'A', numReviews: 10, preguntasIds: ['q1', 'q2'], fecha: fechaPrevia },
    { sku: 'A2', numReviews: 10, preguntasIds: ['q1', 'q2'], fecha: fechaPrevia },
    { sku: 'B', numReviews: 5, preguntasIds: ['z1'], fecha: fechaPrevia },
  ]
  const d = calcularDemanda(actuales, previos, { minItems: 1 })
  assert.equal(d.preguntas.nuevas, 2) // q3 + q4, contadas una vez pese al hermano
  assert.equal(d.preguntas.itemsComparables, 3)
  assert.equal(d.preguntas.porDia, 2)
})

test('calcularDemanda: sin ids de preguntas la señal es null', () => {
  const d = calcularDemanda(
    [{ sku: 'A', numReviews: 10, fecha: new Date('2026-07-30') }],
    [{ sku: 'A', numReviews: 8, fecha: new Date('2026-07-29') }],
    { minItems: 1 },
  )
  assert.equal(d.preguntas, null)
  assert.equal(d.reviews.delta, 2) // la señal de reseñas no se ve afectada
})

test('calcularDemanda: expone la resolución de la ventana', () => {
  // ventana de 1 día: lo más chico que se puede ver es 1 reseña. Un 0 medido
  // significa "no apareció ninguna reseña nueva", jamás "nadie compra".
  const d = calcularDemanda(
    [{ sku: 'A', numReviews: 10, fecha: new Date('2026-07-30T12:00:00Z') }],
    [{ sku: 'A', numReviews: 10, fecha: new Date('2026-07-29T12:00:00Z') }],
    { minItems: 1 },
  )
  assert.equal(d.resenasNuevasPorDia, 0)
  assert.equal(d.resolucionResenasDia, 1)
})


test('calcularDemanda: sin vendidos usa delta de reseñas como proxy', () => {
  const fechaPrevia = new Date('2026-07-14T12:00:00Z')
  const fechaActual = new Date('2026-07-16T12:00:00Z')
  const actuales = [
    { sku: 'A', numReviews: 930, fecha: fechaActual },
    { sku: 'B', numReviews: 110, fecha: fechaActual },
  ]
  const previos = [
    { sku: 'A', numReviews: 921, fecha: fechaPrevia },
    { sku: 'B', numReviews: 105, fecha: fechaPrevia },
  ]
  const d = calcularDemanda(actuales, previos, { minItems: 1 })
  assert.equal(d.base, 'reviews')
  assert.equal(d.reviews.total, 1040)
  assert.equal(d.reviews.delta, 14) // 9 + 5
  assert.equal(d.reviews.porDia, 7)
  // el factor 25 se eliminó: lo que viaja es el CONTEO, no una venta inventada
  assert.equal(d.resenasNuevasPorDia, 7, 'reseñas nuevas por día, sin multiplicar')
  assert.equal(d.ventasEstimadasPorDia, undefined, 'las ventas estimadas ya no existen')
  assert.equal(d.volumenVentasEstimado, undefined)
})

// EL SCORE TIENE CINCO COMPONENTES, TODOS MEDIDOS.
//
// El modelo viejo pesaba `calidad` (rating promedio) y `full`. Hoy son demanda,
// competencia, constancia, entrada y economía —ver calcularScoreOportunidad—, y
// ninguno se multiplica por un factor inventado: la demanda sale de búsquedas
// reales de Google Ads, no de reseñas × 25.
test('calcularScoreOportunidad: la demanda sale de búsquedas medidas, no de un factor', () => {
  const base = {
    demanda: {},
    competencia: { concentracionTop3Pct: 40, pctFull: 10, sellersConFull: 0 },
  }
  const r = calcularScoreOportunidad({ ...base, busquedasMes: 10000 })
  assert.deepEqual(
    Object.keys(r.componentes).sort(),
    ['competencia', 'constancia', 'demanda', 'economia', 'entrada'],
  )
  // 100 - concentración del top 3
  assert.equal(r.componentes.competencia, 60)
  // más búsquedas, más demanda; y es logarítmica, no lineal
  const menos = calcularScoreOportunidad({ ...base, busquedasMes: 1000 })
  assert.ok(r.componentes.demanda > menos.componentes.demanda)
  assert.ok(r.componentes.demanda < menos.componentes.demanda * 10)
  // sin búsquedas medidas no hay score que dar
  assert.equal(calcularScoreOportunidad({ ...base, busquedasMes: null }), null)
})
test('calcularScoreOportunidad: sin búsquedas medidas no hay score', () => {
  // antes bastaba con tener reseñas acumuladas: eso permitía puntuar nichos
  // cuya demanda era pura multiplicación. Ahora exige la medición real.
  assert.equal(calcularScoreOportunidad({ busquedasMes: null, demanda: {}, competencia: {}, calidad: {} }), null)
})

test('el respaldo de Full levanta la demanda: capital ajeno inmovilizado', () => {
  const base = {
    busquedasMes: 10000,
    demanda: {},
    calidad: { ratingPromedio: 4.0, itemsConRating: 20 },
  }
  const sinFull = calcularScoreOportunidad({ ...base, competencia: { concentracionTop3Pct: 40, pctFull: 0, sellersConFull: 0 } })
  const conFull = calcularScoreOportunidad({ ...base, competencia: { concentracionTop3Pct: 40, pctFull: 0, sellersConFull: 20 } })
  assert.ok(conFull.componentes.demanda > sinFull.componentes.demanda,
    '20 vendedores con stock en Full dicen más que ninguno')
  // y no crece sin techo: 20 y 40 vendedores saturan igual
  const muchos = calcularScoreOportunidad({ ...base, competencia: { concentracionTop3Pct: 40, pctFull: 0, sellersConFull: 40 } })
  assert.equal(muchos.componentes.demanda, conFull.componentes.demanda)
})

test('el score descuenta confianza cuando nadie busca la keyword', () => {
  // caso set snorkel: score 82 sobre un listado que ningún comprador abre.
  // Los datos del listado son reales, así que el score no se anula — se
  // descuenta, y el bruto queda a la vista para poder auditarlo.
  const base = {
    busquedasMes: 10000,
    demanda: {},
    competencia: { concentracionTop3Pct: 40, pctFull: 10, sellersConFull: 0 },
    calidad: { ratingPromedio: 4.0, itemsConRating: 20 },
  }
  const sano = calcularScoreOportunidad(base)
  assert.equal(sano.scoreBruto, undefined, 'sin descuento no ensucia la salida')

  const nadie = calcularScoreOportunidad({ ...base, nivelBusqueda: { nivel: 'nulo' } })
  assert.equal(nadie.scoreBruto, sano.score)
  assert.equal(nadie.score, Math.round(sano.score * 0.5))
  assert.equal(nadie.confianzaBusqueda, 0.5)
  assert.equal(nadie.nivelBusqueda, 'nulo')

  // la keyword mal escrita descuenta menos: el producto sí se vende
  const malEscrita = calcularScoreOportunidad({ ...base, nivelBusqueda: { nivel: 'renombrar' } })
  assert.ok(malEscrita.score > nadie.score && malEscrita.score < sano.score)

  // medida y sana: intacto
  for (const nivel of ['alto', 'medio']) {
    assert.equal(calcularScoreOportunidad({ ...base, nivelBusqueda: { nivel } }).score, sano.score)
  }
  // los componentes no se tocan: el descuento es de confianza, no de medición
  assert.deepEqual(nadie.componentes, sano.componentes)
})

test('sin medir el nivel de búsqueda, el score no se castiga', () => {
  const base = {
    busquedasMes: 5000,
    demanda: {},
    competencia: { concentracionTop3Pct: 30, pctFull: 20, sellersConFull: 0 },
    calidad: { ratingPromedio: 4.1, itemsConRating: 10 },
  }
  assert.equal(
    calcularScoreOportunidad({ ...base, nivelBusqueda: null }).score,
    calcularScoreOportunidad(base).score,
  )
})

// SIN CONTEO DE RESEÑAS HAY REPORTE, PERO NO SCORE.
//
// El listado, los precios y la competencia siguen sirviendo, así que el reporte
// se guarda; lo que no se publica es un score construido sobre una demanda que
// no se midió. El nivel 2 reintenta (escalera 2/4/8 h en workers.js).
test('calcularMetricas: sin reseñas hay reporte pero no score', () => {
  const fecha = new Date('2026-07-16T12:00:00Z')
  const snapshots = [
    { sku: 'A1', precio: 10000, vendidos: 5000, rating: 4.0, posicion: 1, fecha },
    { sku: 'A2', precio: 12000, vendidos: 3000, rating: 4.2, posicion: 2, fecha },
    { sku: 'A3', precio: 11000, vendidos: 1000, rating: 4.1, posicion: 3, fecha },
    { sku: 'A4', precio: 9000, vendidos: 500, rating: 3.9, posicion: 4, fecha },
    { sku: 'A5', precio: 13000, vendidos: 500, rating: 4.3, posicion: 5, fecha },
  ]
  const productosPorSku = new Map(
    snapshots.map((s) => [s.sku, { sku: s.sku, vendedor: 'V' + s.sku, esFull: false }]),
  )
  const m = calcularMetricas({ snapshots, productosPorSku, busquedasMes: 5000 })
  assert.equal(m.demanda, null)
  assert.equal(m.scoreOportunidad, null)
  // pero el badge de vendidos sí se resume: sirve para comparar tamaño
  assert.equal(m.vendidosHistoricos.pisoUnidades, 10000)
  assert.equal(m.vendidosHistoricos.maximoPorItem, 5000)
  assert.equal(m.vendidosHistoricos.pctCobertura, 100)
})
// El componente `calidad` (rating promedio del listado) salió del modelo. La
// pregunta que ocupó su lugar es CONSTANCIA: ¿vende todo el año o solo en su
// pico? Un estacional deja el capital dormido diez meses y su sobrante paga
// bodega Full todo ese tiempo.
test('componente constancia: sin ratio medido queda neutro, no castigado', async () => {
  const { calcularScoreOportunidad } = await import('../src/services/metricas.js')
  const base = {
    busquedasMes: 5000,
    demanda: {},
    competencia: { concentracionTop3Pct: 40, pctFull: 30, sellersConFull: 0 },
  }
  // no haber medido la curva todavía no es una falta
  assert.equal(calcularScoreOportunidad(base).componentes.constancia, 50)
  // plano (ratio bajo) puntúa más que estacional agudo (ratio alto)
  const plano = calcularScoreOportunidad({ ...base, ratioPico: 1.2 })
  const agudo = calcularScoreOportunidad({ ...base, ratioPico: 5.3 })
  assert.ok(plano.componentes.constancia > agudo.componentes.constancia)
  assert.ok(agudo.componentes.constancia < 50, 'un pico de 5,3x sí castiga')
})
test('unidadesDelTitulo: detecta packs reales y evita dimensiones/medidas/promos', async () => {
  const { unidadesDelTitulo } = await import('../src/services/metricas.js')
  assert.equal(unidadesDelTitulo('Toallitas Húmedas Pack De 12 Bolsas'), 12)
  assert.equal(unidadesDelTitulo('Toallitas bebé x60'), 60)
  assert.equal(unidadesDelTitulo('Pañitos 100 unidades hipoalergénicos'), 100)
  assert.equal(unidadesDelTitulo('Set de 6 esponjas cocina'), 6)
  assert.equal(unidadesDelTitulo('Calcetines 5 pares algodón'), 5)
  // falsos positivos que NO deben contar
  assert.equal(unidadesDelTitulo('Mantel hule 140x200cm cocina'), null)
  assert.equal(unidadesDelTitulo('Foco solar 60w exterior'), null)
  assert.equal(unidadesDelTitulo('Promoción 2x1 esponjas'), null)
  assert.equal(unidadesDelTitulo('Hervidor eléctrico 1.7 lts'), null)
  assert.equal(unidadesDelTitulo(null), null)
})

test('preciosPorUnidad: mediana comparable cuando el nicho mezcla packs', async () => {
  const { preciosPorUnidad } = await import('../src/services/metricas.js')
  const snapshots = [
    { sku: 'A', precio: 6000 },  // pack 12 → 500/u
    { sku: 'B', precio: 24000 }, // pack 60 → 400/u
    { sku: 'C', precio: 600 },   // sin pack → 600/u
  ]
  const productosPorSku = new Map([
    ['A', { titulo: 'Toallitas pack de 12' }],
    ['B', { titulo: 'Toallitas x60 bolsas' }],
    ['C', { titulo: 'Toallitas viaje' }],
  ])
  const r = preciosPorUnidad({ snapshots, productosPorSku })
  assert.equal(r.mediana, 500) // por unidad: [400, 500, 600]
  assert.equal(r.listingsConPack, 2)
  // nicho unitario (nadie declara pack) → null, no aporta
  assert.equal(
    preciosPorUnidad({
      snapshots: [{ sku: 'C', precio: 600 }],
      productosPorSku: new Map([['C', { titulo: 'Hervidor 1.7 lts' }]]),
    }),
    null,
  )
})

test('calcularDemanda: la cadencia diaria sigue midiendo aunque el cron se adelante', () => {
  // el guardia de ventana degenerada no puede romper la maduración diaria: si
  // el cron corre 20 min antes que ayer, la ventana es 0,99 días y debe medir
  const previa = new Date('2026-08-08T14:56:00Z')
  const actual = new Date('2026-08-09T14:36:00Z')
  const actuales = Array.from({ length: 5 }, (_, i) => ({ sku: `S${i}`, numReviews: 100, fecha: actual }))
  const previos = Array.from({ length: 5 }, (_, i) => ({ sku: `S${i}`, numReviews: 100, fecha: previa }))

  const d = calcularDemanda(actuales, previos, { minItems: 1 })
  assert.equal(d.reviews.ventanaInsuficiente, undefined)
  assert.equal(d.reviews.porDia, 0)
  assert.equal(d.resenasNuevasPorDia, 0, 'un 0 con ventana válida sí es medición')
  assert.ok(d.resolucionResenasDia > 0, 'y viaja con la resolución de su ventana')
})

test('el juez del ruido no borra: anula la tasa y guarda el crudo', () => {
  // contrato que debe cumplir generarReporteNicho al marcar un salto imposible.
  // Se testea la forma del dato porque el cableado vive contra Mongo.
  const demanda = {
    ventasEstimadasPorDia: 35063,
    reviews: { delta: 1402, periodoDias: 1, itemsComparables: 16 },
  }
  const veredicto = { creible: false, salto: 298.4, motivo: 'la curva del año está plana en ese mes' }

  // así lo marca el reporte
  demanda.saltoSospechoso = {
    valorCrudo: demanda.ventasEstimadasPorDia,
    contra: 118,
    salto: veredicto.salto,
    motivo: veredicto.motivo,
  }
  demanda.ventasEstimadasPorDia = null

  assert.equal(demanda.ventasEstimadasPorDia, null, 'sale de la serie y del conteo de maduración')
  assert.equal(demanda.saltoSospechoso.valorCrudo, 35063, 'el dato crudo NO se pierde')
  assert.equal(demanda.reviews.delta, 1402, 'las reseñas contadas se conservan intactas')
})

test('calcularDemanda: el TOTAL también se depura de duplicados de catálogo', () => {
  // caso lampara para uñas: dos listings hermanos del mismo catálogo mostraban
  // el MISMO 1.293, y el total los sumaba dos veces. El score usa ese total,
  // así que iba inflado en todos los nichos con catálogo.
  const fecha = new Date('2026-08-13T12:00:00Z')
  const snaps = [
    { sku: 'A', numReviews: 1293, fecha },
    { sku: 'B', numReviews: 1293, fecha }, // hermano de catálogo: no se cuenta
    { sku: 'C', numReviews: 939, fecha },
    { sku: 'D', numReviews: 12, fecha },
    { sku: 'E', numReviews: 12, fecha }, // bajo el umbral: SÍ se cuenta, es normal
  ]
  const d = calcularDemanda(snaps, null, { minItems: 1 })
  assert.equal(d.reviews.total, 1293 + 939 + 12 + 12, 'el 1.293 repetido entra una vez')
  assert.equal(d.reviews.totalBruto, 3549, 'el crudo queda a la vista')
  assert.equal(d.reviews.duplicadosEnTotal, 1)
  assert.equal(d.reviews.itemsConDato, 5)
})

test('calcularDemanda: declara qué fracción del listado se midió', () => {
  const fecha = new Date('2026-08-13T12:00:00Z')
  // 30 con reseñas de 96 items del scan, como en lampara para uñas
  const snaps = Array.from({ length: 96 }, (_, i) => ({
    sku: `S${i}`,
    fecha,
    ...(i < 30 ? { numReviews: 10 + i } : {}),
  }))
  const d = calcularDemanda(snaps, null, { minItems: 1 })
  assert.equal(d.coberturaReviews.itemsConDato, 30)
  assert.equal(d.coberturaReviews.itemsDelScan, 96)
  assert.equal(d.coberturaReviews.pct, 31, 'sin esto, el total se lee como si midiera todo')
})
