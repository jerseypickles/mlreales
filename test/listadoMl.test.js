import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  urlListado,
  cuerpoListado,
  urlImagen,
  extraerPolycards,
  extraerPrintedResult,
  posicionReal,
  itemsDesdeHtml,
} from '../src/services/listadoMl.js'
import { normalizarScan } from '../src/services/normalizador.js'

// Recorte REAL del listado "depiladora laser" servido por Zyte el 29-ago-2026:
// tres tarjetas (catálogo con descuento, anuncio, y publicación suelta sin id de
// catálogo) más sus filas de `printed_result`.
const HTML = fs.readFileSync(new URL('./fixtures/listadoZyte.html', import.meta.url), 'utf8')

test('el scroll no es opcional: sin actions ML entrega la página recortada', () => {
  const c = cuerpoListado('depiladora laser')
  assert.equal(c.browserHtml, true)
  assert.ok(c.actions.some((a) => a.action === 'scrollBottom'))
  // la doc de Zyte dice `duration`; la API exige `timeout`
  for (const a of c.actions.filter((x) => x.action === 'waitForTimeout')) {
    assert.ok(Number.isFinite(a.timeout), 'la espera va en `timeout`, no en `duration`')
  }
  // no se pide productList: el parseo es nuestro y así no se paga extracción
  assert.equal(c.productList, undefined)
})

test('la keyword se convierte en la URL de listado del país', () => {
  assert.equal(urlListado('depiladora laser'), 'https://listado.mercadolibre.cl/depiladora-laser')
  assert.equal(urlListado('foco solares', 'MX'), 'https://listado.mercadolibre.com.mx/foco-solares')
  assert.throws(() => urlListado('x', 'ZZ'), /sin URL de listado/)
})

test('las tarjetas se deduplican: ML repite la misma en varios carruseles', () => {
  const cards = extraerPolycards(HTML)
  const ids = cards.map((c) => c.metadata.id)
  assert.equal(ids.length, new Set(ids).size)
  assert.ok(cards.length >= 3)
})

test('printed_result se indexa por item y la fila orgánica gana a la del anuncio', () => {
  const t = extraerPrintedResult(HTML)
  // MLC1749192945 aparece dos veces en el listado real: posición 0 como PAD y 4
  // como ORGANIC. La orgánica es la que representa su lugar en el ranking.
  const philips = t.get('MLC1749192945')
  assert.equal(philips.fila.type, 'ORGANIC')
  assert.equal(philips.fila.sold_quantity, 500)
  assert.equal(philips.tieneOrganico, true)
  assert.equal(philips.tienePad, true)
})

// Medido: 10 de 60 filas son el mismo item apareciendo arriba como PAD y más
// abajo como ORGANIC. Son los vendedores fuertes —rankean Y además pagan—.
// Marcarlos como "anuncio" y sacarlos del análisis borraría competencia real.
test('el que paga Y rankea no es un anuncio: es un competidor', () => {
  const items = itemsDesdeHtml(HTML, { keyword: 'k' })
  const philips = items.find((i) => i.itemId === 'MLC1749192945')
  assert.equal(philips.esAnuncio, false, 'aparece como PAD pero también orgánico')
})

// `item_position` viene en -1 en las tarjetas pagadas. Tomarlo tal cual ordena
// los anuncios ANTES de la posición 1, que es justo la contaminación a evitar.
// normalizarScan asigna la posición con el ÍNDICE DEL ARRAY e ignora
// itemPosition. Como ML entrega los anuncios primero, el orden crudo escribía
// un ranking con las primeras posiciones compradas.
test('los items salen ordenados por posición orgánica, con los anuncios al final', () => {
  const items = itemsDesdeHtml(HTML, { keyword: 'k' })
  const organicos = items.filter((i) => !i.esAnuncio)
  const posiciones = organicos.map((i) => i.itemPosition).filter(Number.isFinite)
  const ordenado = [...posiciones].sort((a, b) => a - b)
  assert.deepEqual(posiciones, ordenado, 'los orgánicos van en orden de ranking')
  const primerAnuncio = items.findIndex((i) => i.esAnuncio)
  if (primerAnuncio !== -1) {
    assert.ok(
      items.slice(primerAnuncio).every((i) => i.esAnuncio),
      'después del primer anuncio no vuelve a haber orgánicos',
    )
  }
})

test('la posición -1 del anuncio no se usa como posición', () => {
  assert.equal(posicionReal({ item_position: '-1' }, { type: 'ORGANIC', position: 4 }), 4)
  assert.equal(posicionReal({ item_position: '-1' }, { type: 'PAD', position: 0 }), null)
  assert.equal(posicionReal({ item_position: '2' }, null), 2)
  const items = itemsDesdeHtml(HTML, { keyword: 'k' })
  for (const i of items) {
    assert.ok(i.itemPosition === null || i.itemPosition > 0, `posición inválida: ${i.itemPosition}`)
  }
})

