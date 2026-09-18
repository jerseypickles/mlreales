import test from 'node:test'
import assert from 'node:assert/strict'
import { horasHastaLaProxima, elegirParaSeguir, resumenDeSerie, esUrlDeCatalogo, seguidoFlojo } from '../src/services/seguimientoStock.js'

test('se lee más seguido donde más se ve: "+50" semanal, rangos diario, número exacto cada 12 h', () => {
  assert.equal(horasHastaLaProxima({ stock: 51, topado: true }), 168)
  assert.equal(horasHastaLaProxima({ stock: 26, topado: true }), 24)
  assert.equal(horasHastaLaProxima({ stock: 11, topado: true }), 24)
  assert.equal(horasHastaLaProxima({ stock: 6, topado: true }), 24)
  assert.equal(horasHastaLaProxima({ stock: 3, topado: false }), 12)
  assert.equal(horasHastaLaProxima({ stock: 0, topado: false }), 24)
  assert.equal(horasHastaLaProxima(null), 24)
})

test('se sigue al vendedor chico: ni tiendas oficiales, ni anuncios, ni "+50" sin Full; uno por vendedor', () => {
  const p = (o) => ({ url: 'https://x', esTiendaOficial: false, ...o })
  const elegidos = elegirParaSeguir([
    p({ sku: 'A', posicion: 1, vendedor: 'Grande', stockFuente: 'texto', stock: 51, stockTopado: true }),
    p({ sku: 'B', posicion: 2, vendedor: 'Oficial', esTiendaOficial: true }),
    p({ sku: 'C', posicion: 3, vendedor: 'SinLeer' }), // stock desconocido: entra, la lectura lo descubre
    p({ sku: 'D', posicion: 4, vendedor: 'SinLeer' }),
    p({ sku: 'E', posicion: 5, vendedor: 'Visible', stockFuente: 'texto', stock: 4, stockTopado: false }),
    p({ sku: 'G', posicion: 6, vendedor: 'Pagado', esAnuncio: true }),
  ], { max: 6 })
  // 'E' muestra 4 unidades exactas y durante un día pareció el mejor candidato.
  // Con los datos del 18-sep se dio vuelta: un stock de 1-5 sin Full es nominal
  // (el dropshipper lo deja fijo y no lo mueve nunca), así que vale menos que
  // 'C', del que todavía no se sabe nada y la primera lectura lo dirá.
  assert.deepEqual(elegidos.map((x) => x.sku), ['C', 'E'])
})

test('una serie de lecturas da el mínimo vendido, cuenta reposiciones y no suma lo que no se ve', () => {
  const l = (dia, stock, topado = false) => ({ fecha: new Date(`2026-09-${dia}T12:00:00Z`), stock, topado, fuente: 'texto' })
  // "+25" → "+10" → 4 → 1 → repone a "+25" → "+10"
  const r = resumenDeSerie([l('01', 26, true), l('03', 11, true), l('05', 4), l('06', 1), l('08', 26, true), l('10', 11, true), { fecha: new Date('2026-09-11'), ok: false }])
  // ≥1 (26→25) + ≥7 (11→4) + 3 exactas + repuso + ≥1
  assert.deepEqual([r.unidadesPiso, r.unidadesExactas, r.reposiciones, r.lecturas], [12, 3, 1, 6])
  assert.equal(r.porSemana, 9.3)
  assert.equal(resumenDeSerie([l('01', 51, true), l('08', 51, true)]).unidadesPiso, 0)
})

