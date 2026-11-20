import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { rutaDeRanking, urlDeRanking, parDePropio, paresDePropios, paresQueTocan, pasadaRankingPropios, leerRankingPropio, traerRankingDe, rankingDePropio, DIAS_ENTRE_LECTURAS, DIAS_VIGENTE } from '../src/services/rankingPropio.js'
import { marcaDeItem } from '../src/services/marcaMl.js'
import { diaChile } from '../src/services/inventarioFull.js'
import { vistaIguales, marcarIgual, ordenarCandidatos } from '../src/services/iguales.js'
import { RankingPropio } from '../src/models/RankingPropio.js'
import { ProductoPropio } from '../src/models/ProductoPropio.js'
import { Producto } from '../src/models/Producto.js'
import { Snapshot } from '../src/models/Snapshot.js'
import { Nicho } from '../src/models/Nicho.js'
import { IgualPropio } from '../src/models/IgualPropio.js'

// EL RANKING DONDE COMPITE CADA PUBLICACIÓN PROPIA (20-nov-2026).
// «Quién vende lo mismo» miraba solo el scan de la búsqueda del nicho, y una publicación propia y las que venden su
// mismo producto no salían en esa búsqueda: estaban en los más vendidos de su categoría y marca. Acá se prueba que
// ese ranking se lee una vez por semana por par categoría y marca, y que sus publicaciones entran a la vista.

const DIA = 86_400_000
const AHORA = new Date('2026-11-20T15:00:00Z')
const gastos = { presupuesto: async () => ({ scraping: { agotado: false } }), registrarGasto: async () => {} }
const item = (id, posicion, titulo, precio, mas = {}) => ({ id, itemId: id, tipo: 'publicacion', posicion, titulo, vendedor: null, precio, vendidos: 100, tiendaOficial: false, url: `https://x/${id}`, imagen: `https://x/${id}-O.webp`, ...mas })