test('ML publica el id de la foto, no su URL', () => {
  assert.equal(
    urlImagen('639292-MLA92294746932_092025'),
    'https://http2.mlstatic.com/D_NQ_NP_639292-MLA92294746932_092025-O.webp',
  )
  assert.equal(urlImagen(''), null)
  assert.equal(urlImagen(undefined), null)
})

// El precio vigente y el anterior vienen en campos SEPARADOS del componente
// `price`. Es la diferencia con la extracción por IA, que en la ficha devolvía
// el tachado como vigente, y con `regularPrice`, que suele ser la cuota.
test('precio vigente y anterior salen separados y el descuento cuadra', () => {
  const items = itemsDesdeHtml(HTML, { keyword: 'depiladora laser' })
  const philips = items.find((i) => i.catalogId === 'MLC25818307')
  assert.equal(philips.nuevoPrecio, 259990)
  assert.equal(philips.precioAnterior, 331990)
  assert.match(philips.installments, /cuotas/)
})

test('emite los nombres de karamelo: normalizarScan no distingue el proveedor', () => {
  const items = itemsDesdeHtml(HTML, { keyword: 'depiladora laser' })
  const r = normalizarScan(items, { fecha: new Date(), keyword: 'depiladora laser' })
  assert.equal(r.descartados, 0)
  assert.equal(r.items.length, items.length)
  const p = r.items.find((x) => x.producto.sku === 'MLC25818307')
  assert.equal(p.producto.vendedor, 'PHILIPS')
  assert.equal(p.producto.esTiendaOficial, true)
  assert.equal(p.producto.esFull, true)
  assert.equal(p.snapshot.precio, 259990)
  assert.equal(p.snapshot.precioAnterior, 331990)
})

// La serie histórica está indexada por el id de CATÁLOGO que va en la URL, no
// por el id del item. Emitir `metadata.id` como SKU rompería todas las series.
test('el sku sale de la URL, como con karamelo', () => {
  const items = itemsDesdeHtml(HTML, { keyword: 'depiladora laser' })
  const philips = items.find((i) => i.catalogId === 'MLC25818307')
  assert.equal(philips.SKU, '', 'el SKU va vacío a propósito: lo deriva extraerSku')
  assert.match(philips.zProductoLink, /\/p\/MLC25818307$/)
  assert.notEqual(philips.itemId, 'MLC25818307') // el del item es otro
})

test('la publicación sin catálogo igual recibe URL para poder indexarla', () => {
  const items = itemsDesdeHtml(HTML, { keyword: 'depiladora laser' })
  const suelta = items.find((i) => !i.catalogId && !i.userProductId)
  assert.ok(suelta, 'el fixture trae una publicación suelta')
  assert.match(suelta.zProductoLink, /articulo\.mercadolibre\.cl\/MLC-\d+-_JM$/)
  const r = normalizarScan([suelta], { fecha: new Date(), keyword: 'k' })
  assert.equal(r.items.length, 1)
  assert.ok(r.items[0].producto.sku)
})

// Tres campos que ningún actor entregaba. `cantidadVendida` ya tenía camino en
// el normalizador —`raw.cantidadVendida`— esperando un dato que karamelo nunca
// mandó: en test/fixtures/nivel1.json ni siquiera existe el campo.
test('llegan vendidos, anuncio e id de catálogo, que karamelo no daba', () => {
  const items = itemsDesdeHtml(HTML, { keyword: 'depiladora laser' })
  const philips = items.find((i) => i.itemId === 'MLC1749192945')
  assert.equal(philips.cantidadVendida, 500)
  assert.equal(philips.catalogId, 'MLC45472609')
  assert.ok(items.some((i) => i.esAnuncio), 'el listado trae anuncios marcados')
  const r = normalizarScan(items, { fecha: new Date(), keyword: 'k' })
  assert.equal(r.items.find((x) => x.producto.sku === 'MLC45472609').snapshot.vendidos, 500)
})

// ML nunca publica el conteo de reseñas en el listado, y karamelo tampoco lo
// traía. Se deja explícito para que nadie lo busque de nuevo.
test('el conteo de reseñas no viene del listado: llega la nota, no el conteo', () => {
  const items = itemsDesdeHtml(HTML, { keyword: 'depiladora laser' })
  const conNota = items.filter((i) => i.produtoReviews)
  assert.ok(conNota.length, 'la nota sí viene')
  for (const i of items) assert.equal(i.numeroEvaluaciones, '')
})
