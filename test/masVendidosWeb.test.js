import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { parsearMasVendidos, categoriasQueTocan, cuerpoMasVendidos, leerMasVendidos, pasadaMasVendidosWeb, masVendidosParaRadar, ESPERA_MIN_S, ESPERA_MAX_S } from '../src/services/masVendidosWeb.js'
import { entradasAlTop } from '../src/services/rankingMasVendidos.js'
import { raizUtil } from '../src/services/panoramaMl.js'
import { RankingMasVendidos, FichaMasVendido } from '../src/models/RankingMasVendidos.js'
import { CategoriaMl } from '../src/models/CategoriaMl.js'

// Página SINTÉTICA con la forma de la página pública de más vendidos: las tarjetas vienen embebidas como JSON.
const tarjeta = ({ id, producto = null, puesto, titulo, precio, vendidos, oficial = false, vendedor = null }) => ({
  metadata: { id, ...(producto ? { product_id: producto } : {}), url: `www.mercadolibre.cl/x/p/${producto ?? id}`,
    signal: { item_id: id, prc: precio, sales: vendidos, ...(oficial ? { official_store: true } : {}) } },
  pictures: { pictures: [{ id: '111111-MLA1_012026' }] },
  float_highlight_generic: { highlight: { id: 'best_seller', text: `${puesto}º MÁS VENDIDO` } },
  components: [{ type: 'title', id: 'title', title: { text: titulo } }, ...(vendedor ? [{ type: 'seller', id: 'seller', seller: { text: `${vendedor} {icon_cockade}` } }] : []),
    { type: 'price', id: 'price_v2', price: { current_price: { value: precio, currency: 'CLP' } } }],
})
const pagina = (tarjetas) => `<html><script>window.x={"results":[{"id":"BEST_SELLER_POLYCARDS","trends_categories":{"polycards":${JSON.stringify(tarjetas)}}}]}</script></html>`

test('más vendidos por la web: lee puesto, título, precio, vendedor y lo vendido de cada tarjeta', () => {
  const html = pagina([
    tarjeta({ id: 'MLC2', puesto: 2, titulo: 'Set De Pinceles 12 Piezas', precio: 5990, vendidos: 1000 }),
    tarjeta({ id: 'MLC1', producto: 'MLC900', puesto: 1, titulo: 'Lámpara De Mesa Led "Clásica"', precio: 12990, vendidos: 5000, oficial: true, vendedor: 'TIENDA UNO' }),
    tarjeta({ id: 'MLC1', producto: 'MLC900', puesto: 1, titulo: 'repetida', precio: 1, vendidos: 1 }),
  ])
  const items = parsearMasVendidos(html)
  assert.equal(items.length, 2, 'la tarjeta repetida no se cuenta dos veces')
  assert.deepEqual(items.map((i) => i.posicion), [1, 2], 'quedan en el orden del ranking')
  assert.deepEqual({ id: items[0].id, itemId: items[0].itemId, tipo: items[0].tipo }, { id: 'MLC900', itemId: 'MLC1', tipo: 'catalogo' })
  assert.equal(items[0].titulo, 'Lámpara De Mesa Led "Clásica"')
  assert.equal(items[0].vendedor, 'TIENDA UNO', 'sin la marca del ícono')
  assert.equal(items[0].tiendaOficial, true)
  assert.deepEqual([items[0].precio, items[0].vendidos], [12990, 5000])
  assert.equal(items[1].tipo, 'publicacion', 'sin producto de catálogo, el id es el de la publicación')
  assert.equal(items[1].id, 'MLC2')
  assert.match(items[0].url, /^https:\/\/www\.mercadolibre\.cl\//)
  assert.deepEqual(parsearMasVendidos('<html>Un momento…</html>'), [], 'la página de espera no trae ranking')
})

test('más vendidos por la web: pide la página con navegador, y ante un rechazo espera lo que dice Zyte antes de reintentar', async () => {
  assert.equal(cuerpoMasVendidos('MLC1').url, 'https://www.mercadolibre.cl/mas-vendidos/MLC1')
  assert.equal(cuerpoMasVendidos('MLC1').browserHtml, true, 'por HTTP llega una página de espera')
  const html = pagina([tarjeta({ id: 'MLC2', puesto: 1, titulo: 'Lámpara', precio: 1000, vendidos: 100 })])
  const rechazo = (status, retry) => ({ ok: false, status, headers: { get: (h) => (h === 'retry-after' ? retry : null) } })
  const bien = { ok: true, status: 200, json: async () => ({ browserHtml: html }) }
  const correr = async (respuestas, opciones = {}) => {
    const esperas = []
    let n = 0
    const pedir = async () => respuestas[Math.min(n++, respuestas.length - 1)]
    const items = await leerMasVendidos('MLC1', { apiKey: 'x', pedir, esperar: async (ms) => { esperas.push(ms) }, ...opciones }).catch((e) => e)
    return { items, esperas, pedidos: n }
  }
  // 429: muchos pedidos seguidos al mismo sitio. Se espera lo que pide Zyte y el segundo intento llega
  const a = await correr([rechazo(429, '60'), bien])
  assert.deepEqual([a.items.length, a.pedidos, a.esperas], [1, 2, [60000]])
  // sin cabecera se espera medio minuto; una espera pedida muy larga o muy corta se acota
  assert.deepEqual((await correr([rechazo(520, null), bien])).esperas, [30000])
  assert.deepEqual((await correr([rechazo(520, '600'), rechazo(429, '1'), bien])).esperas, [ESPERA_MAX_S * 1000, ESPERA_MIN_S * 1000])
  // si no llega en los intentos, falla diciendo por qué, y no espera después del último
  const b = await correr([rechazo(520, '60')])
  assert.match(b.items.message, /520/)
  assert.deepEqual([b.pedidos, b.esperas.length], [3, 2])
  // no espera más allá del tiempo que le queda a la pasada
  const c = await correr([rechazo(429, '60'), bien], { hasta: Date.now() + 5000 })
  assert.match(c.items.message, /429/)
  assert.deepEqual([c.pedidos, c.esperas], [1, []])
})

test('más vendidos por la web: toca primero lo que nunca se leyó y después lo que lleva más tiempo sin leerse', () => {
  const anchas = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }]
  const ultima = new Map([['A', '2026-11-18'], ['B', '2026-11-01'], ['T1', '2026-11-05']])
  const tocan = categoriasQueTocan({ anchas, delTablero: ['T1', 'T2', 'B'], ultima, dia: '2026-11-20', dias: 7 })
  assert.deepEqual(tocan.map((c) => c.id), ['C', 'D', 'T2', 'B', 'T1'], 'las nunca leídas (anchas antes que las del tablero) y luego por antigüedad; A se leyó hace dos días')
  assert.equal(raizUtil('Accesorios para Vehículos'), true)
  assert.equal(raizUtil('Instrumentos Musicales'), true)
  for (const fuera of ['Inmuebles', 'Autos, Motos y Otros', 'Alimentos y Bebidas', 'Música y Películas', 'Libros, Revistas y Comics', 'Servicios']) assert.equal(raizUtil(fuera), false, fuera)
})

