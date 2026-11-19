import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { medidasDeTitulo, medidaPorLaPlata, sugerirIguales, marcarIgual, posicionesDePrecio } from '../src/services/iguales.js'
import { revisionDeCompra, propioDeCandidato, crearCandidato, cambiarCandidato, borrarCandidato, propioDe, vistaDe, fijarUnidades, candidatosDeNicho, claveDeCandidato } from '../src/services/revisionCompra.js'
import { AprendizajePublicidad } from '../src/services/ml/publicidad.js'
import { CandidatoCompra } from '../src/models/CandidatoCompra.js'
import { IgualPropio } from '../src/models/IgualPropio.js'
import { Producto } from '../src/models/Producto.js'
import { Snapshot } from '../src/models/Snapshot.js'
import { Nicho } from '../src/models/Nicho.js'

test('revisión de compra: las piezas de un set se leen aunque el título no diga «piezas»', () => {
  const casos = [
    ['Set 56 Pinceles Para Pintar Con Estuche', 56],
    ['Pinceles Profesionales Kit Con Paleta Set 56 Rosa', 56],
    ['Set Profesional De 40 Pinceles De Pintura Con Estuche', 40],
    ['Pinceles Profesionales Set 8 + Estuche Rosa', 8],
    ['Kit De 12 Destornilladores De Precision', 12],
    ['21pzs Pinceles De Pintura', 21],
    ['Set Pinceles De Pintura 34 Piezas Con Estuche', 34], // lo que dice «piezas» manda
    // lo que no son piezas: unidades de un pack, colores, medidas, tamaños de cama, y títulos que no son de un set
    ['Set 2 Unidades Lampara De Mesa', null], ['Kit 3 Colores Luz Led', null], ['Set De Ollas 5 Litros', null], ['Juego De Sabanas 2 Plazas', null],
    ['Set 20 Kg Mancuernas', null], ['Set Pincel Kabuki Mas Esponja', null], ['Lampara Con 4 Cabezales', null], ['40 Toallas Desechables', null],
  ]
  for (const [titulo, piezas] of casos) assert.equal(medidasDeTitulo(titulo).piezas ?? null, piezas, titulo)
})

test('revisión de compra: qué da la búsqueda por esa plata, en la medida del producto', () => {
  const pub = (sku, titulo, precioUnidad, vendidos = 0) => ({ sku, titulo, precioUnidad, vendidos })
  const scan = [
    pub('a', 'Lampara De Mesa 300w Negra', 9000, 500), pub('b', 'Lampara De Mesa 300w Blanca', 12000, 100),
    pub('c', 'Lampara De Mesa 500w Con Control', 14000, 1000), pub('d', 'Lampara De Mesa 800w', 16000, 50), pub('e', 'Lampara De Mesa 1000w', 25000),
    pub('f', 'Lampara De Mesa 100w', 17000, 25), pub('g', 'Lampara De Mesa Sin Potencia', 5000, 5000),
  ]
  const m = medidaPorLaPlata({ watts: 300 }, 16000, scan)
  assert.deepEqual([m.tipo, m.enTitulo, m.texto, m.conMedida], ['watts', 'los watts', '300 w', 6]) // la que no dice su potencia no entra
  // con la misma medida hay dos y las dos cobran menos
  assert.deepEqual(m.misma, { n: 2, masBaratos: 2, masBaratoUnidad: 9000, medianaUnidad: 10500 })
  // por la misma plata o menos, dos dan más medida (la de 1000w cuesta más: no cuenta); primero la que más vende
  assert.deepEqual([m.masPorMenos.n, m.masPorMenos.mayor, m.masPorMenos.ejemplos.map((x) => x.sku).join()], [2, '800 w', 'c,d'])
  assert.equal(m.menosPorMas, 1) // y una da menos medida por más plata
  assert.deepEqual(m.grupos.map((g) => [g.texto, g.n, g.medianaUnidad, g.vendidos, g.esLaMia]),
    [['100 w', 1, 17000, 25, false], ['300 w', 2, 10500, 600, true], ['500 w', 1, 14000, 1000, false], ['800 w', 1, 16000, 50, false], ['1000 w', 1, 25000, 0, false]])
  assert.equal(m.frase, 'Por $16.000 o menos, 2 publicaciones ofrecen más watts que 300 w (hasta 800 w). Con 300 w hay 2 y todas cobran menos; la mitad cobra menos de $10.500 por unidad.')

  // si nadie más tiene la medida propia, igual aparece en la lista, sin publicaciones
  const sola = medidaPorLaPlata({ watts: 400 }, 13000, scan)
  assert.deepEqual([sola.misma.n, sola.masPorMenos.n, sola.grupos.find((g) => g.esLaMia).n], [0, 0, 0])
  assert.equal(sola.frase, 'Por $13.000 o menos, ninguna publicación ofrece más watts que 400 w. Con 400 w no hay ninguna otra.')
  // sin precio pensado se dice solo quién tiene la misma medida; sin medida en el título propio no hay nada que comparar
  assert.equal(medidaPorLaPlata({ watts: 300 }, null, scan).frase, 'Con 300 w hay 2; la mitad cobra menos de $10.500 por unidad.')
  assert.equal(medidaPorLaPlata({}, 16000, scan), null)
  // la medida leída por la foto vale cuando el título no la trae; un tamaño solo se compara con otro de los mismos lados
  assert.equal(medidaPorLaPlata({ watts: 300 }, 16000, [{ sku: 'x', titulo: 'Lampara', precioUnidad: 9000, medidas: { watts: 600 } }]).masPorMenos.n, 1)
  assert.equal(medidaPorLaPlata({ dimensiones: [60, 90] }, 500, [pub('p', 'Toalla 60x60 Cm', 300), pub('q', 'Toalla 100x80 Cm', 450), pub('r', 'Caja 10x20x30 Cm', 100)]).masPorMenos.n, 1)
})

