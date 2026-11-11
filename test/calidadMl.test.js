import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizarCalidadMl, tocaLeerCalidadMl, CALIDAD_ML_CADA_MS } from '../src/services/calidadMl.js'

// la respuesta de /item/{id}/performance, con sus dos grupos
const respuesta = {
  entity_type: 'ITEM', entity_id: 'X1', score: 64, level: 'medium', level_wording: 'Estándar', calculated_at: '2026-01-02T03:04:05Z',
  buckets: [
    { key: 'USER_PRODUCT', type: 'USER_PRODUCT', status: 'PENDING', score: 87.4, title: 'Datos del producto', variables: [
      { key: 'UP_GTIN', status: 'COMPLETED', score: 100, title: 'Indica el código universal', rules: [{ key: 'UP_HAS_GTIN', status: 'COMPLETED', progress: 1 }] },
      { key: 'UP_SHORTS', status: 'PENDING', score: 0, title: 'Crea un video para no perder ventas', rules: [{ key: 'UP_HAS_SHORTS', status: 'PENDING', progress: 0, wordings: { title: 'Los videos tienen que ser de hasta un minuto, en formato vertical.' } }] },
      { key: 'UP_TECHNICAL_SPECIFICATIONS_MAIN', status: 'PENDING', score: 80, title: 'Corrige las características', rules: [{ key: 'UP_TS_MAIN_QUANTITY', status: 'PENDING', progress: 0.8, wordings: { title: 'Completa las características principales.' } }] },
    ] },
    { key: 'X1', type: 'ITEM', status: 'PENDING', score: 30.2, title: 'Condiciones de venta', variables: [
      { key: 'UP_PROMOTIONS', status: 'COMPLETED', score: 100, title: 'Participa de una promoción', rules: [] },
      { key: 'UP_FINANCING', status: 'PENDING', score: 0, title: 'Elige Premium para ofrecer cuotas sin interés', rules: [{ key: 'UP_LISTING_TYPE_PREMIUM', status: 'PENDING', progress: 0 }] },
      { key: 'UP_FREE_SHIPPING', status: 'PENDING', score: 0, title: 'Ofrece envío gratis', rules: [{ key: 'UP_HAS_FREE_SHIPPING', status: 'PENDING', progress: 0 }] },
    ] },
  ],
}

test('calidad de ML: se sigue lo que depende de la publicación; lo comercial solo se nombra', () => {
  const ahora = new Date('2026-11-11T06:00:00Z')
  const c = normalizarCalidadMl(respuesta, { ahora })
  assert.equal(c.puntaje, 64)
  assert.equal(c.nivel, 'Estándar')
  assert.equal(c.puntajeProducto, 87, 'el puntaje del grupo «Datos del producto»')
  assert.deepEqual(c.pendientes.map((p) => p.clave), ['UP_SHORTS', 'UP_TECHNICAL_SPECIFICATIONS_MAIN'])
  assert.deepEqual(c.pendientes[0], { clave: 'UP_SHORTS', titulo: 'Crea un video para no perder ventas', detalle: 'Los videos tienen que ser de hasta un minuto, en formato vertical.', avance: 0 })
  assert.equal(c.pendientes[1].avance, 0.8, 'las características van a medias')
  assert.deepEqual(c.comerciales, [{ clave: 'UP_FINANCING', titulo: 'Elige Premium para ofrecer cuotas sin interés' }, { clave: 'UP_FREE_SHIPPING', titulo: 'Ofrece envío gratis' }])
  assert.equal(c.leidaEl, ahora)
  assert.equal(c.calculadaEl, '2026-01-02T03:04:05Z')
})

test('calidad de ML: un requisito comercial fuera de su grupo se reconoce por su clave; sin grupos no hay nada que guardar', () => {
  const c = normalizarCalidadMl({ score: 70, level: 'medium', buckets: [{ type: 'USER_PRODUCT', score: 70, variables: [
    { key: 'UP_ME_FLEX_ITEM_OPTIN', status: 'PENDING', title: 'Entrega en el día con Envíos Flex', rules: [] },
    { key: 'UP_PICTURES', status: 'PENDING', title: 'Mejora las fotos', rules: [] },
  ] }] })
  assert.deepEqual(c.pendientes.map((p) => p.clave), ['UP_PICTURES'])
  assert.deepEqual(c.comerciales.map((x) => x.clave), ['UP_ME_FLEX_ITEM_OPTIN'])
  assert.equal(c.nivel, 'medium')
  assert.equal(normalizarCalidadMl(null), null)
  assert.equal(normalizarCalidadMl({ message: 'not found' }), null)
})

test('calidad de ML: se vuelve a leer cuando lo guardado tiene más de seis horas', () => {
  const ahora = new Date('2026-11-11T12:00:00Z')
  assert.equal(tocaLeerCalidadMl(null, ahora), true)
  assert.equal(tocaLeerCalidadMl({ leidaEl: new Date(ahora - CALIDAD_ML_CADA_MS + 60e3) }, ahora), false)
  assert.equal(tocaLeerCalidadMl({ leidaEl: new Date(ahora - CALIDAD_ML_CADA_MS - 60e3).toISOString() }, ahora), true)
})