test('más vendidos por la web: la pasada guarda el ranking, respeta su tope y le entrega al radar lo que entró', async (t) => {
  const mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  t.after(async () => { await mongoose.disconnect(); await mongod.stop() })
  await CategoriaMl.create([
    { id: 'R1', nombre: 'Herramientas', ruta: 'Herramientas', padreId: null, hoja: false, totalItems: 900000 },
    { id: 'R2', nombre: 'Inmuebles', ruta: 'Inmuebles', padreId: null, hoja: false, totalItems: 990000 },
    { id: 'H1', nombre: 'Jardín', ruta: 'Herramientas > Jardín', padreId: 'R1', hoja: false, totalItems: 50000 },
    { id: 'H2', nombre: 'Chica', ruta: 'Herramientas > Chica', padreId: 'R1', hoja: true, totalItems: 900 },
    { id: 'I1', nombre: 'Casas', ruta: 'Inmuebles > Casas', padreId: 'R2', hoja: true, totalItems: 80000 },
  ])
  const semana1 = { R1: [['P1', 'Taladro Inalámbrico 20v', 1], ['P2', 'Set De Destornilladores', 2]], H1: [['P5', 'Regadera De Jardín 10 Litros', 1]] }
  const semana2 = { R1: [['P3', 'Nivel Láser Autonivelante', 1], ['P1', 'Taladro Inalámbrico 20v', 2]], H1: [['P5', 'Regadera De Jardín 10 Litros', 1]] }
  const lector = (semana) => async (id) => (semana[id] ?? []).map(([pid, titulo, posicion]) => ({ id: pid, itemId: `I${pid}`, tipo: 'catalogo', posicion, titulo, vendedor: 'V', precio: 9990, vendidos: 500, url: 'https://x', imagen: null, tiendaOficial: false }))
  const anotado = []
  const gastos = { presupuesto: async () => ({ scraping: { agotado: false } }), registrarGasto: async (_n, usd, fuente) => anotado.push([usd, fuente]) }

  const d1 = new Date('2026-11-10T09:00:00Z')
  const p1 = await pasadaMasVendidosWeb({ ahora: d1, max: 5, apiKey: 'x', leer: lector(semana1), gastos })
  assert.equal(p1.leidas, 2, 'la raíz útil y su hija con volumen; ni inmuebles ni la categoría chica')
  assert.equal(anotado.length, 2)
  assert.equal(anotado[0][1], 'zyte')
  const guardado = await RankingMasVendidos.findOne({ categoriaId: 'R1' }).lean()
  assert.equal(guardado.fuente, 'web')
  assert.deepEqual(guardado.items.map((i) => [i.id, i.itemId, i.posicion, i.vendidos]), [['P1', 'IP1', 1, 500], ['P2', 'IP2', 2, 500]])
  assert.equal((await FichaMasVendido.findOne({ id: 'P1' }).lean()).titulo, 'Taladro Inalámbrico 20v', 'la página trae el nombre: no hay que pedirlo aparte')
  // al día siguiente no hay nada vencido; con una sola lectura no se inventa movimiento, pero el radar ya ve el top
  assert.equal((await pasadaMasVendidosWeb({ ahora: new Date('2026-11-11T09:00:00Z'), max: 5, apiKey: 'x', leer: lector(semana1), gastos })).leidas, 0)
  assert.deepEqual(await entradasAlTop({ ahora: new Date('2026-11-11T09:00:00Z') }), [])
  const top = await masVendidosParaRadar({ ahora: new Date('2026-11-11T09:00:00Z') })
  assert.ok(top.some((x) => x.titulo === 'Taladro Inalámbrico 20v' && x.categoria === 'Herramientas' && x.vendidos === 500))

  // una semana después se vuelve a leer: lo que entró al top llega al radar como entrada
  const d2 = new Date('2026-11-18T09:00:00Z')
  assert.equal((await pasadaMasVendidosWeb({ ahora: d2, max: 5, apiKey: 'x', leer: lector(semana2), gastos })).leidas, 2)
  const entradas = await entradasAlTop({ ahora: d2 })
  assert.deepEqual(entradas.map((e) => [e.titulo, e.nuevo, e.posicion, e.categoria]), [['Nivel Láser Autonivelante', true, 1, 'Herramientas']])
  // pasada la semana de vigencia el mismo movimiento ya no se repite
  assert.deepEqual(await entradasAlTop({ ahora: new Date('2026-11-28T09:00:00Z') }), [])

  // si una categoría no llega (el sitio está ocupado o bloqueando), la pasada corta ahí y sigue en la próxima
  const ocupado = async () => { throw new Error('más vendidos de R1: Zyte HTTP 429') }
  const corte = await pasadaMasVendidosWeb({ ahora: new Date('2026-11-26T09:00:00Z'), max: 5, apiKey: 'x', leer: ocupado, gastos })
  assert.deepEqual([corte.leidas, corte.pendientes], [0, 2])
  assert.match(corte.sinLlegar, /429/)
  // lo que le toca por día: el tope del mes repartido en 30, para que no se acabe la primera quincena
  const { config: cfg } = await import('../src/config/env.js')
  const mensual = cfg.masVendidosWebUsdMes
  cfg.masVendidosWebUsdMes = cfg.zyteCostoListadoUsd * 30 // una lectura al día
  try {
    const uno = await pasadaMasVendidosWeb({ ahora: new Date('2026-11-26T09:00:00Z'), max: 5, apiKey: 'x', leer: lector(semana2), gastos })
    assert.deepEqual([uno.leidas, uno.porDia], [1, 1])
    const otra = await pasadaMasVendidosWeb({ ahora: new Date('2026-11-26T15:00:00Z'), max: 5, apiKey: 'x', leer: lector(semana2), gastos })
    assert.equal(otra.omitido, true)
    assert.match(otra.motivo, /ya leyó lo de hoy/)
  } finally { cfg.masVendidosWebUsdMes = mensual }

  // el tope del mes: con lo ya leído por sobre el tope, la pasada no gasta
  const { config } = await import('../src/config/env.js')
  const tope = config.masVendidosWebUsdMes
  config.masVendidosWebUsdMes = 0.01
  try {
    const r = await pasadaMasVendidosWeb({ ahora: new Date('2026-11-27T09:00:00Z'), max: 5, apiKey: 'x', leer: lector(semana2), gastos })
    assert.equal(r.omitido, true)
    assert.match(r.motivo, /tope del mes/)
  } finally { config.masVendidosWebUsdMes = tope }
  // con el mes cerca del techo el ranking espera: lo que descubre cede ante lo que mide
  const justo = { presupuesto: async () => ({ scraping: { agotado: false }, gastadoUsd: config.presupuestoUsdMes * 0.95 }), registrarGasto: async () => {} }
  const espera = await pasadaMasVendidosWeb({ ahora: new Date('2026-12-02T09:00:00Z'), apiKey: 'x', leer: lector(semana2), gastos: justo })
  assert.equal(espera.omitido, true)
  assert.match(espera.motivo, /espera para no quitarle presupuesto a los scans/)
  // y con el presupuesto general agotado tampoco
  const sinPlata = { presupuesto: async () => ({ scraping: { agotado: true, motivo: 'presupuesto mensual agotado' } }), registrarGasto: async () => {} }
  assert.equal((await pasadaMasVendidosWeb({ ahora: new Date('2026-12-02T09:00:00Z'), apiKey: 'x', leer: lector(semana2), gastos: sinPlata })).omitido, true)
})
