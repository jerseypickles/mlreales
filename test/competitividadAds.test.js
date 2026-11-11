import test from 'node:test'
import assert from 'node:assert/strict'
import { leerCompetitividad, describirCompetitividad, ajustarPorCompetitividad } from '../src/services/ml/competitividadAds.js'

// las métricas tal como las entrega el detalle de campaña de Product Ads
const crudas = (mostrado, presupuesto, ranking, extra = {}) => ({
  prints: 12000, impression_share: mostrado, lost_impression_share_by_budget: presupuesto, lost_impression_share_by_ad_rank: ranking,
  top_impression_share: 4.2, acos_benchmark: 8, ...extra,
})

test('competitividad: las fracciones de ML quedan con nombre y el ACOS de referencia pasa a ROAS', () => {
  const c = leerCompetitividad(crudas(0.3, 0.45, 0.25))
  assert.deepEqual(c, { mostrado: 0.3, perdidoPresupuesto: 0.45, perdidoRanking: 0.25, arribaPct: 4.2, roasReferencia: 12.5, impresiones: 12000 })
  // una campaña que no entró a ninguna subasta trae todo en cero: no hay nada que leer
  assert.equal(leerCompetitividad(crudas(0, 0, 0, { prints: 0, acos_benchmark: 0 })), null)
  assert.equal(leerCompetitividad(undefined), null)
  assert.equal(leerCompetitividad(crudas(0.5, 0, 0.5, { acos_benchmark: 0 })).roasReferencia, null)
})

test('competitividad: dice cuál es el freno sin recomendar gasto', () => {
  const presupuesto = describirCompetitividad(leerCompetitividad(crudas(0.3, 0.45, 0.25)))
  assert.equal(presupuesto.freno, 'presupuesto')
  assert.match(presupuesto.texto, /45% de sus apariciones porque se le acaba el presupuesto.*25% por ranking/)
  const ranking = describirCompetitividad(leerCompetitividad(crudas(0.2, 0, 0.8)))
  assert.equal(ranking.freno, 'ranking')
  assert.match(ranking.texto, /80% de sus apariciones por ranking.*El presupuesto no es su freno/)
  const bien = describirCompetitividad(leerCompetitividad(crudas(0.7, 0, 0.3)))
  assert.equal(bien.freno, 'ninguno')
  assert.match(bien.texto, /Aparece en el 70%/)
  assert.equal(describirCompetitividad(null), null)
})

test('plan: un «subir» se queda en «mantener» si la campaña no pierde nada por presupuesto', () => {
  const fila = { accion: 'subir', budgetDiario: 3000, texto: 'Deja plata con aire. Sube a $3.000/día.', metricas: { resultado7: 5200, gastoDiario: 2000 } }
  const r = ajustarPorCompetitividad(fila, leerCompetitividad(crudas(0.2, 0, 0.8)))
  assert.equal(r.accion, 'mantener')
  assert.equal(r.budgetDiario, 2000, 'se queda en lo que gasta hoy')
  assert.match(r.texto, /Deja plata \(\$5\.200 en 7 días\), pero subir el presupuesto no traería más venta.*pierde 80% por ranking.*Mantén \$2\.000\/día/)
  assert.equal(r.competitividad.perdidoRanking, 0.8)
})

test('plan: si pierde por presupuesto, el «subir» que decidió la plata se mantiene y ML lo confirma', () => {
  const fila = { accion: 'subir', budgetDiario: 3000, texto: 'Deja plata con aire. Sube a $3.000/día.', metricas: { resultado7: 5200, gastoDiario: 2000 } }
  const r = ajustarPorCompetitividad(fila, leerCompetitividad(crudas(0.3, 0.45, 0.25)))
  assert.equal(r.accion, undefined, 'no toca la acción')
  assert.equal(r.budgetDiario, undefined)
  assert.match(r.texto, /^Deja plata con aire\. Sube a \$3\.000\/día\. Mercado Libre lo confirma: la campaña pierde el 45%/)
})

test('plan: el dato nunca empuja a gastar más por su cuenta', () => {
  const comp = leerCompetitividad(crudas(0.3, 0.45, 0.25))
  // deja plata pero sin aire para subir: se agrega el dato, la acción sigue siendo mantener
  const mantener = ajustarPorCompetitividad({ accion: 'mantener', texto: 'Deja plata. Mantén.', metricas: { resultado7: 900, gastoDiario: 2000 } }, comp)
  assert.equal(mantener.accion, undefined)
  assert.match(mantener.texto, /^Deja plata\. Mantén\. Dato de Mercado Libre: pierde el 45%/)
  // pierde plata: aunque le falte presupuesto, la recomendación de bajar no se toca
  const bajar = ajustarPorCompetitividad({ accion: 'bajar', texto: 'Pierde. Baja.', metricas: { resultado7: -4000, gastoDiario: 2000 } }, comp)
  assert.deepEqual(Object.keys(bajar), ['competitividad'])
  // con muy pocas subastas el dato se muestra, pero no cambia nada
  const pocas = ajustarPorCompetitividad({ accion: 'subir', texto: 'Sube.', metricas: { resultado7: 100, gastoDiario: 1000 } }, leerCompetitividad(crudas(0.5, 0, 0.5, { prints: 120 })))
  assert.deepEqual(Object.keys(pocas), ['competitividad'])
  assert.deepEqual(ajustarPorCompetitividad({ accion: 'subir' }, null), {})
})
