import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { unidadesDeTitulo, fotoChica, ordenarCandidatos, resumenIguales, sugerenciasDeTanda, claveDePropio, vistaIguales, marcarIgual, marcarLote, fijarUnidadesPropias, sugerirIguales, medidasDeTitulo, textoMedida, compararMedida, relacionSugerida, puntajeParecido, parecidoEnPalabras, referenciaParecidos, nivelDePrecio, escalonesDePrecio, plataDelEscalon, posicionDeVista, posicionesDePrecio } from '../src/services/iguales.js'
import { IgualPropio } from '../src/models/IgualPropio.js'
import { ProductoPropio } from '../src/models/ProductoPropio.js'
import { Producto } from '../src/models/Producto.js'
import { Snapshot } from '../src/models/Snapshot.js'
import { Nicho } from '../src/models/Nicho.js'
import { GastoMensual } from '../src/services/gastos.js'

test('iguales: las unidades de un pack se leen del título; piezas, watts, medidas y colores no son unidades', () => {
  const casos = [
    ['Pack X2 Lampara De Mesa 200w Led Con Sensor', 2],
    ['2 Unid Lampara De Mesa Negra Led', 2],
    ['Lampara De Mesa 2 Unidade 300w Con Soporte+mando', 2],
    ['Lampara Led De Mesa 4 Unidades Con Sensor', 4],
    ['Pack de 3 Lamparas LED de Mesa', 3],
    ['Lampara De Mesa Led 800w Con Sensor Y Control 2u Negro', 2],
    ['Pack 2 Lampara De Mesa Led Con Sensor 160 Led', 2],
    ['60 Toallas Desechables Para Cocina 90x60 Cm', 60],
    ['Set Pinceles De Pintura 34 Piezas Con Estuche', 1],
    ['Lampara De Mesa Led 300w Control Remoto Ip67', 1],
    ['Cable De Extension Para Jardin 15 M Con Enchufe', 1],
    ['3 Colores Luz Lampara Led Regulable', 1],
    ['Caja Plastica 12x18x32 Cm Con 2 Cajones', 1],
    [null, 1],
  ]
  for (const [titulo, n] of casos) assert.equal(unidadesDeTitulo(titulo), n, String(titulo))
})

test('iguales: la foto se pide en su variante chica y lo sugerido por la foto va primero', () => {
  assert.equal(fotoChica('https://http2.mlstatic.com/D_NQ_NP_643950-MLA1187_102026-O.webp'), 'https://http2.mlstatic.com/D_NQ_NP_643950-MLA1187_102026-V.webp')
  assert.equal(fotoChica('https://x/y-O.jpg'), 'https://x/y-V.jpg')
  const orden = ordenarCandidatos([
    { sku: 'a', posicion: 1 }, { sku: 'b', posicion: 9, sugerencia: { relacion: 'parecido' } },
    { sku: 'c', posicion: 30, sugerencia: { relacion: 'igual' } }, { sku: 'd', posicion: 2, sugerencia: { relacion: 'distinto' } }, { sku: 'e', posicion: 3 },
    // la medida ordena dentro de lo que la foto dice que es el mismo, y sube lo que calza por medida aunque nadie lo haya mirado
    { sku: 'f', posicion: 40, sugerencia: { relacion: 'igual' }, medida: { estado: 'igual' } }, { sku: 'g', posicion: 5, sugerencia: { relacion: 'igual' }, medida: { estado: 'distinta' } },
    { sku: 'h', posicion: 50, sugerencia: { relacion: 'otra-medida' } }, { sku: 'i', posicion: 60, medida: { estado: 'igual' } },
  ]).map((x) => x.sku)
  assert.deepEqual(orden, ['f', 'c', 'g', 'h', 'i', 'b', 'a', 'e', 'd'])
})

