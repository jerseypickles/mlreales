import test from 'node:test'
import assert from 'node:assert/strict'
import { roasEquilibrio, veredictoAnuncio } from '../src/services/economiaAds.js'

test('roasEquilibrio: el techo sale del precio, comisión y envío reales', () => {
  // Brochas Set 10: $2.990, comisión 13% = $389, envío Full $799 (sondeados)
  const r = roasEquilibrio({ precio: 2990, comision: 389, envio: 799 })
  assert.equal(r.contribucion, 1802)
  assert.equal(r.contribucionPct, 60.3)
  assert.equal(r.roas, 1.66, 'bajo 1,66x ese anuncio destruye margen')

  // la lámpara a $7.990 aguanta mucho más porque el envío pesa menos
  const lampara = roasEquilibrio({ precio: 7990, comision: 1039, envio: 799 })
  assert.equal(lampara.roas, 1.3)

  // con el costo de la mercadería el equilibrio se dispara: es lo que falta
  const conCosto = roasEquilibrio({ precio: 2990, comision: 389, envio: 799, costoUnitario: 800 })
  assert.ok(conCosto.roas > 2.9, `con costo real el equilibrio sube, dio ${conCosto.roas}`)

  // vender bajo costo no tiene ROAS que lo salve
  const imposible = roasEquilibrio({ precio: 2990, comision: 389, envio: 799, costoUnitario: 2000 })
  assert.equal(imposible.imposible, true)
  assert.equal(imposible.roas, null)
  assert.equal(roasEquilibrio({ precio: 0 }), null)
})

test('veredictoAnuncio: se juzga contra SU equilibrio, no contra un ACOS parejo', () => {
  // mismo ROAS real, veredicto opuesto según el producto
  assert.equal(veredictoAnuncio({ roasReal: 1.5, roasEquilibrio: 1.3, unidades: 4 }).estado, 'justo')
  assert.equal(veredictoAnuncio({ roasReal: 1.5, roasEquilibrio: 1.92, unidades: 4 }).estado, 'pierde')
  assert.equal(veredictoAnuncio({ roasReal: 2.6, roasEquilibrio: 1.66, unidades: 6 }).estado, 'escalar')

  // gastar sin vender es su propia categoría: no es "malo ROAS", es sin señal
  assert.equal(veredictoAnuncio({ roasReal: null, roasEquilibrio: 1.9, unidades: 0 }).estado, 'sin-ventas')
  // sin precio del producto no se inventa un equilibrio
  assert.equal(veredictoAnuncio({ roasReal: 2, roasEquilibrio: null, unidades: 3 }).estado, 'sin-economia')
})
