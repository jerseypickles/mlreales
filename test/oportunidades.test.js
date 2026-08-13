import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectarTramites,
  tendenciaVentas,
  unidadesPrimeraCompra,
  inversionEstimadaUsd,
  cambiosPorEtapa,
} from '../src/services/oportunidades.js'

test('cambiosPorEtapa: descartado pausa, salir de descartado reactiva, avanzadas bajan a semanal', () => {
  const descartar = cambiosPorEtapa('descartado', { etapaCompra: 'evaluando' })
  assert.equal(descartar.estado, 'pausado')
  assert.equal(descartar.etapaCompra, 'descartado')

  const reactivar = cambiosPorEtapa('evaluando', { etapaCompra: 'descartado' })
  assert.equal(reactivar.estado, 'activo')

  const cotizar = cambiosPorEtapa('cotizando', { etapaCompra: 'evaluando' })
  assert.equal(cotizar.frecuenciaScan, 'semanal')
  assert.equal(cotizar.estado, undefined) // no toca el estado

  const espera = cambiosPorEtapa('en-espera', { etapaCompra: 'evaluando' })
  assert.equal(espera.frecuenciaScan, 'semanal') // parqueado con motivo: sigue midiéndose barato
  assert.equal(espera.estado, undefined)

  assert.equal(cambiosPorEtapa('inexistente', {}), null)
})

test('detectarTramites: encuentra SEC e ISP en textos de riesgo', () => {
  assert.deepEqual(
    detectarTramites(['Requiere certificación SEC por ser 220V', 'competencia dura']),
    ['SEC'],
  )
  assert.deepEqual(detectarTramites(['necesita registro sanitario ISP']), ['ISP'])
  assert.deepEqual(detectarTramites(['pocas reseñas', null, undefined]), [])
  assert.deepEqual(detectarTramites(['sequía de stock']), []) // "sec" dentro de otra palabra no cuenta
})

test('detectarTramites: las menciones negadas NO ponen chip (caso silla playa plegable)', () => {
  assert.deepEqual(detectarTramites(['No requiere SEC ni ISP, entra directo']), [])
  assert.deepEqual(detectarTramites(['sin trámites: ni certificación SEC ni registro sanitario']), [])
  assert.deepEqual(detectarTramites(['producto exento de SEC']), [])
  // negado uno, afirmado el otro
  assert.deepEqual(detectarTramites(['no requiere ISP, pero sí certificación SEC por 220V']), ['SEC'])
  // "sin embargo" no es negación
  assert.deepEqual(detectarTramites(['parece simple; sin embargo requiere SEC']), ['SEC'])
})

test('tendenciaVentas: sube/baja/estable con umbral de ±15%', () => {
  // la señal es el conteo de RESEÑAS NUEVAS por día, no una venta inventada
  const rep = (v) => ({ metricas: { demanda: { resenasNuevasPorDia: v } } })
  assert.equal(tendenciaVentas(rep(12), rep(10)), 'sube')
  assert.equal(tendenciaVentas(rep(8), rep(10)), 'baja')
  assert.equal(tendenciaVentas(rep(10.5), rep(10)), 'estable')
  assert.equal(tendenciaVentas(rep(10), null), null)
  assert.equal(tendenciaVentas(rep(10), rep(0)), null)
})

test('unidadesPrimeraCompra: rangos, números sueltos y texto sin números', () => {
  assert.equal(unidadesPrimeraCompra('50-100 unidades'), 75)
  assert.equal(unidadesPrimeraCompra('100 unidades'), 100)
  assert.equal(unidadesPrimeraCompra('entre 30 a 60 unidades'), 45)
  assert.equal(unidadesPrimeraCompra('un pedido chico'), null)
})

test('inversionEstimadaUsd: unidades × FOB máximo', () => {
  assert.equal(inversionEstimadaUsd('50-100 unidades', 6), 450)
  assert.equal(inversionEstimadaUsd('50-100 unidades', null), null)
  assert.equal(inversionEstimadaUsd('sin número', 6), null)
})

test('confirmacionVeredicto: 3+ scans sin caída = confirmado; lo demás preliminar', async () => {
  const { confirmacionVeredicto } = await import('../src/services/oportunidades.js')
  assert.equal(confirmacionVeredicto(3, 'sube'), 'confirmado')
  assert.equal(confirmacionVeredicto(4, 'estable'), 'confirmado')
  assert.equal(confirmacionVeredicto(3, 'baja'), 'preliminar') // demanda cayendo no confirma
  assert.equal(confirmacionVeredicto(1, 'sube'), 'preliminar')
  assert.equal(confirmacionVeredicto(0, null), 'preliminar')
})

test('detectarSellersGemelos: no-oficiales chicos ganando reseñas; oficiales y gigantes fuera', async () => {
  const { detectarSellersGemelos } = await import('../src/services/metricas.js')
  const snapshots = [
    { sku: 'A', numReviews: 40 },
    { sku: 'B', numReviews: 1200 },
    { sku: 'C', numReviews: 15 },
    { sku: 'D', numReviews: 90 },
  ]
  const productosPorSku = new Map([
    ['A', { vendedor: 'TIENDITA_GEN', esTiendaOficial: false }],
    ['B', { vendedor: 'GIGANTE_NO_OFICIAL', esTiendaOficial: false }],
    ['C', { vendedor: 'NYX_OFICIAL', esTiendaOficial: true }],
    ['D', { vendedor: 'OTRO_CHICO', esTiendaOficial: false }],
  ])
  const snapshotsPrevios = [
    { sku: 'A', numReviews: 25 }, // +15: gemelo creciendo
    { sku: 'B', numReviews: 1100 }, // +100 pero venía con 1100: gigante, fuera
    { sku: 'C', numReviews: 5 }, // oficial, fuera
    { sku: 'D', numReviews: 90 }, // sin reseñas nuevas, fuera
  ]

  const gemelos = detectarSellersGemelos({ snapshots, productosPorSku, snapshotsPrevios })
  assert.equal(gemelos.length, 1)
  assert.equal(gemelos[0].vendedor, 'TIENDITA_GEN')
  assert.equal(gemelos[0].reviewsNuevas, 15)

  // sin scan previo no hay señal (se necesita la película, no la foto)
  assert.equal(detectarSellersGemelos({ snapshots, productosPorSku, snapshotsPrevios: null }), null)
})

test('exwObjetivo: ancla al 80% del máximo con un decimal; nunca el tope real', async () => {
  const { exwObjetivo } = await import('../src/services/oportunidades.js')
  assert.equal(exwObjetivo(18), 14.4)
  assert.equal(exwObjetivo(2.5), 2)
  assert.equal(exwObjetivo(18, 70), 12.6)
  assert.equal(exwObjetivo(null), null)
  assert.equal(exwObjetivo(0), null)
})

test('parsearRevisarEn: AAAA-MM al día 1, AAAA-MM-DD exacto, basura → null', async () => {
  const { parsearRevisarEn } = await import('../src/services/analista.js')
  assert.equal(parsearRevisarEn('2027-01').toISOString().slice(0, 10), '2027-01-01')
  assert.equal(parsearRevisarEn('2026-11-15').toISOString().slice(0, 10), '2026-11-15')
  assert.equal(parsearRevisarEn('enero 2027'), null)
  assert.equal(parsearRevisarEn(null), null)
})
