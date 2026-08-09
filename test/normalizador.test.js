import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parsearPrecio,
  parsearEnvio,
  detectarTipoListing,
  extraerSku,
  parsearResultadosTotales,
  calcularDescuentoPct,
  normalizarItemBusqueda,
  normalizarScan,
} from '../src/services/normalizador.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/nivel1.json', import.meta.url), 'utf8'))

test('parsearPrecio: entero plano', () => {
  assert.equal(parsearPrecio('15990'), 15990)
})

test('parsearPrecio: coma decimal', () => {
  assert.equal(parsearPrecio('9747,93'), 9747.93)
})

test('parsearPrecio: punto de miles', () => {
  assert.equal(parsearPrecio('9.999'), 9999)
  assert.equal(parsearPrecio('12.990'), 12990)
  assert.equal(parsearPrecio('1.234.567'), 1234567)
})

test('parsearPrecio: coma de miles', () => {
  assert.equal(parsearPrecio('15,990'), 15990)
})

test('parsearPrecio: punto decimal y rating', () => {
  assert.equal(parsearPrecio('9747.93'), 9747.93)
  assert.equal(parsearPrecio('4.6'), 4.6)
})

test('parsearPrecio: mixto miles y decimal', () => {
  assert.equal(parsearPrecio('1.234,56'), 1234.56)
  assert.equal(parsearPrecio('1,234.56'), 1234.56)
})

test('parsearPrecio: vacíos e inválidos', () => {
  assert.equal(parsearPrecio(''), null)
  assert.equal(parsearPrecio(null), null)
  assert.equal(parsearPrecio(undefined), null)
  assert.equal(parsearPrecio('sin precio'), null)
  assert.equal(parsearPrecio(12990), 12990)
})

test('parsearEnvio: full + same day', () => {
  const envio = parsearEnvio('{same_day_free_shipping} {full_icon}')
  assert.equal(envio.esFull, true)
  assert.equal(envio.envioRapido, true)
  assert.equal(envio.envioGratis, true)
})

test('parsearEnvio: solo envío gratis', () => {
  const envio = parsearEnvio('{free_shipping}')
  assert.equal(envio.esFull, false)
  assert.equal(envio.envioRapido, false)
  assert.equal(envio.envioGratis, true)
})

test('parsearEnvio: lee el envío en TEXTO NATURAL (formato real del actor)', () => {
  // crudo verificado 9-ago: el actor entrega "Llega gratis mañana Enviado por FULL"
  const conFull = parsearEnvio('Llega gratis mañana Enviado por FULL')
  assert.equal(conFull.esFull, true)
  assert.equal(conFull.envioGratis, true)
  assert.equal(conFull.envioRapido, true)
  const sinFull = parsearEnvio('Llega el lunes')
  assert.equal(sinFull.esFull, false) // el texto existe y NO dice Full: es medición, no ignorancia
  assert.equal(sinFull.envioGratis, false)
  assert.equal(parsearEnvio('Envío gratis').envioGratis, true)
})

test('parsearEnvio: sin flags legibles = DESCONOCIDO, no "sin Full"', () => {
  // el listado de ML no siempre pinta el ícono aunque el item sea Full
  // (caso Beauty Creations 6-ago): afirmar false envenena el %Full del nicho
  assert.equal(parsearEnvio('').esFull, null)
  assert.equal(parsearEnvio(undefined).esFull, null)
  assert.equal(parsearEnvio('').envioRapido, null)
  // con flags presentes sí se puede afirmar la ausencia del ícono Full
  assert.equal(parsearEnvio('{free_shipping}').esFull, false)
  assert.equal(parsearEnvio('{full_icon}').esFull, true)
})

test('detectarTipoListing', () => {
  assert.equal(detectarTipoListing('https://www.mercadolibre.cl/foco/p/MLC45499727'), 'catalogo')
  assert.equal(detectarTipoListing('https://www.mercadolibre.cl/foco/up/MLCU12345678'), 'listing')
  assert.equal(detectarTipoListing('https://articulo.mercadolibre.cl/MLC-1465789123-foco-_JM'), 'listing')
  assert.equal(detectarTipoListing(null), 'listing')
})

test('extraerSku: campo SKU directo', () => {
  assert.equal(extraerSku({ SKU: 'MLC45499727' }), 'MLC45499727')
})

test('extraerSku: desde URL de catálogo, listing suelto y articulo', () => {
  assert.equal(extraerSku({ SKU: '', zProductoLink: 'https://www.mercadolibre.cl/x/p/MLC45499727' }), 'MLC45499727')
  assert.equal(extraerSku({ SKU: '', zProductoLink: 'https://www.mercadolibre.cl/x/up/MLCU12345678' }), 'MLCU12345678')
  assert.equal(
    extraerSku({ SKU: '', zProductoLink: 'https://articulo.mercadolibre.cl/MLC-1465789123-foco-_JM' }),
    'MLC1465789123',
  )
})

