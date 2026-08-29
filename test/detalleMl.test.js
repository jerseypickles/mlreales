import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cuerpoPeticion,
  confiable,
  precioCoherente,
  precioAnteriorReal,
  vendedorDesdeHtml,
  aItemDetalle,
} from '../src/services/detalleMl.js'

// Respuestas REALES de Zyte medidas el 29-ago-2026 sobre el nicho depiladora
// laser. La degradada y la buena son la MISMA URL: la primera salió de un lote
// de 12 en paralelo, la segunda de pedirla sola.
const URL = 'https://www.mercadolibre.cl/maquina-depiladora-laser-recargable-profesional-skin-36w-ipl/up/MLCU3691501033'

const DEGRADADA = {
  product: {
    url: URL,
    name: 'Maquina Depiladora Laser Recargable Profesional Skin 36w Ipl',
    sku: 'MLCU3691501033',
    description: '...',
    metadata: { probability: 0.0, dateDownloaded: '2026-08-29T16:06:34Z' },
  },
  browserHtml: '',
}

const BUENA = {
  product: {
    url: URL,
    name: 'Maquina Depiladora Laser Recargable Profesional Skin 36w Ipl',
    sku: 'MLCU3691501033',
    price: '49990.0',
    regularPrice: null,
    availability: 'InStock',
    aggregateRating: { ratingValue: 4.5, reviewCount: 19 },
    metadata: { probability: 0.9717841744422913 },
  },
  browserHtml:
    '<script>{"melidata_event":{"path":"/pdp","event_data":{"seller_id":204808902,' +
    '"seller_name":"Philips","reputation_level":"5_green","power_seller_status":"platinum",' +
    '"official_store_id":97}}}</script>',
}

test('el navegador no es negociable: sin browserHtml la ficha pierde precio y rating', () => {
  const c = cuerpoPeticion(URL)
  assert.equal(c.productOptions.extractFrom, 'browserHtml')
  assert.equal(c.geolocation, 'CL')
})

// Medido sobre la misma ficha el 29-ago-2026:
//   sin espera    → html   11.983 chars, precio 331.990 (el TACHADO)
//   espera de 3 s → html 1.334.442 chars, precio 259.990 (el vigente)
// Las dos con probability > 0,99.
test('la espera no es opcional: sin ella ML pinta el precio tachado', () => {
  const c = cuerpoPeticion(URL)
  const espera = c.actions.find((a) => a.action === 'waitForTimeout')
  assert.ok(espera, 'la ficha necesita espera para renderizar el precio vigente')
  assert.ok(espera.timeout >= 3)
  assert.equal(c.browserHtml, true, 'el html crudo trae el bloque del vendedor')
  assert.equal(c.customAttributes, undefined, 'el LLM ya no hace falta: es la parte cara')
})

test('el vendedor sale del evento melidata, no de un LLM', () => {
  const v = vendedorDesdeHtml(BUENA.browserHtml)
  assert.equal(v.sellerId, '204808902')
  assert.equal(v.sellerName, 'Philips')
  assert.equal(v.sellerReputation, '5_green')
  assert.equal(v.sellerPowerStatus, 'platinum')
  assert.equal(vendedorDesdeHtml(''), null)
  assert.equal(vendedorDesdeHtml(undefined), null)
})

test('un HTTP 200 con probability 0 no es un dato: es el cascarón', () => {
  assert.equal(confiable(DEGRADADA), false)
  assert.equal(confiable(BUENA), true)
  // sin metadata tampoco se confía, en vez de asumir que vino bien
  assert.equal(confiable({ product: { name: 'x' } }), false)
})

test('la ficha buena entrega precio, reseñas y el bloque del vendedor', () => {
  const i = aItemDetalle(BUENA)
  assert.equal(i.price, 49_990)
  assert.equal(i.ratingCount, 19)
  assert.equal(i.rating, 4.5)
  assert.equal(i.sku, 'MLCU3691501033')
  assert.equal(i.sellerId, '204808902')
  assert.equal(i.sellerReputation, '5_green')
  assert.equal(i.sellerPowerStatus, 'platinum')
  // el Full lo dice el nivel 1; el nivel 2 no lo pisa
  assert.equal(i.isFull, null)
})

// El caso caro: la misma URL devolvió $36.990 tres veces y $14.352 una cuarta,
// esa con probability 0,997. `probability` no protege del valor equivocado; lo
// caza el precio que el LISTADO ya midió, que es otra página y otra petición.
test('un precio equivocado con probability alta lo caza el listado', () => {
  const enganosa = {
    product: { url: URL, price: '14352.0', metadata: { probability: 0.9968955516815186 } },
    browserHtml: '',
  }
  assert.equal(confiable(enganosa), true, 'probability sola la deja pasar')
  assert.equal(aItemDetalle(enganosa, { precioListado: 36_990 })._precioCoherente, false)
  // y una promoción real de 3% no se marca como error
  assert.equal(aItemDetalle(BUENA, { precioListado: 48_500 })._precioCoherente, true)
})

test('el precio vigente nunca supera al tachado', () => {
  assert.equal(precioCoherente(575_990, { precioAnterior: 429_990 }), false)
  assert.equal(precioCoherente(429_990, { precioAnterior: 575_990 }), true)
})

// El testigo anterior le preguntaba al LLM el precio "como se ve". Sobre la
// ficha Philips devolvió mostrado=$575.990 / tachado=$429.990 —invertidos— y
// marcó 4 de 12 fichas buenas. La extracción estructurada tenía razón.
test('sin nada con que comparar no se opina: null, no false', () => {
  assert.equal(precioCoherente(1000, {}), null)
  const solo = { product: { price: '1000', metadata: { probability: 0.9 } }, browserHtml: '' }
  assert.equal(aItemDetalle(solo)._precioCoherente, null)
})

// Medido el 29-ago-2026 sobre los 60 resultados de "depiladora laser": de las
// 50 fichas con regularPrice, 30 eran precio/6 o precio/12 —la cuota sin
// interés— y solo 20 un precio tachado real. Tomarlo crudo inventa un descuento
// del 83% en seis de cada diez publicaciones.
test('regularPrice de Zyte es la cuota más veces que el precio anterior', () => {
  // cuota de 6: descartada
  assert.equal(precioAnteriorReal(429_990, 71_665), null)
  // cuota de 12: descartada
  assert.equal(precioAnteriorReal(19_999, 1_667), null)
  // precio tachado real: se conserva
  assert.equal(precioAnteriorReal(429_990, 575_990), 575_990)
  assert.equal(precioAnteriorReal(429_990, null), null)
})

test('la ficha con cuota no reporta precio anterior inventado', () => {
  const conCuota = {
    product: { url: URL, price: '429990.0', regularPrice: '71665.0', metadata: { probability: 0.99 } },
    browserHtml: '',
  }
  assert.equal(aItemDetalle(conCuota).originalPrice, null)
})