test('iguales: la medida se lee del título y solo se compara directo lo que tiene la misma', () => {
  const casos = [
    ['60 Toallas Desechables Para Cocina 90x60 Cm', { dimensiones: [60, 90] }, '90×60 cm'],
    ['Toallas 60 x 90cm Pack 100', { dimensiones: [60, 90] }, '90×60 cm'],
    ['Cable De Extension Para Jardin 15 M Con Enchufe', { largoM: 15 }, '15 m'],
    ['Lampara De Mesa 300w Led', { watts: 300 }, '300 w'],
    ['Set Pinceles De Pintura 34 Piezas', { piezas: 34 }, '34 piezas'],
    ['Jabon Liquido 1,5 Litros', { ml: 1500 }, '1,5 L'],
    ['Oferta 2x1 En Lamparas', {}, null],
    ['Polera Talla M', {}, null],
  ]
  for (const [titulo, medidas, texto] of casos) {
    assert.deepEqual(medidasDeTitulo(titulo), medidas, titulo)
    assert.equal(textoMedida(medidasDeTitulo(titulo)), texto, titulo)
  }
  const mia = medidasDeTitulo('60 Toallas Desechables 90x60 Cm')
  // el mismo tamaño escrito al revés es igual; uno más chico es otra medida y dice cuántas veces cabe en la propia
  assert.deepEqual(compararMedida(mia, medidasDeTitulo('Toallas 60x90')), { estado: 'igual', texto: '90×60 cm', factor: 1 })
  assert.deepEqual(compararMedida(mia, medidasDeTitulo('100 Toallas 60x60 Cm')), { estado: 'distinta', texto: '60×60 cm', factor: 1.5 })
  assert.equal(compararMedida(mia, medidasDeTitulo('Toallas Grandes Xl')).estado, 'sin-dato')
  // la foto dice si es el mismo producto; el tamaño lo decide el título cuando lo trae
  assert.deepEqual([relacionSugerida('otra-medida', 'igual'), relacionSugerida('igual', 'distinta'), relacionSugerida('igual', 'sin-dato'), relacionSugerida('parecido', 'igual'), relacionSugerida('distinto', 'igual')], ['igual', 'otra-medida', 'igual', 'parecido', 'distinto'])
  // y «el mismo producto» exige parecerse casi del todo: con puntaje bajo queda como parecido, diga lo que diga la relación
  assert.deepEqual([relacionSugerida('otra-medida', 'sin-dato', 68), relacionSugerida('igual', 'igual', 80), relacionSugerida('igual', 'igual', 92), relacionSugerida('otra-medida', 'distinta', 90)], ['parecido', 'parecido', 'igual', 'otra-medida'])
  // el largo y la potencia no se escalan: el doble de metros no cuesta el doble
  assert.deepEqual(compararMedida(medidasDeTitulo('Cable 15 M'), medidasDeTitulo('Cable 30 Metros')), { estado: 'distinta', texto: '30 m', factor: null })
})

test('iguales: el resumen dice en palabras dónde queda el precio propio por unidad', () => {
  const iguales = [{ sku: 'a', precio: 18000, unidades: 2, precioUnidad: 9000 }, { sku: 'b', precio: 12000, unidades: 1, precioUnidad: 12000 }, { sku: 'c', precio: 20000, unidades: 1, precioUnidad: 20000 }]
  const r = resumenIguales(16000, iguales)
  assert.deepEqual([r.confirmados, r.masBaratos, r.lugar, r.de, r.brechaPct, r.medianaUnidad, r.masBarato.sku], [3, 2, 3, 4, 44, 12000, 'a'])
  assert.equal(r.frase, 'De 3 que venden lo mismo, 2 cobran menos que tú por unidad. El más barato cobra $9.000, un 44% menos.')
  assert.equal(resumenIguales(8000, iguales).frase, 'De 3 que venden lo mismo, ninguno cobra menos que tú por unidad.')
  assert.equal(resumenIguales(16000, [iguales[0]]).frase, 'De 1 que vende lo mismo, cobra menos que tú por unidad. El más barato cobra $9.000, un 44% menos.')
  assert.equal(resumenIguales(16000, []).frase, 'Todavía no marcas a nadie que venda lo mismo.')
  // «caro» es que más de la mitad cobre menos: sale de contar
  assert.deepEqual([r.nivel, resumenIguales(8000, iguales).nivel, resumenIguales(16000, []).nivel], ['mitad-cara', 'ninguno-mas-barato', undefined])
  assert.deepEqual([nivelDePrecio(0, 5), nivelDePrecio(2, 5), nivelDePrecio(3, 5), nivelDePrecio(5, 5), nivelDePrecio(1, 2), nivelDePrecio(1, 1)],
    ['ninguno-mas-barato', 'mitad-barata', 'mitad-cara', 'todos-mas-baratos', 'mitad-barata', 'todos-mas-baratos'])
})

