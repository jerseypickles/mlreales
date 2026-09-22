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

test('productoDesdeHtml: lee del JSON-LD lo mismo que la extracción de Zyte, con su forma', async () => {
  const { productoDesdeHtml } = await import('../src/services/detalleMl.js')
  const { compararProducto } = await import('../src/services/zyteAb.js')
  // el reviewCount del JSON-LD son solo las reseñas con comentario (31 de 57)
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: 'Set 8 Brochas', sku: 'MLC4212659314', brand: { '@type': 'Brand', name: 'Genérica' },
    offers: { '@type': 'Offer', price: 4490, priceCurrency: 'CLP', availability: 'https://schema.org/InStock' }, aggregateRating: { ratingValue: 4.8, reviewCount: 31 } }
  const html = `<link rel="canonical" href="https://articulo.mercadolibre.cl/MLC-4212659314-set-_JM"/><script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    // el estado embebido trae previous_price de otras ofertas: no se usa
    '{"type":"price","id":"price","price":{"previous_price":{"value":81107,"currency":"CLP"}}}' +
    // el primer "Antes" visible es el del precio principal; el segundo, del carrusel
    '<span class="andes-money-amount--previous" aria-label="Antes: 5990 pesos chilenos"></span>' +
    '<span class="andes-money-amount--previous" aria-label="Antes: 399990 pesos chilenos"></span>"original_price":199990' +
    '"reviews":{"rating":4.8,"amount":57,"subtitle":"(57)"}'
  const p = productoDesdeHtml(html)
  assert.deepEqual([p.sku, p.name, p.price, p.regularPrice, p.availability, p.brand.name, p.aggregateRating.reviewCount], ['MLC4212659314', 'Set 8 Brochas', 4490, 5990, 'InStock', 'Genérica', 57])
  const zyte = { sku: 'MLC4212659314', name: 'Set 8  Brochas', price: '4490', regularPrice: '749', availability: 'InStock', brand: { name: 'genérica' },
    aggregateRating: { ratingValue: 4.8, reviewCount: 57 }, canonicalUrl: 'https://articulo.mercadolibre.cl/MLC-4212659314-set-_JM' }
  const c = compararProducto(zyte, p)
  assert.equal(c.titulo, 'igual', 'espacios y mayúsculas no son diferencia')
  assert.equal(c.precioAnterior, 'solo-html', 'la cuota de Zyte (749) no es precio anterior: el HTML sí trae el tachado')
  assert.equal(c.marca, 'igual')
  assert.equal(productoDesdeHtml('<html>cascarón</html>'), null)
})

test('productoDesdeHtml: sin JSON-LD (catálogo) usa el título social, el precio meta y el sku de la URL', async () => {
  const { productoDesdeHtml } = await import('../src/services/detalleMl.js')
  const html = '<link rel="canonical" href="https://www.mercadolibre.cl/partidor-bateria/p/MLC72722591"/>' +
    '<meta property="og:title" content="Partidor Bateria Auto Portatil 300a - $ 30.295"><meta itemprop="price" content="30295">' +
    '"reviews":{"rating":4.6,"amount":88,"subtitle":"(88)"} (+10 disponibles)'
  const p = productoDesdeHtml(html)
  assert.deepEqual([p.name, p.price, p.sku, p.availability, p.aggregateRating.reviewCount], ['Partidor Bateria Auto Portatil 300a', 30295, 'MLC72722591', 'InStock', 88])
})
