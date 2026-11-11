import test from 'node:test'
import assert from 'node:assert/strict'
import { calidadDeEntrada, resumenPendientes } from '../frontend/src/lib/calidadMl.js'

const video = { clave: 'UP_SHORTS', titulo: 'Crea un video para no perder ventas', detalle: 'Hasta un minuto, vertical.', avance: 0 }
const ficha = (avance) => ({ clave: 'UP_TECHNICAL_SPECIFICATIONS_MAIN', titulo: 'Corrige las características', detalle: 'Completa las características principales.', avance })

test('calidad por tarjeta: los colores de una familia muestran cada pendiente una vez, con el puntaje más bajo', () => {
  const c = calidadDeEntrada([
    { calidadMl: { puntaje: 70, nivel: 'Estándar', puntajeProducto: 90, pendientes: [video, ficha(0.9)], comerciales: [{ clave: 'UP_FREE_SHIPPING', titulo: 'Ofrece envío gratis' }] } },
    { calidadMl: { puntaje: 65, nivel: 'Estándar', puntajeProducto: 75, pendientes: [video, ficha(0.6)], comerciales: [{ clave: 'UP_FREE_SHIPPING', titulo: 'Ofrece envío gratis' }, { clave: 'UP_FINANCING', titulo: 'Elige Premium' }, { clave: 'UP_NUEVA', titulo: 'Algo nuevo' }] } },
    { calidadMl: null }, // una variante que todavía no se leyó
  ])
  assert.equal(c.puntajeProducto, 75)
  assert.equal(c.puntaje, 65)
  assert.equal(c.publicaciones, 2)
  assert.deepEqual(c.pendientes.map((p) => [p.clave, p.en, p.avance]), [['UP_SHORTS', 2, 0], ['UP_TECHNICAL_SPECIFICATIONS_MAIN', 2, 0.6]])
  assert.deepEqual(c.comerciales, ['envío gratis', 'publicar en Premium para dar cuotas sin interés', 'Algo nuevo'])
  assert.equal(resumenPendientes(c), 'ML pide video y características')
})

test('calidad por tarjeta: sin lectura no hay nada que mostrar, y sin pendientes no hay etiqueta', () => {
  assert.equal(calidadDeEntrada([{ calidadMl: null }, {}]), null)
  assert.equal(calidadDeEntrada(undefined), null)
  const completa = calidadDeEntrada([{ calidadMl: { puntaje: 95, nivel: 'Profesional', puntajeProducto: 100, pendientes: [], comerciales: [] } }])
  assert.equal(completa.puntajeProducto, 100)
  assert.equal(resumenPendientes(completa), null)
  assert.equal(resumenPendientes({ pendientes: [video] }), 'ML pide video')
  assert.equal(resumenPendientes({ pendientes: [ficha(0.5), video] }), 'ML pide video y características', 'el orden no depende de cómo venga')
  assert.equal(resumenPendientes({ pendientes: [{ clave: 'UP_ALGO_NUEVO' }] }), 'ML pide un dato')
})