test('iguales: los escalones de descuento son los precios que cambian de lugar, del descuento más chico al más grande', () => {
  const rivales = (...ps) => ps.map((precioUnidad) => ({ precioUnidad }))
  const ver = (precio, unidades, xs) => escalonesDePrecio(precio, unidades, xs).map((e) => [e.meta, e.precio, e.lugar, e.de, e.descuentoPct])
  // con seis: quedar en la mitad, entre los tres más baratos e igualar al más barato
  const seis = rivales(9000, 10000, 11000, 12000, 13000, 14000)
  assert.deepEqual(ver(16000, 1, seis), [['mediana', 11500, 4, 7, 28], ['tres-mas-baratos', 11000, 3, 7, 31], ['mas-barato', 9000, 1, 7, 44]])
  // solo lo que está bajo el precio de hoy: en la mitad ya se está
  assert.deepEqual(ver(11200, 1, seis), [['tres-mas-baratos', 11000, 3, 7, 2], ['mas-barato', 9000, 1, 7, 20]])
  assert.deepEqual(ver(8000, 1, seis), [])
  // con cuatro, la mitad y los tres más baratos son el mismo lugar: queda el precio más alto que lo consigue
  assert.deepEqual(ver(16000, 1, rivales(9000, 10000, 11000, 12000)), [['tres-mas-baratos', 11000, 3, 5, 31], ['mas-barato', 9000, 1, 5, 44]])
  // con cinco piden el mismo precio: un solo escalón, con el nombre de la meta más exigente
  assert.deepEqual(ver(16000, 1, rivales(9000, 10000, 11000, 12000, 13000)), [['tres-mas-baratos', 11000, 3, 6, 31], ['mas-barato', 9000, 1, 6, 44]])
  assert.deepEqual(ver(16000, 1, rivales(9000)), [['mas-barato', 9000, 1, 2, 44]])
  // un pack propio: la meta es por unidad y el precio que se propone es el del pack, redondeado hacia abajo a la decena
  const pack = escalonesDePrecio(24000, 12, rivales(1249, 1500, 2500, 2600))
  assert.deepEqual(pack.map((e) => [e.meta, e.precio, e.precioUnidad, e.lugar, e.de, e.rebaja, e.descuentoPct]), [['mas-barato', 14980, 1248, 1, 5, 9020, 38]])
  assert.deepEqual(escalonesDePrecio(null, 1, seis), [])

  // lo que cambia por venta en un escalón
  const hoy = { queda: 4000, quedaSinCosto: 9000 }
  assert.deepEqual(plataDelEscalon(hoy, { queda: 2500, quedaSinCosto: 7500 }, true), { queda: 2500, quedaSinCosto: 7500, diferencia: -1500, veces: 1.6, pierde: false })
  assert.deepEqual(plataDelEscalon(hoy, { queda: -300, quedaSinCosto: 4700 }, true), { queda: -300, quedaSinCosto: 4700, diferencia: -4300, veces: null, pierde: true })
  // bajo el precio del envío gratis obligatorio, un precio menor puede dejar más por venta
  assert.deepEqual(plataDelEscalon(hoy, { queda: 4600, quedaSinCosto: 9600 }, true), { queda: 4600, quedaSinCosto: 9600, diferencia: 600, veces: 0.9, pierde: false })
  // sin el costo cargado no se dice cuántas veces ni si pierde: lo que queda todavía tiene que pagar el producto
  assert.deepEqual(plataDelEscalon({ queda: null, quedaSinCosto: 9000 }, { queda: null, quedaSinCosto: 7500 }, false), { queda: null, quedaSinCosto: 7500, diferencia: -1500, veces: null, pierde: null })
  assert.deepEqual(plataDelEscalon(hoy, null, true), { queda: null, quedaSinCosto: null, diferencia: null, veces: null, pierde: null })
})