test('revisión de compra: la lectura dice cuántos venden este mismo producto, a cuánto y cuánto llevan vendido', () => {
  const cand = (sku, relacion, precioUnidad, vendidos, parecido = null) => ({ sku, precioUnidad, vendidos, sugerencia: relacion ? { relacion, parecido } : null })
  const vista = (extra) => ({ estado: 'ok', propio: { precioUnidad: 16000 }, iguales: [], otraMedida: [], candidatos: [], descartados: [], fotos: { revisadas: 0, sinRevisar: 0 }, ...extra })
  assert.equal(revisionDeCompra({ estado: 'sin-scan' }), null)

  // antes de mirar las fotos
  let r = revisionDeCompra(vista({ candidatos: [cand('a', null, 9000, 100), cand('b', null, 12000, 0)], fotos: { revisadas: 0, sinRevisar: 2 } }))
  assert.deepEqual([r.estado, r.total, r.frase], ['sin-leer', 2, 'Todavía no se miran las fotos de las 2 publicaciones de la búsqueda.'])

  // la foto propone dos iguales y el dueño ya confirmó otro: cuentan los tres, y lo marcado «no es» ya no cuenta
  r = revisionDeCompra(vista({ iguales: [{ sku: 'c', precioUnidad: 10000, vendidos: 1000, enUltimoScan: true }, { sku: 'viejo', precioUnidad: 5000, enUltimoScan: false }],
    candidatos: [cand('a', 'igual', 9000, 500), cand('b', 'igual', 18000, 0), cand('d', 'parecido', 7000, 50, 80), cand('e', 'distinto', 3000, 9)], descartados: [{ sku: 'z' }], fotos: { revisadas: 5, sinRevisar: 0 } }))
  assert.deepEqual([r.estado, r.total, r.mismos.n, r.mismos.confirmados, r.mismos.sinConfirmar, r.mismos.masBaratoUnidad, r.mismos.medianaUnidad, r.mismos.masCaroUnidad, r.mismos.vendidos, r.mismos.masBaratos],
    ['lo-venden', 6, 3, 1, 2, 9000, 10000, 18000, 1500, 2])
  assert.equal(r.frase, 'De las 6 publicaciones de la búsqueda, 3 venden este mismo producto, contando lo que la foto propone y falta confirmar. Cobran entre $9.000 y $18.000 por unidad y entre todas llevan al menos 1.500 vendidos. Al precio que piensas ($16.000 por unidad), 2 cobran menos.')

  // una sola, sin precio pensado y con fotos por mirar
  r = revisionDeCompra(vista({ propio: { precioUnidad: null }, candidatos: [cand('a', 'igual', 9000, 0), cand('b', null, 100, 0)], fotos: { revisadas: 1, sinRevisar: 1 } }))
  assert.equal(r.frase, 'De las 2 publicaciones de la búsqueda, 1 vende este mismo producto según la foto. Cobra $9.000 por unidad. Falta 1 foto por mirar.')

  // nadie vende el mismo: en otra medida, solo parecidos, o nada que se parezca
  r = revisionDeCompra(vista({ candidatos: [cand('a', 'otra-medida', 9000, 0)], fotos: { revisadas: 1, sinRevisar: 0 } }))
  assert.deepEqual([r.estado, r.frase], ['otra-medida', 'En la medida que escribiste nadie vende este mismo producto, pero 1 publicación lo vende en otra medida.'])
  r = revisionDeCompra(vista({ candidatos: [cand('a', 'parecido', 9000, 0, 80), cand('b', 'parecido', 14000, 0, 72), cand('c', 'parecido', 2000, 0, 40)], fotos: { revisadas: 3, sinRevisar: 0 } }))
  assert.deepEqual([r.estado, r.parecidos.n, r.frase], ['parecidos', 2, 'Por la foto, nadie vende este mismo producto en la búsqueda. Las 2 que más se le parecen cobran entre $9.000 y $14.000 por unidad. Todas cobran menos que el precio que piensas ($16.000 por unidad).'])
  r = revisionDeCompra(vista({ candidatos: [cand('a', 'distinto', 9000, 0)], fotos: { revisadas: 1, sinRevisar: 0 } }))
  assert.deepEqual([r.estado, r.frase], ['nada-parecido', 'Por la foto, nada de lo que sale en la búsqueda se parece de cerca a este producto: o es nuevo acá, o no es de esta búsqueda.'])
})

