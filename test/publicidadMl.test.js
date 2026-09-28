import test from 'node:test'
import assert from 'node:assert/strict'
import { aprenderDeAnuncios, planPublicidad } from '../src/services/ml/publicidad.js'

// los anuncios reales al 28-sep-2026 (acumulado), redondeados
const FILAS = [
  { itemId: 'set8', costo: 191720, clicks: 1563, unidadesAds: 145, unidadesOrganicas: 27, ventaAds: 545311, dias: 60 },
  { itemId: 'lampara', costo: 49693, clicks: 342, unidadesAds: 14, unidadesOrganicas: 4, ventaAds: 100047, dias: 40 },
  { itemId: 'saca', costo: 51447, clicks: 223, unidadesAds: 29, unidadesOrganicas: 2, ventaAds: 172262, dias: 40 },
  { itemId: 'tiro', costo: 32241, clicks: 291, unidadesAds: 21, unidadesOrganicas: 10, ventaAds: 86140, dias: 60 },
  { itemId: 'set10', costo: 34254, clicks: 287, unidadesAds: 31, unidadesOrganicas: 8, ventaAds: 92242, dias: 60 },
  { itemId: 'set18', costo: 26999, clicks: 380, unidadesAds: 15, unidadesOrganicas: 8, ventaAds: 56225, dias: 45 },
  { itemId: 'escopeta', costo: 5662, clicks: 87, unidadesAds: 3, unidadesOrganicas: 0, ventaAds: 10174, dias: 30 },
  { itemId: 'sin-gasto', costo: 0, clicks: 0, unidadesAds: 0, unidadesOrganicas: 0, ventaAds: 0, dias: 0 },
]
const ENVIO = new Map([['set8', { porUnidad: 1322, base: 799 }], ['saca', { porUnidad: 2455, base: 799 }]])

test('aprenderDeAnuncios: ROAS con volumen, costo por venta, envío real sobre la base', () => {
  const { parametros: p, porProducto } = aprenderDeAnuncios(FILAS, ENVIO)
  assert.equal(porProducto.length, 7) // el anuncio sin gasto ni ventas no enseña nada
  assert.equal(p.productosConMuestra, 6) // la escopeta vendió 3: sin muestra
  assert.ok(p.roas.mediana > 2 && p.roas.mediana < 3)
  assert.ok(p.roas.p75 >= p.roas.mediana)
  assert.ok(p.costoPorVenta.mediana > 1100 && p.costoPorVenta.mediana < 1900)
  assert.ok(p.factorEnvio > 1.6 && p.factorEnvio < 2) // ponderado por unidades: Set 8 pesa más
  assert.equal(p.confianza, 'media')
})

test('planPublicidad: sin costo dice hasta cuánto puede costar; con costo, ROAS objetivo y veredicto', () => {
  const { parametros: p } = aprenderDeAnuncios(FILAS, ENVIO)
  const barato = planPublicidad({ precio: 2990, comisionPct: 17, envioTarifa: 799 }, p)
  assert.equal(barato.veredicto, 'solo-organico') // a $2.990 ni gratis paga la publicidad
  const lampara = planPublicidad({ precio: 9990, comisionPct: 17, envioTarifa: 829 }, p)
  assert.equal(lampara.veredicto, 'depende-del-costo')
  assert.ok(lampara.costoMaximo > 2000)
  const conCosto = planPublicidad({ precio: 9990, costoUnitario: 1500, comisionPct: 17, envioTarifa: 829 }, p)
  assert.ok(conCosto.roasObjetivo > conCosto.roasEquilibrio)
  assert.equal(conCosto.veredicto, 'anunciar')
  assert.ok(conCosto.presupuestoDiario >= 1000 && conCosto.presupuestoDiario % 500 === 0)
  assert.equal(conCosto.presupuestoPrueba14Dias, conCosto.presupuestoDiario * 14)
  const caro = planPublicidad({ precio: 4490, costoUnitario: 1500, comisionPct: 17, envioConocido: 1322 }, p)
  assert.equal(caro.veredicto, 'solo-organico')
  assert.equal(caro.envioOrigen, 'medido')
  assert.equal(planPublicidad({ precio: 5000 }, null), null)
})