test('iguales: el precio propio contra los que venden lo mismo, en una línea y diciendo con qué se compara', () => {
  const propio = { precio: 16000, unidades: 1, precioUnidad: 16000, medida: '300 w' }
  const iguales = [{ sku: 'a', precio: 18000, unidades: 2, precioUnidad: 9000 }, { sku: 'b', precio: 12000, unidades: 1, precioUnidad: 12000 }, { sku: 'c', precio: 20000, unidades: 1, precioUnidad: 20000 }]
  const base = { estado: 'ok', keyword: 'lampara', scan: { dias: 2 }, propio, otraMedida: [], fotos: { revisadas: 3, sinRevisar: 0, parecenIgual: 0, parecenOtraMedida: 0 }, parecidos: null }
  const corto = (p) => p && [p.base, p.nivel, p.caro, p.n, p.masBaratos, p.lugar, p.de, p.masBaratoUnidad, p.medianaUnidad, p.brechaPct]

  // lo que el dueño confirmó manda
  const confirmados = posicionDeVista({ ...base, resumen: resumenIguales(16000, iguales), iguales, candidatos: [] })
  assert.deepEqual(corto(confirmados), ['confirmados', 'mitad-cara', true, 3, 2, 3, 4, 9000, 12000, 44])
  assert.deepEqual(confirmados.precios, [9000, 12000, 20000]) // lo que cobra cada uno por unidad, para dibujarlo
  assert.equal(confirmados.frase, 'De 3 que venden lo mismo, 2 cobran menos que tú por unidad. El más barato cobra $9.000, un 44% menos.')

  // sin nada confirmado, lo que propone la foto vale como indicio y lo dice
  const c = (sku, precioUnidad, relacion, parecido) => ({ sku, precioUnidad, sugerencia: { relacion, parecido } })
  const sinMarcar = { ...base, resumen: resumenIguales(16000, []), iguales: [] }
  const porFoto = posicionDeVista({ ...sinMarcar, candidatos: [c('a', 9000, 'igual'), c('b', 20000, 'igual'), c('x', 5000, 'parecido', 80), c('y', 4000, 'otra-medida')] })
  assert.deepEqual(corto(porFoto), ['por-foto', 'mitad-barata', false, 2, 1, 2, 3, 9000, 14500, 44])
  assert.deepEqual(porFoto.precios, [9000, 20000]) // solo lo que la foto propone como el mismo en la medida propia
  assert.equal(porFoto.frase, 'Por la foto, 2 publicaciones parecen tu mismo producto y 1 cobra menos que tú por unidad. La más barata cobra $9.000, un 44% menos. Falta que lo confirmes.')
  assert.equal(posicionDeVista({ ...sinMarcar, candidatos: [c('a', 9000, 'igual'), c('b', 12000, 'igual')] }).frase,
    'Por la foto, 2 publicaciones parecen tu mismo producto y todas cobran menos que tú por unidad. La más barata cobra $9.000, un 44% menos. Falta que lo confirmes.')
  assert.equal(posicionDeVista({ ...sinMarcar, candidatos: [c('b', 20000, 'igual')] }).frase, 'Por la foto, 1 publicación parece tu mismo producto y no cobra menos que tú por unidad. Falta que lo confirmes.')

  // nadie vende el mismo: lo más parecido es solo referencia y nunca marca «caro»
  const parecidas = [c('p', 11000, 'parecido', 74), c('q', 15000, 'parecido', 82), c('r', 13000, 'parecido', 82)]
  const unico = posicionDeVista({ ...sinMarcar, candidatos: parecidas, parecidos: referenciaParecidos(16000, parecidas), ningunaIgual: true })
  assert.deepEqual(corto(unico), ['parecidos', 'todos-mas-baratos', false, 3, 3, 4, 4, 11000, 13000, 31])
  assert.deepEqual(unico.precios, [11000, 13000, 15000])
  assert.equal(unico.frase, 'Por la foto, nadie vende tu mismo producto. De las 3 que más se le parecen, 3 cobran menos que tú por unidad; la mitad cobra menos de $13.000.')

  // sin lectura de fotos ni marcas no hay nada que decir
  assert.equal(posicionDeVista({ ...sinMarcar, candidatos: [{ sku: 'z', precioUnidad: 9000 }], fotos: { revisadas: 0, sinRevisar: 1 } }), null)
  assert.equal(posicionDeVista({ estado: 'sin-scan' }), null)
})