test('revisión de compra: un producto que todavía no se compra se revisa como uno propio, con su foto y su precio pensado', async () => {
  const mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  try {
    // lo medido en las ventas propias: de acá sale lo que quedaría por venta (antes de la primera lectura, que queda guardada)
    await AprendizajePublicidad.create({ dia: '2026-11-01', calculadoEl: new Date(), parametros: { ticket: { medido: { comisionPct: 10, publicidadPct: 20 }, curva: [{ precio: 1000, envio: 1000 }, { precio: 15000, envio: 2000 }], valles: [] } } })
    const nicho = await Nicho.create({ keyword: 'lampara de prueba' })
    const fecha = new Date('2026-11-04T19:31:00Z')
    const pub = (sku, titulo, precio, posicion, vendidos) => ({ prod: { sku, titulo, url: `https://x/${sku}`, imagen: `https://x/${sku}-O.webp`, itemId: sku }, snap: { sku, fecha, precio, posicion, keyword: 'lampara de prueba', vendidos } })
    const pubs = [pub('MLC1', 'Pack X2 Lampara De Mesa 300w', 18000, 1, 1000), pub('MLC2', 'Lampara De Mesa 300w Plateada', 12000, 2, 500), pub('MLC3', 'Lampara De Mesa 800w Con Control', 15000, 3, 100), pub('MLC4', 'Guirnalda De Luces', 9000, 4, 50)]
    await Producto.insertMany(pubs.map((x) => x.prod))
    await Snapshot.insertMany(pubs.map((x) => x.snap))
    const foto = `data:image/jpeg;base64,${Buffer.from('foto del proveedor').toString('base64')}`

    // lo que no se puede guardar
    await assert.rejects(crearCandidato({ nichoId: nicho._id, descripcion: 'Lampara de mesa 300w', foto: 'https://x/foto.jpg' }), /foto/)
    await assert.rejects(crearCandidato({ nichoId: nicho._id, descripcion: 'x', foto }), /qué producto es/)
    await assert.rejects(crearCandidato({ nichoId: new mongoose.Types.ObjectId(), descripcion: 'Lampara de mesa 300w', foto }), /nicho no encontrado/)
    await assert.rejects(crearCandidato({ nichoId: nicho._id, descripcion: 'Lampara de mesa 300w', foto, precioClp: -5 }), /precio/)

    const c = await crearCandidato({ nichoId: String(nicho._id), descripcion: '  Lampara de mesa   300w con sensor ', foto, precioClp: 16000 })
    assert.deepEqual([c.descripcion, c.precioClp, c.unidades, c.costoUnitarioClp, c.foto.tipo], ['Lampara de mesa 300w con sensor', 16000, 1, null, 'image/jpeg'])
    const propio = await propioDe(c._id)
    assert.deepEqual([propio.esCandidato, propio.sku, propio.titulo, propio.unidadesPack], [true, claveDeCandidato(c._id), 'Lampara de mesa 300w con sensor', 1])
    assert.equal(await propioDe('no-es-un-id'), null)

    // antes de mirar las fotos: todo por revisar, la medida sale de lo que se escribió y la foto vuelve como imagen
    let v = await vistaDe(propio)
    assert.deepEqual([v.estado, v.candidato.id, v.propio.medida, v.propio.precioUnidad, v.candidatos.length, v.revision.estado], ['ok', String(c._id), '300 w', 16000, 4, 'sin-leer'])
    assert.equal(v.propio.imagen, foto)
    // a su precio, la búsqueda da más watts por menos plata; con su misma medida hay dos y las dos cobran menos
    assert.deepEqual([v.porLaPlata.masPorMenos.n, v.porLaPlata.misma.n, v.porLaPlata.misma.masBaratos], [1, 2, 2])
    // lo que quedaría sale de lo medido: 16.000 menos 10% de comisión y el envío de su tramo; sin costo no se sabe la ganancia
    assert.deepEqual([v.economia.aproximada, v.economia.hoy.quedaSinCosto, v.economia.hoy.queda, v.economia.conCosto], [true, 12400, null, false])

    // la lectura de fotos usa la foto subida (no la baja) y propone; las marcas van con la clave del candidato
    let primera = null
    const pedir = async ({ user }) => { primera = user.find((b) => b.type === 'image'); return { datos: { coincidencias: [{ n: 1, relacion: 'igual', parecido: 96, unidades: 2, medida: '300 w', motivo: 'misma forma' }, { n: 2, relacion: 'igual', parecido: 95, unidades: 1, medida: '', motivo: 'misma forma' }, { n: 3, relacion: 'igual', parecido: 93, unidades: 1, medida: '800 w', motivo: 'mismo modelo, más potencia' }] }, costoUsd: 0.01, modelo: 'prueba' } }
    const bajadas = []
    const bajarFoto = async (url) => { bajadas.push(url); return { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'eA==' } } }
    const lectura = await sugerirIguales(propio, { pedir, bajarFoto })
    assert.deepEqual([lectura.revisadas, lectura.parecen, bajadas.length], [4, 3, 4])
    assert.deepEqual(primera.source, { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('foto del proveedor').toString('base64') })
    assert.equal(await IgualPropio.countDocuments({ clave: claveDeCandidato(c._id) }), 4)
    assert.deepEqual(await posicionesDePrecio(), []) // las marcas de un candidato no son de ninguna publicación propia

    v = await vistaDe(propio)
    assert.deepEqual([v.revision.estado, v.revision.mismos.n, v.revision.mismos.sinConfirmar, v.revision.mismos.masBaratoUnidad, v.revision.mismos.vendidos, v.revision.mismos.masBaratos, v.revision.otraMedida], ['lo-venden', 2, 2, 9000, 1500, 2, 1])
    assert.equal(v.revision.frase, 'De las 4 publicaciones de la búsqueda, 2 venden este mismo producto según la foto. Cobran entre $9.000 y $12.000 por unidad y entre todas llevan al menos 1.500 vendidos. Al precio que piensas ($16.000 por unidad), todas cobran menos.')

    // el dueño confirma una y dice que la otra no es: la cuenta baja a una, y con el costo aparece lo que quedaría en cada escalón
    await marcarIgual(propio, { sku: 'MLC1', relacion: 'igual' })
    await marcarIgual(propio, { sku: 'MLC2', relacion: 'distinto' })
    v = await vistaDe(propioDeCandidato(await cambiarCandidato(c._id, { costoUnitarioClp: 7000 })))
    assert.deepEqual([v.revision.mismos.n, v.revision.mismos.confirmados, v.revision.mismos.sinConfirmar, v.economia.conCosto, v.economia.hoy.queda], [1, 1, 0, true, 5400])
    assert.deepEqual(v.economia.escalones.map((e) => [e.meta, e.precio, e.lugar, e.queda, e.pierde]), [['mas-barato', 9000, 1, 100, false]])

    // si la publicación trajera dos, el precio por unidad es la mitad y el costo se paga dos veces
    await fijarUnidades(propio, 2)
    v = await vistaDe(await propioDe(c._id))
    assert.deepEqual([v.propio.unidades, v.propio.precioUnidad, v.revision.mismos.masBaratos, v.economia.hoy.queda], [2, 8000, 0, -1600])
    await assert.rejects(cambiarCandidato(c._id, { unidades: 0 }), /unidades/)
    await assert.rejects(cambiarCandidato(new mongoose.Types.ObjectId(), { precioClp: 100 }), /no encontrado/)

    // la lista del nicho trae cada candidato con su foto y su lectura; borrar se lleva también sus marcas
    const lista = await candidatosDeNicho(nicho._id)
    assert.deepEqual(lista.map((x) => [x.id, x.descripcion, x.foto, x.unidades, x.revision.estado, x.revision.mismos.n]), [[String(c._id), 'Lampara de mesa 300w con sensor', foto, 2, 'lo-venden', 1]])
    await borrarCandidato(c._id)
    assert.deepEqual([await CandidatoCompra.countDocuments({}), await IgualPropio.countDocuments({}), (await candidatosDeNicho(nicho._id)).length], [0, 0, 0])
    await assert.rejects(borrarCandidato(c._id), /no encontrado/)
  } finally {
    await mongoose.disconnect()
    await mongod.stop()
  }
})
