import test from 'node:test'
import assert from 'node:assert/strict'
import { fichaDesdeHtml, VARIANTES_FICHA } from '../src/services/zyteAb.js'

test('A/B de Zyte: el precio sale de los datos estructurados, no del primer monto pintado (que suele ser el tachado)', () => {
  const html = '<span class="andes-money-amount__fraction">15.990</span><meta itemprop="price" content="12990">' +
    '<script type="application/ld+json">{"aggregateRating":{"ratingValue":4.7,"reviewCount":321}}</script> (+25 disponibles)'
  const f = fichaDesdeHtml(html)
  assert.equal(f.precio, 12990)
  assert.equal(f.rating, 4.7)
  assert.equal(f.resenias, 321)
  assert.equal(f.stock.stock, 26)
  assert.equal(fichaDesdeHtml('{"offers":{"@type":"Offer","price":8990,"priceCurrency":"CLP"}}').precio, 8990)
})

test('A/B de Zyte: sin navegador no hay acciones ni extracción; la variante actual es la de producción', () => {
  const u = 'https://articulo.mercadolibre.cl/MLC-1'
  assert.equal(VARIANTES_FICHA.httpSinGeo(u).browserHtml, undefined)
  assert.equal(VARIANTES_FICHA.httpSinGeo(u).actions, undefined)
  assert.equal(VARIANTES_FICHA.httpSinGeo(u).geolocation, undefined)
  assert.equal(VARIANTES_FICHA.actual(u).product, true)
})
