import test from 'node:test'
import assert from 'node:assert/strict'
import { INVARIANTES, derivaDeCobertura } from '../src/services/invariantes.js'

// EL DETECTOR DE DERIVA, GENERALIZADO.
//
// Vigilaba un solo campo —`numReviews`— y por eso el 29-ago-2026 no vio que el
// nombre del vendedor había dejado de llegar para listados enteros: ML sirve el
// componente `seller` de dos formas y el parser leía una. Lo encontró el
// importador preguntando por un nicho, que es exactamente el modo de fallo que
// estas invariantes existen para evitar.

test('deriva: un desplome de un día para otro se caza', async () => {
  // 60% habitual durante dos semanas, 10% en las últimas 36 h
  const cobertura = async (desde) => (Date.now() - desde.getTime() < 40 * 3600e3 ? 10 : 60)
  const r = await derivaDeCobertura('vendedor', cobertura)
  assert.equal(r.ok, false)
  assert.match(r.detalle, /cayó/)
})

// La señal relativa sola no basta: si la caída se vuelve la nueva normalidad,
// comparar contra "lo habitual reciente" la aprueba. Pasó el 23-ago con las
// reseñas: de 56% a 21% en dos semanas, y el chequeo decía que todo bien.
test('deriva: una degradación que ya es la nueva normalidad también se caza', async () => {
  let llamada = 0
  const cobertura = async () => {
    llamada++
    // hoy 20 y los días recientes 21 —la caída relativa es del 5%, invisible—
    // pero hace dos semanas este sistema entregaba 60
    if (llamada === 1) return 20
    return llamada <= 13 ? 21 : 60
  }
  const r = await derivaDeCobertura('reseñas', cobertura)
  assert.equal(r.ok, false)
  assert.match(r.detalle, /estancó|llegó a entregar/)
})

test('deriva: una cobertura estable no alarma', async () => {
  const r = await derivaDeCobertura('precio', async () => 55)
  assert.equal(r.ok, true)
})

// Sin datos no se inventa una alarma: un chequeo que grita cuando no sabe
// entrena a ignorar las alertas, que es peor que no tenerlas.
test('deriva: sin datos recientes no se inventa una alarma', async () => {
  const r = await derivaDeCobertura('vendidos', async () => null)
  assert.equal(r.ok, true)
  assert.match(r.detalle, /sin datos/)
})

test('deriva: sin historia suficiente solo alarma bajo el piso', async () => {
  let n = 0
  // solo dos ventanas con dato: no alcanza para una mediana
  const escasa = async () => (++n <= 2 ? 3 : null)
  const r = await derivaDeCobertura('vendedor', escasa, { pisoSinHistoria: 5 })
  assert.equal(r.ok, false)
  const s = await derivaDeCobertura('vendedor', async () => (++n <= 2 ? 40 : null), { pisoSinHistoria: 5 })
  assert.equal(s.ok, true)
})

test('el registro no tiene ids repetidos ni chequeos sin función', () => {
  const ids = INVARIANTES.map((i) => i.id)
  assert.equal(ids.length, new Set(ids).size, 'ids duplicados')
  for (const i of INVARIANTES) {
    assert.equal(typeof i.fn, 'function', `${i.id} sin función`)
    assert.ok(i.que && i.que.length > 20, `${i.id} sin descripción util`)
  }
})
