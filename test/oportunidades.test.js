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
  const rep = (v) => ({ metricas: { demanda: { ventasEstimadasPorDia: v } } })
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
