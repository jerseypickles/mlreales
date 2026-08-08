import test from 'node:test'
import assert from 'node:assert/strict'
import { compararCartera } from '../src/services/cartera.js'

// caso real 8-ago (brochas): el que trae tráfico no es el que convierte
const brochas = [
  { sku: 'S8', titulo: 'Set 8', visitas7d: 209, ventas7d: 18, conversion7d: 8.6, precioEfectivo: 1890 },
  { sku: 'S9', titulo: 'Set 9', visitas7d: 190, ventas7d: 17, conversion7d: 8.9, precioEfectivo: 1890 },
  { sku: 'S10', titulo: 'Set 10', visitas7d: 89, ventas7d: 12, conversion7d: 13.5, precioEfectivo: 1890 },
]

test('compararCartera: con un solo producto no hay comparación', () => {
  assert.equal(compararCartera([brochas[0]]), null)
})

test('compararCartera: detecta el trasplante cruzado tráfico↔conversión', () => {
  const c = compararCartera(brochas)
  const t = c.lecciones.find((l) => l.tipo === 'trasplante')
  assert.ok(t, 'no detectó el cruce')
  assert.match(t.texto, /Set 10/)
  assert.match(t.texto, /Set 8/)
})

test('compararCartera: diagnostica cierre vs exposición por producto', () => {
  const c = compararCartera(brochas)
  const cierre = c.lecciones.find((l) => l.tipo === 'cierre')
  const expo = c.lecciones.find((l) => l.tipo === 'exposicion')
  assert.equal(cierre?.sku, 'S8', 'el de más tráfico y peor conversión es problema de cierre')
  assert.equal(expo?.sku, 'S10', 'el que mejor convierte con menos visitas es problema de exposición')
})

test('compararCartera: mismo precio con conversión dispar descarta el precio como causa', () => {
  const c = compararCartera(brochas)
  assert.ok(c.lecciones.some((l) => l.tipo === 'no-es-precio'))
})

test('compararCartera: calcula ventas/día y cuota del nicho', () => {
  const c = compararCartera(brochas, { demandaNichoDia: 145 })
  assert.equal(c.ventasDia, 6.7) // 47 unidades / 7 días
  assert.equal(c.sharePct, 4.6)
  assert.equal(c.productos[0].sku, 'S10') // ordenado por conversión
})

test('compararCartera: precios distintos no disparan la lección de precio', () => {
  const c = compararCartera([
    { sku: 'A', titulo: 'A', visitas7d: 100, ventas7d: 10, conversion7d: 10, precioEfectivo: 1000 },
    { sku: 'B', titulo: 'B', visitas7d: 100, ventas7d: 2, conversion7d: 2, precioEfectivo: 5000 },
  ])
  assert.ok(!c.lecciones.some((l) => l.tipo === 'no-es-precio'))
})