test('iguales: cuando ninguna es la misma, lo que más se parece va primero y sirve de referencia', () => {
  // el puntaje del modelo manda; una lectura sin puntaje vale lo que su relación
  assert.deepEqual([puntajeParecido('parecido', 78), puntajeParecido('igual', undefined), puntajeParecido('parecido', 250), puntajeParecido('distinto', undefined)], [78, 95, 60, null])
  assert.deepEqual([90, 78, 55, 20].map(parecidoEnPalabras), ['casi igual al tuyo', 'muy parecido al tuyo', 'algo parecido al tuyo', 'se parece poco al tuyo'])
  const c = (sku, parecido, precioUnidad, posicion) => ({ sku, posicion, precioUnidad, sugerencia: { relacion: 'parecido', parecido } })
  const candidatos = [c('a', 55, 9000, 1), c('b', 82, 15000, 40), c('c', 74, 11000, 12), c('d', 82, 13000, 3), { sku: 'e', posicion: 2, precioUnidad: 5000 }]
  // dentro de lo parecido, de más a menos parecido; a igual puntaje, por su puesto en la búsqueda
  assert.deepEqual(ordenarCandidatos(candidatos).map((x) => x.sku), ['d', 'b', 'c', 'a', 'e'])
  // la referencia mira solo lo muy parecido (70 o más), no todo lo que salió en la búsqueda
  assert.deepEqual(referenciaParecidos(14000, candidatos), { n: 3, desde: 70, masBaratoUnidad: 11000, medianaUnidad: 13000, masCaroUnidad: 15000, masBaratos: 2, precios: [11000, 13000, 15000] })
  assert.equal(referenciaParecidos(14000, [c('a', 55, 9000, 1)]), null)
})

test('iguales: lo que el modelo no nombra queda anotado como distinto, para no volver a mirarlo', () => {
  const s = sugerenciasDeTanda([{ sku: 'a' }, { sku: 'b' }, { sku: 'c' }], [{ n: 2, relacion: 'igual', parecido: 97, unidades: 2, motivo: 'misma forma' }, { n: 9, relacion: 'igual', unidades: 1, motivo: 'fuera de la tanda' }], { modelo: 'm' })
  assert.deepEqual(s.map((x) => [x.sku, x.sugerencia.relacion, x.sugerencia.unidades ?? null, x.sugerencia.parecido ?? null]), [['a', 'distinto', null, null], ['b', 'igual', 2, 97], ['c', 'distinto', null, null]])
})

