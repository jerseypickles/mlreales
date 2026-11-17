import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { unidadesDeTitulo, fotoChica, ordenarCandidatos, resumenIguales, sugerenciasDeTanda, claveDePropio, vistaIguales, marcarIgual, fijarUnidadesPropias, sugerirIguales } from '../src/services/iguales.js'
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
  ]).map((x) => x.sku)
  assert.deepEqual(orden, ['c', 'b', 'a', 'e', 'd'])
})

test('iguales: el resumen dice en palabras dónde queda el precio propio por unidad', () => {
  const iguales = [{ sku: 'a', precio: 18000, unidades: 2, precioUnidad: 9000 }, { sku: 'b', precio: 12000, unidades: 1, precioUnidad: 12000 }, { sku: 'c', precio: 20000, unidades: 1, precioUnidad: 20000 }]
  const r = resumenIguales(16000, iguales)
  assert.deepEqual([r.confirmados, r.masBaratos, r.lugar, r.de, r.brechaPct, r.medianaUnidad, r.masBarato.sku], [3, 2, 3, 4, 44, 12000, 'a'])
  assert.equal(r.frase, 'De 3 que venden lo mismo, 2 cobran menos que tú por unidad. El más barato cobra $9.000, un 44% menos.')
  assert.equal(resumenIguales(8000, iguales).frase, 'De 3 que venden lo mismo, ninguno cobra menos que tú por unidad.')
  assert.equal(resumenIguales(16000, [iguales[0]]).frase, 'De 1 que vende lo mismo, cobra menos que tú por unidad. El más barato cobra $9.000, un 44% menos.')
  assert.equal(resumenIguales(16000, []).frase, 'Todavía no marcas a nadie que venda lo mismo.')
})

test('iguales: lo que el modelo no nombra queda anotado como distinto, para no volver a mirarlo', () => {
  const s = sugerenciasDeTanda([{ sku: 'a' }, { sku: 'b' }, { sku: 'c' }], [{ n: 2, relacion: 'igual', unidades: 2, motivo: 'misma forma' }, { n: 9, relacion: 'igual', unidades: 1, motivo: 'fuera de la tanda' }], { modelo: 'm' })
  assert.deepEqual(s.map((x) => [x.sku, x.sugerencia.relacion, x.sugerencia.unidades ?? null]), [['a', 'distinto', null], ['b', 'igual', 2], ['c', 'distinto', null]])
})

test('iguales: el dueño marca por la foto y la vista compara el precio por unidad; vale para toda la familia', async () => {
  const mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  try {
    const nicho = await Nicho.create({ keyword: 'lampara de prueba' })
    const fecha = new Date('2026-11-04T19:31:00Z')
    const pub = (sku, titulo, precio, posicion) => ({ prod: { sku, titulo, url: `https://x/${sku}`, imagen: `https://x/${sku}-O.webp`, itemId: sku }, snap: { sku, fecha, precio, posicion, keyword: 'lampara de prueba', vendidos: 100 } })
    const pubs = [pub('MLC1', 'Pack X2 Lampara De Mesa 300w', 18000, 1), pub('MLC2', 'Lampara De Mesa 300w Plateada', 12000, 2), pub('MLC3', 'Guirnalda De Luces', 9000, 3), pub('MLC4', 'Lampara De Mesa 300w Tienda', 24000, 4), pub('MLC900', 'Mi Lampara De Mesa 300w Negra', 16000, 5)]
    await Producto.insertMany(pubs.map((x) => x.prod))
    await Snapshot.insertMany(pubs.map((x) => x.snap))
    const propio = (sku) => ({ sku, url: `https://x/${sku}`, titulo: 'Mi Lampara De Mesa 300w', imagen: 'https://x/mio-O.jpg', nichoId: nicho._id, familiaMl: { id: 'F1' }, mediciones: [{ fecha, precio: 16000 }] })
    const [negro, blanco] = await ProductoPropio.insertMany([propio('MLC900'), propio('MLC901')])
    assert.equal(claveDePropio(negro), 'familia:F1')
    const ver = async (p = negro) => vistaIguales(await ProductoPropio.findById(p._id).lean(), { conEconomia: false })

    // al principio todo está por revisar, y la publicación propia que sale en la búsqueda no es un rival
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

    // la publicación propia es un pack de 2: el precio por unidad baja a la mitad, en toda la familia
    await fijarUnidadesPropias(negro, 2)
    v = await ver(blanco)
    assert.deepEqual([v.propio.unidades, v.propio.precioUnidad, v.resumen.masBaratos], [2, 8000, 0])
    await fijarUnidadesPropias(negro, 1)

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
    assert.deepEqual(v.candidatos.map((c) => [c.sku, c.sugerencia.relacion]), [['MLC4', 'igual'], ['MLC3', 'distinto']])
    assert.equal(v.iguales.length, 2) // nada se marcó solo
    assert.equal((await GastoMensual.findOne({}).lean())?.usd, 0.02) // el gasto de la lectura queda anotado
    assert.equal((await sugerirIguales(await ProductoPropio.findById(negro._id).lean(), { pedir, bajarFoto })).revisadas, 0)
    assert.equal(await IgualPropio.countDocuments({ clave: 'familia:F1' }), 4)
  } finally {
    await mongoose.disconnect()
    await mongod.stop()
  }
})