let mongod
before(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})
beforeEach(async () => {
  await Promise.all([RankingPropio, ProductoPropio, Producto, Snapshot, Nicho, IgualPropio].map((m) => m.deleteMany({})))
})
after(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

test('ranking propio: la dirección es la de la categoría, filtrada por la marca cuando la marca tiene id', () => {
  assert.equal(rutaDeRanking({ categoriaId: 'MLC100', marcaId: '555' }), 'MLC100?attribute_id=BRAND&attribute_value_id=555')
  assert.equal(rutaDeRanking({ categoriaId: 'MLC100', marcaId: null }), 'MLC100')
  assert.equal(urlDeRanking({ categoriaId: 'MLC100', marcaId: '555' }), 'https://www.mercadolibre.cl/mas-vendidos/MLC100?attribute_id=BRAND&attribute_value_id=555')
  // la marca sale de los atributos del ítem; escrita a mano no tiene id; sin atributos no se sabe
  assert.deepEqual(marcaDeItem({ attributes: [{ id: 'COLOR', value_name: 'Rojo' }, { id: 'BRAND', value_id: 555, value_name: 'Genérica' }] }), { id: '555', nombre: 'Genérica' })
  assert.deepEqual(marcaDeItem({ attributes: [{ id: 'BRAND', value_id: null, value_name: 'Mi Marca' }] }), { id: null, nombre: 'Mi Marca' })
  assert.deepEqual(marcaDeItem({ attributes: [] }), { id: null, nombre: null })
  assert.equal(marcaDeItem({ title: 'sin atributos' }), null)
  // sin categoría o sin la marca anotada todavía no hay ranking que leer
  assert.equal(parDePropio({ categoriaMl: 'MLC100' }), null)
  assert.equal(parDePropio({ marcaMl: { id: '555' } }), null)
  assert.deepEqual(parDePropio({ categoriaMl: 'MLC100', marcaMl: { id: '555', nombre: 'Genérica' } }), { categoriaId: 'MLC100', marcaId: '555' })
  assert.deepEqual(parDePropio({ categoriaMl: 'MLC100', marcaMl: { id: null, nombre: 'Mi Marca' } }), { categoriaId: 'MLC100', marcaId: null })
})

test('ranking propio: tocan los pares que nunca se leyeron y los de hace una semana o más, el más atrasado primero', () => {
  const a = { categoriaId: 'A', marcaId: '1' }, b = { categoriaId: 'B', marcaId: null }, c = { categoriaId: 'C', marcaId: '1' }
  const ultima = new Map([['A|1', new Date(+AHORA - 3 * DIA)], ['B|', new Date(+AHORA - (DIAS_ENTRE_LECTURAS + 2) * DIA)]])
  assert.deepEqual(paresQueTocan([a, b, c], ultima, { ahora: AHORA }), [c, b])
})

test('ranking propio: la pasada lee un ranking por par y no lo repite hasta la semana siguiente', async () => {
  const propio = (sku, categoriaMl, marcaMl, mas = {}) => ({ sku, itemIdMl: sku, url: `https://x/${sku}`, titulo: `Producto ${sku}`, estado: 'activo', categoriaMl, marcaMl, ...mas })
  await ProductoPropio.insertMany([
    propio('MLC900', 'MLC100', { id: '555', nombre: 'Genérica' }), propio('MLC901', 'MLC100', { id: '555', nombre: 'Genérica' }), // dos colores: un solo ranking
    propio('MLC902', 'MLC200', { id: null, nombre: 'Mi Marca' }),
    propio('MLC903', 'MLC300', undefined), // todavía sin la marca anotada: espera a su medición
    propio('MLC904', 'MLC400', { id: '555', nombre: 'Genérica' }, { estadoMl: 'closed' }), // publicación finalizada
  ])
  assert.deepEqual((await paresDePropios()).map((p) => rutaDeRanking(p)).sort(), ['MLC100?attribute_id=BRAND&attribute_value_id=555', 'MLC200'])

  const pedidos = []
  const leer = async (ruta) => { pedidos.push(ruta); return [item('MLC1', 1, 'Lampara Solar', 9990), item('MLC2', 2, 'Lampara De Pie', 19990)] }
  // con un scan leyendo Mercado Libre no se lee: es el mismo sitio
  assert.match((await pasadaRankingPropios({ ahora: AHORA, leer, gastos, scansActivos: async () => 1 })).motivo, /1 scan leyendo/)
  assert.equal(pedidos.length, 0)

  let r = await pasadaRankingPropios({ ahora: AHORA, leer, gastos, scansActivos: async () => 0 })
  assert.deepEqual([r.pares, r.leidos, r.pendientes], [2, 2, 0])
  assert.deepEqual([...pedidos].sort(), ['MLC100?attribute_id=BRAND&attribute_value_id=555', 'MLC200'])
  const guardado = await RankingPropio.findOne({ categoriaId: 'MLC100', marcaId: '555' }).lean()
  assert.deepEqual([guardado.dia, guardado.items.length, guardado.items[1].titulo], ['2026-11-20', 2, 'Lampara De Pie'])

  // al día siguiente no hay nada que leer; a la semana, sí
  r = await pasadaRankingPropios({ ahora: new Date(+AHORA + DIA), leer, gastos })
  assert.deepEqual([r.leidos, r.pendientes, pedidos.length], [0, 0, 2])
  r = await pasadaRankingPropios({ ahora: new Date(+AHORA + DIAS_ENTRE_LECTURAS * DIA), leer, gastos, max: 1 })
  assert.deepEqual([r.leidos, r.pendientes, pedidos.length], [1, 1, 3])

  // una página que no llega corta la pasada: se sigue en la próxima
  const falla = async () => { throw new Error('más vendidos: Zyte HTTP 520') }
  r = await pasadaRankingPropios({ ahora: new Date(+AHORA + 30 * DIA), leer: falla, gastos })
  assert.deepEqual([r.leidos, r.pendientes, /520/.test(r.sinLlegar)], [0, 2, true])
})

test('ranking propio: si la categoría no tiene ranking por marca se lee el de la categoría entera, y la vez siguiente se va directo', async () => {
  // 20-nov-2026: en una categoría propia la página filtrada por marca llegaba bien pero era la de error de Mercado
  // Libre; la de la categoría entera traía a los rivales directos
  const par = { categoriaId: 'MLC100', marcaId: '555' }
  const pedidos = [], cobros = []
  const cuenta = { presupuesto: gastos.presupuesto, registrarGasto: async (_n, usd) => { cobros.push(usd) } }
  const sinRanking = (ruta) => Object.assign(new Error(`más vendidos de ${ruta}: la página llegó sin ranking`), { sinRanking: true })
  const leer = async (ruta, opciones) => { pedidos.push([ruta, opciones.cortarSinRanking]); if (ruta.includes('BRAND')) throw sinRanking(ruta); return [item('MLC1', 1, 'Pinceles Set 12', 5990)] }
  let r = await leerRankingPropio(par, { ahora: AHORA, leer, gastos: cuenta })
  assert.deepEqual([r.publicaciones, r.sinFiltro], [1, true])
  assert.deepEqual(pedidos, [['MLC100?attribute_id=BRAND&attribute_value_id=555', true], ['MLC100', true]])
  assert.equal(cobros.length, 2, 'la página vacía también se cobra: se anota')
  const propio = { categoriaMl: 'MLC100', marcaMl: { id: '555', nombre: 'Genérica' } }
  const rk = await rankingDePropio(propio, { ahora: AHORA })
  assert.deepEqual([rk.items.length, rk.sinFiltro, rk.url], [1, true, 'https://www.mercadolibre.cl/mas-vendidos/MLC100'])
  // a la semana no se vuelve a pagar la página que no existe
  r = await leerRankingPropio(par, { ahora: new Date(+AHORA + 7 * DIA), leer, gastos: cuenta })
  assert.deepEqual([pedidos.length, pedidos.at(-1)[0], cobros.length, r.sinFiltro], [3, 'MLC100', 3, true])
  // si tampoco la categoría tiene ranking, queda anotado vacío: no se paga de nuevo en cada pasada
  const nada = async (ruta) => { throw sinRanking(ruta) }
  r = await leerRankingPropio({ categoriaId: 'MLC200', marcaId: '555' }, { ahora: AHORA, leer: nada, gastos: cuenta })
  assert.deepEqual([r.publicaciones, (await RankingPropio.findOne({ categoriaId: 'MLC200' }).lean()).items.length], [0, 0])
  // un bloqueo (no llegó ninguna página) no es «sin ranking»: falla y se reintenta en otra pasada
  await assert.rejects(leerRankingPropio({ categoriaId: 'MLC300', marcaId: '555' }, { ahora: AHORA, leer: async () => { throw new Error('Zyte HTTP 520') }, gastos: cuenta }), /520/)
  assert.equal(await RankingPropio.countDocuments({ categoriaId: 'MLC300' }), 0)
})

test('ranking propio: un par que falla no deja esperando a los demás: la pasada siguiente parte por otro', async () => {
  const propio = (sku, categoriaMl) => ({ sku, itemIdMl: sku, url: `https://x/${sku}`, titulo: `Producto ${sku}`, estado: 'activo', categoriaMl, marcaMl: { id: null, nombre: null } })
  await ProductoPropio.insertMany([propio('MLC910', 'MLC510'), propio('MLC911', 'MLC511'), propio('MLC912', 'MLC512')])
  const pedidos = []
  const leer = async (ruta) => { pedidos.push(ruta); if (ruta === pedidos[0]) throw new Error('Zyte HTTP 520'); return [item('MLC1', 1, 'Lampara', 9990)] }
  const cuando = new Date(+AHORA + 400 * DIA)
  let r = await pasadaRankingPropios({ ahora: cuando, leer, gastos })
  assert.deepEqual([r.leidos, r.pendientes, pedidos.length], [0, 3, 1])
  r = await pasadaRankingPropios({ ahora: new Date(+cuando + 1800e3), leer, gastos })
  assert.deepEqual([r.leidos, pedidos.length], [2, 3])
  assert.ok(!pedidos.slice(1).includes(pedidos[0]), 'el que falló va al final de la fila, no primero otra vez')
  r = await pasadaRankingPropios({ ahora: new Date(+cuando + 3600e3), leer, gastos })
  assert.deepEqual([r.leidos, r.pendientes, pedidos.at(-1)], [0, 1, pedidos[0]])
})

test('ranking propio: a pedido se lee al tiro, se averigua la marca si falta y no se paga dos veces el mismo día', async () => {
  const p = await ProductoPropio.create({ sku: 'MLC900', itemIdMl: 'MLC900', url: 'https://x/MLC900', titulo: 'Regadera', categoriaMl: 'MLC100' })
  let lecturas = 0, preguntas = 0
  const leer = async (ruta) => { lecturas++; assert.equal(ruta, 'MLC100?attribute_id=BRAND&attribute_value_id=555'); return [item('MLC1', 1, 'Regadera Verde', 9990)] }
  const pedirMl = async (ruta) => { preguntas++; assert.equal(ruta, '/items/MLC900'); return { attributes: [{ id: 'BRAND', value_id: '555', value_name: 'Genérica' }] } }
  let r = await traerRankingDe(await ProductoPropio.findById(p._id).lean(), { ahora: AHORA, leer, pedirMl, gastos })
  assert.deepEqual([r.publicaciones, lecturas, preguntas], [1, 1, 1])
  assert.deepEqual((await ProductoPropio.findById(p._id).lean()).marcaMl, { id: '555', nombre: 'Genérica' })
  r = await traerRankingDe(await ProductoPropio.findById(p._id).lean(), { ahora: new Date(+AHORA + 3600e3), leer, pedirMl, gastos })
  assert.deepEqual([r.yaLeidoHoy, lecturas, preguntas], [true, 1, 1])
  // un producto que todavía no se publica no tiene categoría: se dice, no se inventa
  await assert.rejects(traerRankingDe({ esCandidato: true, titulo: 'Idea' }, { leer, pedirMl, gastos }), (e) => e.status === 409)
  await assert.rejects(traerRankingDe(await ProductoPropio.findById(p._id).lean(), { ahora: new Date(+AHORA + 2 * DIA), leer: async () => { throw new Error('Zyte HTTP 429') }, pedirMl, gastos }), (e) => e.status === 502)
})

test('ranking propio: sus publicaciones entran a «quién vende lo mismo», primero las de la medida propia, y la propia dice su puesto', async () => {
  const nicho = await Nicho.create({ keyword: 'regadera de prueba' })
  const fecha = new Date('2026-11-14T21:30:00Z')
  const pub = (sku, titulo, precio, posicion) => ({ prod: { sku, titulo, url: `https://x/${sku}`, imagen: `https://x/${sku}-O.webp`, itemId: sku }, snap: { sku, fecha, precio, posicion, keyword: 'regadera de prueba', vendidos: 500 } })
  const pubs = [pub('MLC1', 'Regadera Extensible 30 Mts Azul', 6000, 1), pub('MLC2', 'Regadera Corta 15 M', 5000, 2)]
  await Producto.insertMany(pubs.map((x) => x.prod))
  await Snapshot.insertMany(pubs.map((x) => x.snap))
  const mio = await ProductoPropio.create({ sku: 'MLC900', itemIdMl: 'MLC900', url: 'https://x/MLC900', titulo: 'Regadera De Jardin 30 M Con Pistola', imagen: 'https://x/mio-O.jpg', nichoId: nicho._id,
    familiaMl: { id: 'F1' }, categoriaMl: 'MLC100', marcaMl: { id: '555', nombre: 'Genérica' }, mediciones: [{ fecha, precio: 18000 }] })
  const ver = async () => vistaIguales(await ProductoPropio.findById(mio._id).lean(), { conEconomia: false })
  // la vista mira el reloj de verdad para saber si la lectura sigue vigente: las lecturas de la prueba van contra hoy
  const HOY = new Date()

  // sin lectura del ranking la vista es la de siempre, y dice que el ranking no se ha leído
  let v = await ver()
  assert.deepEqual([v.candidatos.map((c) => c.sku).join(), v.ranking.leidoEl, v.ranking.sumadas], ['MLC1,MLC2', null, 0])

  await RankingPropio.create({ categoriaId: 'MLC100', marcaId: '555', dia: diaChile(HOY), leidoEl: HOY, items: [
    item('MLC50', 1, 'Tubo De Riego 100 Mts', 17000), item('MLC51', 2, 'Regadera De Jardin Con Pistola 30 Metros Verde', 17500),
    item('MLC1', 3, 'Regadera Extensible 30 Mts Azul', 6100), item('MLC900', 4, 'Regadera De Jardin 30 M Con Pistola', 18000),
  ] })
  v = await ver()
  // primero lo de la medida propia (30 m): la del ranking que la búsqueda no traía y la que está en los dos lados;
  // después lo demás, también con el ranking por delante. La publicación propia no es candidata de sí misma
  assert.deepEqual(v.candidatos.map((c) => [c.sku, c.puestoRanking, c.soloRanking, c.posicion]), [['MLC51', 2, true, null], ['MLC1', 3, false, 1], ['MLC50', 1, true, null], ['MLC2', null, false, 2]])
  assert.equal(v.candidatos[1].precio, 6000, 'la que también sale en la búsqueda conserva los datos de su scan')
  assert.deepEqual([v.ranking.publicaciones, v.ranking.sumadas, v.ranking.tambienEnBusqueda, v.ranking.propioPuesto, v.ranking.vigente], [4, 2, 1, 4, true])
  assert.equal(v.ranking.url, 'https://www.mercadolibre.cl/mas-vendidos/MLC100?attribute_id=BRAND&attribute_value_id=555')
  // «qué da la búsqueda por esa plata» sigue siendo de la búsqueda: el tubo de 100 m del ranking no es una regadera
  assert.equal(v.porLaPlata.conMedida, 2)

  // el dueño confirma la del ranking: se compara su precio aunque nunca salió en un scan
  await marcarIgual(mio, { sku: 'MLC51', relacion: 'igual', unidades: 1 })
  v = await ver()
  assert.deepEqual(v.iguales.map((x) => [x.sku, x.precioUnidad, x.enUltimoScan, x.puestoRanking, x.historia.length]), [['MLC51', 17500, true, 2, 1]])
  assert.equal(v.resumen.confirmados, 1)

  // una semana después ya no está entre los más vendidos: queda con lo último que se supo, marcada como fuera
  const enUnaSemana = new Date(+HOY + 7 * DIA)
  await RankingPropio.create({ categoriaId: 'MLC100', marcaId: '555', dia: diaChile(enUnaSemana), leidoEl: enUnaSemana, items: [item('MLC50', 1, 'Tubo De Riego 100 Mts', 16000)] })
  v = await ver()
  assert.deepEqual(v.iguales.map((x) => [x.sku, x.precioUnidad, x.enUltimoScan]), [['MLC51', 17500, false]])
  assert.deepEqual(v.candidatos.map((c) => c.sku), ['MLC1', 'MLC50', 'MLC2'])

  // una lectura vieja deja de proponer candidatos, pero lo confirmado no se pierde
  const r = await rankingDePropio(await ProductoPropio.findById(mio._id).lean(), { ahora: new Date(+enUnaSemana + (DIAS_VIGENTE + 1) * DIA) })
  assert.deepEqual([r.vigente, r.items.length, r.anteriores.has('MLC51'), r.anteriores.has('MLC50')], [false, 0, true, true])
})

test('ranking propio: en el orden de lo que falta revisar, el puesto del ranking desempata antes que el de la búsqueda', () => {
  const c = (sku, mas) => ({ sku, medida: { estado: 'igual' }, ...mas })
  assert.deepEqual(ordenarCandidatos([c('a', { posicion: 1 }), c('b', { puestoRanking: 7 }), c('c', { puestoRanking: 2, posicion: 40 }), c('d', { posicion: 3 })]).map((x) => x.sku), ['c', 'b', 'a', 'd'])
  // lo que dice la foto sigue mandando sobre cualquier puesto
  assert.equal(ordenarCandidatos([c('a', { puestoRanking: 1 }), c('b', { posicion: 90, sugerencia: { relacion: 'igual', parecido: 95 } })])[0].sku, 'b')
})