test('extraerSku: sin SKU ni URL válida', () => {
  assert.equal(extraerSku({ SKU: '', zProductoLink: '' }), null)
})

test('parsearResultadosTotales', () => {
  assert.deepEqual(parsearResultadosTotales('+9.999 resultados'), { total: 9999, esMinimo: true })
  assert.deepEqual(parsearResultadosTotales('234 resultados'), { total: 234, esMinimo: false })
  assert.equal(parsearResultadosTotales(''), null)
})

test('calcularDescuentoPct', () => {
  assert.equal(calcularDescuentoPct(15990, 25990), 38.5)
  assert.equal(calcularDescuentoPct(15990, null), null)
  assert.equal(calcularDescuentoPct(15990, 15990), null)
  assert.equal(calcularDescuentoPct(15990, 10000), null)
})

test('normalizarItemBusqueda: item real del actor', () => {
  const fecha = new Date('2026-07-16T12:00:00Z')
  const { producto, snapshot } = normalizarItemBusqueda(fixture[0], { fecha, keyword: 'foco solares' })

  assert.equal(producto.sku, 'MLC45499727')
  assert.equal(producto.tipoListing, 'catalogo')
  assert.equal(producto.esFull, true)
  assert.equal(producto.envioRapido, true)
  assert.equal(producto.esTiendaOficial, true)
  assert.equal(producto.vendedor, 'EOLAND')
  assert.equal(producto.categoriaML, 'MLC174442')
  assert.equal(producto.domainML, 'MLC-FLOOD_LIGHTS')
  assert.equal(producto.sellerId, null)
  assert.equal(producto.imagen, 'https://http2.mlstatic.com/D_NQ_NP_899630-MLA99916451389_112025-O.webp')

  assert.equal(snapshot.precio, 15990)
  assert.equal(snapshot.precioAnterior, 25990)
  assert.equal(snapshot.descuentoPct, 38.5)
  assert.equal(snapshot.rating, 4.6)
  assert.equal(snapshot.numReviews, null)
  assert.equal(snapshot.posicion, 1)
  assert.equal(snapshot.keyword, 'foco solares')
  assert.equal(snapshot.fecha, fecha)
})

test('normalizarScan: dedup por SKU, descarta items sin SKU y parsea totales', () => {
  const fecha = new Date('2026-07-16T12:00:00Z')
  const { items, descartados, totalResultados } = normalizarScan(fixture, { fecha, keyword: 'foco solares' })

  assert.equal(items.length, 3)
  assert.equal(descartados, 1)
  assert.deepEqual(totalResultados, { total: 9999, esMinimo: true })

  const skus = items.map((i) => i.producto.sku).sort()
  assert.deepEqual(skus, ['MLC1465789123', 'MLC45499727', 'MLCU12345678'])

  // del duplicado (posiciones 1 y 7) queda la mejor posición
  const eoland = items.find((i) => i.producto.sku === 'MLC45499727')
  assert.equal(eoland.snapshot.posicion, 1)

  // precio con coma decimal normalizado
  const importadora = items.find((i) => i.producto.sku === 'MLCU12345678')
  assert.equal(importadora.snapshot.precio, 9747.93)
  assert.equal(importadora.producto.tipoListing, 'listing')
})

test('normalizarScan: la posición es global aunque itemPosition reinicie por página', () => {
  const fecha = new Date('2026-07-16T12:00:00Z')
  const paginas = [
    { SKU: 'MLC100000001', itemPosition: 1, nuevoPrecio: '1000' },
    { SKU: 'MLC100000002', itemPosition: 2, nuevoPrecio: '2000' },
    { SKU: 'MLC100000003', itemPosition: 1, nuevoPrecio: '3000' }, // página 2 reinicia
    { SKU: 'MLC100000004', itemPosition: 2, nuevoPrecio: '4000' },
  ]
  const { items } = normalizarScan(paginas, { fecha, keyword: 'x' })
  assert.deepEqual(
    items.map((i) => i.snapshot.posicion),
    [1, 2, 3, 4],
  )
})

test('extraerSkuDeUrl: saca el ID desde URLs de catálogo y de artículo', async () => {
  const { extraerSkuDeUrl } = await import('../src/services/propios.js')
  assert.equal(extraerSkuDeUrl('https://www.mercadolibre.cl/foo/p/MLC62124281'), 'MLC62124281')
  assert.equal(extraerSkuDeUrl('https://articulo.mercadolibre.cl/MLC-1234567890-panel-_JM'), 'MLC1234567890')
  assert.equal(extraerSkuDeUrl('https://google.com'), null)
})