// El importador, 17-sep: "si detecta que está bajando el stock y después que
// aumentó, es porque están enviando a Full: ese producto es fuerte".
test('fuerza: vender y después reponer es un CICLO, con el mínimo que repuso', () => {
  const l = (dia, stock, topado = false) => ({ fecha: new Date(`2026-09-${dia}T12:00:00Z`), stock, topado, fuente: 'texto' })
  const r = resumenDeSerie([l('01', 26, true), l('03', 11, true), l('05', 4), l('06', 1), l('08', 26, true), l('10', 11, true)])
  // de "1 disponible" a "+25": metió al menos 25 unidades
  assert.deepEqual([r.fuerza, r.ciclos, r.reposiciones, r.unidadesRepuestasPiso, r.ajustes], ['ciclo', 1, 1, 25, 0])
  assert.equal(+new Date(r.ultimaReposicionEl), +new Date('2026-09-08T12:00:00Z'))
  // agotarse y volver también es un ciclo, aunque la baja previa no se haya visto
  assert.equal(resumenDeSerie([l('01', 0), l('03', 11, true)]).fuerza, 'ciclo')
  // subió sin baja visible: la venta ocurrió dentro de un rango. Repone, pero no es ciclo
  assert.equal(resumenDeSerie([l('01', 6, true), l('03', 26, true)]).fuerza, 'repone')
  assert.equal(resumenDeSerie([l('01', 26, true), l('03', 4)]).fuerza, 'vende')
  assert.equal(resumenDeSerie([l('01', 4), l('03', 4)]).fuerza, 'quieto')
  assert.equal(resumenDeSerie([l('01', 4)]).fuerza, null)
})

test('fuerza: una devolución que sube el stock 1-2 unidades NO es reponer', () => {
  const l = (dia, stock, topado = false) => ({ fecha: new Date(`2026-09-${dia}T12:00:00Z`), stock, topado, fuente: 'texto' })
  // de 2 a 3: una orden anulada devolvió la unidad
  const dev = resumenDeSerie([l('01', 3), l('02', 2), l('03', 3)])
  assert.deepEqual([dev.fuerza, dev.reposiciones, dev.ajustes, dev.ciclos], ['vende', 0, 1, 0])
  // parado en el borde de un rango: 26 → 25 → 26 se ve "+25" → "+10" → "+25"
  const borde = resumenDeSerie([l('01', 26, true), l('02', 11, true), l('03', 26, true)])
  assert.deepEqual([borde.fuerza, borde.reposiciones, borde.ajustes], ['vende', 0, 1])
  // pero si antes vendió de verdad (≥3), la misma subida chica SÍ cuenta
  const real = resumenDeSerie([l('01', 5), l('02', 1), l('03', 3)])
  assert.deepEqual([real.fuerza, real.ciclos, real.unidadesRepuestasPiso], ['ciclo', 1, 2])
})

// Medido en producción el 18-sep: las cinco primeras "reposiciones" eran páginas
// de catálogo, todas de menos a más y ninguna a menos. En /p/MLC… ML muestra al
// ganador de la caja de compra, y ese rota: cuando a uno se le acaba el stock, la
// caja pasa a otro que tiene de sobra, y eso se leía como "repuso".
test('catálogo: sin saber de quién es el stock, el tramo no se compara', () => {
  const l = (dia, stock, topado = false, sellerId = null) => ({ fecha: new Date(`2026-09-${dia}T12:00:00Z`), stock, topado, fuente: 'texto', sellerId })
  // 3 → "+25" en una página de catálogo, sin vendedor identificado: no dice nada
  const ciego = resumenDeSerie([l('17', 3), l('18', 26, true)], { esCatalogo: true })
  assert.deepEqual([ciego.fuerza, ciego.reposiciones, ciego.cambiosDeVendedor], [null, 0, 1])
  // el mismo cambio en la publicación propia del vendedor sí cuenta
  const propia = resumenDeSerie([l('17', 3), l('18', 26, true)], { esCatalogo: false })
  assert.deepEqual([propia.fuerza, propia.reposiciones], ['repone', 1])
  // en catálogo, con el MISMO vendedor en las dos lecturas, vuelve a contar
  const mismo = resumenDeSerie([l('17', 3, false, '204808902'), l('18', 26, true, '204808902')], { esCatalogo: true })
  assert.deepEqual([mismo.fuerza, mismo.reposiciones, mismo.cambiosDeVendedor], ['repone', 1, 0])
  // y si cambió el vendedor, no: aunque sea una publicación normal
  const otro = resumenDeSerie([l('17', 3, false, '204808902'), l('18', 26, true, '777')], { esCatalogo: false })
  assert.deepEqual([otro.fuerza, otro.reposiciones, otro.cambiosDeVendedor], [null, 0, 1])
})

