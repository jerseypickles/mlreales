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

import { entrenarEfecto, presupuestoOptimo, filasEfecto } from '../src/services/ml/publicidad.js'
import { ajustarRidge, predecirRidge } from '../src/services/ml/regresion.js'

// dos productos, 60 días; la publicidad agrega ventas con rendimiento
// decreciente (log), y un producto madura solo (tendencia)
function historia({ efecto = 0.6 } = {}) {
  const dias = []
  let s = 11
  const azar = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (const [itemId, base, crece] of [['A', 2, 0.01], ['B', 1, 0]]) {
    for (let t = 0; t < 60; t++) {
      const dia = new Date(Date.UTC(2026, 6, 1) + t * 86400e3).toISOString().slice(0, 10)
      const gasto = t % 3 === 0 ? 0 : 1000 + Math.round(azar() * 4000)
      const esperado = base * (1 + crece * t) * (1 + efecto * Math.log1p(gasto / 1000))
      const unidades = Math.max(0, Math.round(esperado + (azar() - 0.5)))
      dias.push({ itemId, dia, unidades, gasto, precio: 4000, promo: null, stockFraccion: null, unidadesAds: gasto ? Math.round(unidades * 0.8) : 0 })
    }
  }
  return dias
}

test('entrenarEfecto: recupera un efecto real de la publicidad y le gana a no usarla', () => {
  const r = entrenarEfecto(historia({ efecto: 0.6 }), { ajustar: ajustarRidge, predecir: predecirRidge, remuestreos: 40 })
  assert.equal(r.estado, 'aprendido')
  assert.ok(r.beta > 0.2, `beta ${r.beta}`)
  assert.ok(r.betaP10 > 0)
  assert.ok(r.validacion.mejoraPct > 0)
  assert.equal(r.productosEntrenados, 2)
  const a = r.productos.find((p) => p.itemId === 'A')
  assert.ok(a.costoVentaMarginal > 0 && a.costoPorVentaIncremental > 0)
})

test('entrenarEfecto: sin efecto real no inventa uno', () => {
  const r = entrenarEfecto(historia({ efecto: 0 }), { ajustar: ajustarRidge, predecir: predecirRidge, remuestreos: 40 })
  assert.notEqual(r.estado, 'aprendido')
})

test('filasEfecto: sin stock no cuenta, y un producto sin publicidad o con pocos días no entra', () => {
  const dias = historia()
  dias.push(...Array.from({ length: 30 }, (_, t) => ({ itemId: 'C', dia: `2026-07-${String(t + 1).padStart(2, '0')}`, unidades: 1, gasto: 0 })))
  dias[5].stockFraccion = 0.1
  const items = filasEfecto(dias)
  assert.deepEqual(items.map((i) => i.itemId).sort(), ['A', 'B'])
  assert.equal(items.find((i) => i.itemId === 'A').dias.length, 59)
})

test('presupuestoOptimo: el gasto donde la próxima venta cuesta lo que deja', () => {
  assert.equal(presupuestoOptimo({ beta: 0.5, media: 4, contribucion: 2000 }), 3000)
  assert.equal(presupuestoOptimo({ beta: 0.5, media: 1, contribucion: 1000 }), 0)
  assert.equal(presupuestoOptimo({ beta: -0.1, media: 4, contribucion: 2000 }), 0)
})

import { medirTicket, curvaTicket, dejaAPrecio } from '../src/services/ml/publicidad.js'

test('medirTicket y curvaTicket: el envío fijo hace que el ticket bajo deje poco (ventas reales 28-sep)', () => {
  const filas = [
    { precio: 4034, comision: 686, envio: 889, adsPorVenta: 1028, unidades: 85 },
    { precio: 3829, comision: 766, envio: 1175, adsPorVenta: 1290, unidades: 19 },
    { precio: 3842, comision: 653, envio: 835, adsPorVenta: 1803, unidades: 10 },
    { precio: 7462, comision: 1268, envio: 841, adsPorVenta: 2587, unidades: 7 },
    { precio: 5000, comision: 850, envio: 800, adsPorVenta: 0, unidades: 2 }, // pocas ventas: no entra
  ]
  const m = medirTicket(filas)
  assert.equal(m.productos, 4)
  assert.ok(m.comisionPct > 16 && m.comisionPct < 19)
  assert.ok(m.publicidadPct > 25 && m.publicidadPct < 35)
  assert.ok(m.envioMedio > 850 && m.envioMedio < 1000)
  const t = curvaTicket(m, [2990, 3990, 5990, 7990, 9990, 14990], () => 830)
  const pct = t.curva.map((c) => c.pctConAds)
  assert.ok(pct.every((v, i) => i === 0 || v >= pct[i - 1]), 'con envío fijo, a más precio más queda')
  assert.ok(t.minimo40 > 3990)
  const d = dejaAPrecio({ ...t, medido: m }, 4490)
  assert.equal(d.bajo, true)
  assert.ok(d.pctConAds < d.pctSinAds)
  assert.equal(dejaAPrecio(null, 4490), null)
})

test('curvaTicket: si el envío salta en $9.990, el mínimo no puede caer justo antes del salto', () => {
  const m = { comisionPct: 17, publicidadPct: 29, envioMedio: 830 }
  const t = curvaTicket(m, [7990, 8990, 9990, 11990, 14990], (p) => (p >= 9990 ? 3000 : 830))
  // a $7.990 ya queda 43%; a $9.990 el envío salta y cae a 24%: eso es un valle, no sube el mínimo
  assert.equal(t.minimo40, 7990)
  assert.equal(t.valles.length, 1)
  assert.equal(t.valles[0].desde, 9990)
  const d = dejaAPrecio({ ...t, medido: m }, 9990)
  assert.equal(d.enValle, true)
  assert.equal(d.bajo, true)
  assert.equal(dejaAPrecio({ ...t, medido: m }, 8990).bajo, false)
  assert.equal(dejaAPrecio({ ...t, medido: m }, 0), null)
})