test('iguales: el dueño marca por la foto y la vista compara el precio por unidad; vale para toda la familia', async () => {
  const mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  try {
    const nicho = await Nicho.create({ keyword: 'lampara de prueba' })
    const fecha = new Date('2026-11-04T19:31:00Z')
    const pub = (sku, titulo, precio, posicion) => ({ prod: { sku, titulo, url: `https://x/${sku}`, imagen: `https://x/${sku}-O.webp`, itemId: sku }, snap: { sku, fecha, precio, posicion, keyword: 'lampara de prueba', vendidos: 100 } })
    const pubs = [pub('MLC1', 'Pack X2 Lampara De Mesa 300w', 18000, 1), pub('MLC2', 'Lampara De Mesa 300w Plateada', 12000, 2), pub('MLC3', 'Guirnalda De Luces', 9000, 3), pub('MLC4', 'Pack X2 Lampara De Mesa 150w Tienda', 24000, 4), pub('MLC900', 'Mi Lampara De Mesa 300w Negra', 16000, 5)]
    await Producto.insertMany(pubs.map((x) => x.prod))
    await Snapshot.insertMany(pubs.map((x) => x.snap))
    const propio = (sku) => ({ sku, url: `https://x/${sku}`, titulo: 'Mi Lampara De Mesa 300w', imagen: 'https://x/mio-O.jpg', nichoId: nicho._id, familiaMl: { id: 'F1' }, mediciones: [{ fecha, precio: 16000 }] })
    const [negro, blanco] = await ProductoPropio.insertMany([propio('MLC900'), propio('MLC901')])
    assert.equal(claveDePropio(negro), 'familia:F1')
    const ver = async (p = negro) => vistaIguales(await ProductoPropio.findById(p._id).lean(), { conEconomia: false })

    // al principio todo está por revisar, y la publicación propia que sale en la búsqueda no es un rival
    assert.deepEqual(await posicionesDePrecio(), []) // sin lecturas ni marcas no hay nada que resumir
    let v = await ver()
    assert.deepEqual([v.estado, v.iguales.length, v.candidatos.map((c) => c.sku).join(), v.propio.precioUnidad], ['ok', 0, 'MLC1,MLC2,MLC3,MLC4', 16000])
    assert.equal(v.candidatos[0].unidades, 2) // el pack parte con las unidades de su título

    // marca dos como el mismo (el pack toma sus 2 unidades del título) y uno como distinto
    await marcarIgual(negro, { sku: 'MLC1', relacion: 'igual' })
    await marcarIgual(negro, { sku: 'MLC2', relacion: 'igual', unidades: 1 })
    await marcarIgual(negro, { sku: 'MLC3', relacion: 'distinto' })
    v = await ver()
    assert.deepEqual(v.iguales.map((x) => [x.sku, x.unidades, x.precioUnidad, x.diferenciaPct]), [['MLC1', 2, 9000, -44], ['MLC2', 1, 12000, -25]])
    assert.deepEqual([v.candidatos.map((c) => c.sku).join(), v.descartados.map((c) => c.sku).join()], ['MLC4', 'MLC3'])
    assert.equal(v.resumen.frase, 'De 2 que venden lo mismo, todos cobran menos que tú por unidad. El más barato cobra $9.000, un 44% menos.')
    assert.equal(v.iguales[0].historia.length, 1)
    // el otro color de la familia ve las mismas marcas
    assert.equal((await ver(blanco)).iguales.length, 2)
    // el resumen de todos los productos: los dos colores, con lo confirmado como base
    assert.deepEqual((await posicionesDePrecio()).map((x) => [x.itemId, x.base, x.nivel, x.caro, x.masBaratos, x.n, x.precioUnidad]),
      [['MLC900', 'confirmados', 'todos-mas-baratos', true, 2, 2, 16000], ['MLC901', 'confirmados', 'todos-mas-baratos', true, 2, 2, 16000]])
    // la economía trae lo que deja cada venta hoy y en cada escalón de precio
    const queda = async (_p, precio) => ({ precio, queda: precio - 10000, quedaSinCosto: precio - 6000 })
    const eco = (await vistaIguales(await ProductoPropio.findById(negro._id).lean(), { queda })).economia
    assert.deepEqual([eco.hoy.queda, eco.conCosto], [6000, false])
    assert.deepEqual(eco.escalones.map((e) => [e.meta, e.precio, e.lugar, e.de, e.queda, e.diferencia, e.veces, e.pierde]),
      [['mediana', 10500, 2, 3, 500, -5500, null, null], ['mas-barato', 9000, 1, 3, -1000, -7000, null, null]])

    // la publicación propia es un pack de 2: el precio por unidad baja a la mitad, en toda la familia
    await fijarUnidadesPropias(negro, 2)
    v = await ver(blanco)
    assert.deepEqual([v.propio.unidades, v.propio.precioUnidad, v.resumen.masBaratos], [2, 8000, 0])
    await fijarUnidadesPropias(negro, 1)

    // el mismo producto en otra medida va aparte: no entra al resumen y su precio se lleva a la medida propia
    await marcarIgual(negro, { sku: 'MLC4', relacion: 'otra-medida' })
    v = await ver()
    assert.deepEqual([v.propio.medida, v.iguales.length, v.otraMedida.map((x) => [x.sku, x.unidades, x.precioUnidad, x.medida.estado, x.medida.texto]).join()], ['300 w', 2, 'MLC4,2,12000,distinta,150 w'])
    assert.equal(v.iguales.find((x) => x.sku === 'MLC1').medida.estado, 'igual')
    assert.equal(v.resumen.confirmados, 2)
    await marcarIgual(negro, { sku: 'MLC4', relacion: null })

    // quitar la marca la devuelve a lo que falta revisar; un sku raro se rechaza
    await marcarIgual(negro, { sku: 'MLC3', relacion: null })
    assert.equal((await ver()).candidatos.map((c) => c.sku).join(), 'MLC3,MLC4')
    await assert.rejects(marcarIgual(negro, { sku: 'x; drop', relacion: 'igual' }), /no válido/)

    // la lectura de fotos propone y no marca: lo sugerido queda arriba y lo que ya se miró no se vuelve a mandar
    let vistas = 0
    const pedir = async ({ user }) => { vistas = user.filter((b) => b.type === 'image').length; return { datos: { coincidencias: [{ n: 2, relacion: 'igual', unidades: 1, motivo: 'misma forma' }] }, costoUsd: 0.02, modelo: 'prueba' } }
    const bajarFoto = async (url) => ({ type: 'image', source: { type: 'base64', media_type: 'image/webp', data: Buffer.from(url).toString('base64') } })
    const r = await sugerirIguales(await ProductoPropio.findById(negro._id).lean(), { pedir, bajarFoto })
    assert.deepEqual([r.revisadas, r.parecen, r.costoUsd, vistas], [2, 1, 0.02, 3]) // la foto propia + las dos pendientes
    v = await ver()
    assert.deepEqual(v.candidatos.map((c) => [c.sku, c.sugerencia.relacion]), [['MLC4', 'otra-medida'], ['MLC3', 'distinto']])
    assert.equal(v.iguales.length, 2) // nada se marcó solo
    // la foto dijo «igual» de MLC4, pero su título dice 150w y el propio es de 300w: se propone como otra medida
    assert.deepEqual([v.fotos.parecenIgual, v.fotos.parecenOtraMedida], [0, 1])
    // confirmar el grupo de una vez marca solo lo que la lectura propone con esa relación
    assert.equal(await marcarLote(negro, 'igual'), 0)
    assert.equal(await marcarLote(negro, 'otra-medida'), 1)
    v = await ver()
    assert.deepEqual([v.otraMedida.map((x) => x.sku).join(), v.candidatos.map((c) => c.sku).join()], ['MLC4', 'MLC3'])
    await assert.rejects(marcarLote(negro, 'distinto'), /lote/)
    assert.equal((await GastoMensual.findOne({}).lean())?.usd, 0.02) // el gasto de la lectura queda anotado
    assert.equal((await sugerirIguales(await ProductoPropio.findById(negro._id).lean(), { pedir, bajarFoto })).revisadas, 0)
    assert.equal(await IgualPropio.countDocuments({ clave: 'familia:F1' }), 4)
  } finally {
    await mongoose.disconnect()
    await mongod.stop()
  }
})