test('catálogo: el cambio de vendedor corta la cadena, no la atraviesa', () => {
  const l = (dia, stock, topado, sellerId) => ({ fecha: new Date(`2026-09-${dia}T12:00:00Z`), stock, topado, fuente: 'texto', sellerId })
  // A vende 5→2; entra B con +50; B baja a 3. Son dos historias, no un ciclo.
  const r = resumenDeSerie([l('14', 5, false, 'A'), l('15', 2, false, 'A'), l('16', 51, true, 'B'), l('17', 3, false, 'B')], { esCatalogo: true })
  assert.equal(r.cambiosDeVendedor, 1)
  assert.equal(r.reposiciones, 0)
  assert.equal(r.fuerza, 'vende') // 3 de A + 48 de B, sin reposición inventada
})

test('se prefiere la publicación propia del vendedor antes que la página de catálogo', () => {
  const p = (o) => ({ esTiendaOficial: false, ...o })
  const elegidos = elegirParaSeguir([
    p({ sku: 'CAT', posicion: 1, vendedor: 'Uno', url: 'https://www.mercadolibre.cl/algo/p/MLC27221799', stockFuente: 'texto', stock: 3 }),
    p({ sku: 'OWN', posicion: 9, vendedor: 'Dos', url: 'https://articulo.mercadolibre.cl/MLC-123-algo' }),
  ], { max: 2 })
  assert.deepEqual(elegidos.map((x) => x.sku), ['OWN', 'CAT'])
  assert.equal(esUrlDeCatalogo('https://www.mercadolibre.cl/p/MLC14082874'), true)
  assert.equal(esUrlDeCatalogo('https://articulo.mercadolibre.cl/MLC-4212659314-set-8'), false)
})

// Medido el 18-sep contra producción: de 351 seguidos solo 13 (4%) eran Full con
// publicación propia, y la mitad de los medibles eran tiendas cross-border
// clavadas en 1-5 unidades. La regla elegía justo al revés.
test('se sigue a quien tiene bodega: Full antes que nadie, aunque esté en "+50"', () => {
  const p = (o) => ({ esTiendaOficial: false, url: 'https://articulo.mercadolibre.cl/MLC-1-x', ...o })
  const elegidos = elegirParaSeguir([
    p({ sku: 'DROP', posicion: 1, vendedor: 'Hongkong Store', stockFuente: 'texto', stock: 3, stockTopado: false }),
    p({ sku: 'FULL50', posicion: 30, vendedor: 'CASAESTILO1', esFull: true, stockFuente: 'texto', stock: 51, stockTopado: true }),
    p({ sku: 'FULLCAT', posicion: 2, vendedor: 'BAYGE', esFull: true, url: 'https://www.mercadolibre.cl/x/p/MLC999', stockFuente: 'texto', stock: 11, stockTopado: true }),
  ], { max: 3 })
  // Full con publicación propia primero, aunque venga en la posición 30 y en "+50":
  // su "+50" es bodega real y el día que caiga a "+25" son ≥25 unidades vendidas
  assert.deepEqual(elegidos.map((x) => x.sku), ['FULL50', 'FULLCAT', 'DROP'])
})

test('sin Full, un "+50" no se sigue: no se mueve y no hay bodega detrás', () => {
  const p = (o) => ({ esTiendaOficial: false, url: 'https://articulo.mercadolibre.cl/MLC-1-x', ...o })
  const elegidos = elegirParaSeguir([
    p({ sku: 'GRANDE', posicion: 1, vendedor: 'Uno', stockFuente: 'texto', stock: 51, stockTopado: true }),
    p({ sku: 'MEDIO', posicion: 8, vendedor: 'Dos', stockFuente: 'texto', stock: 26, stockTopado: true }),
  ], { max: 3 })
  assert.deepEqual(elegidos.map((x) => x.sku), ['MEDIO'])
  assert.equal(seguidoFlojo({ url: 'https://www.mercadolibre.cl/p/MLC1' }), true)
  assert.equal(seguidoFlojo({ url: 'https://articulo.mercadolibre.cl/MLC-1-x' }), false)
})
