import test from 'node:test'
import assert from 'node:assert/strict'
import { aCategoria, terminosNuevos } from '../src/services/panoramaMl.js'

test('panorama: una categoría leída guarda ruta, padre, si es hoja y su volumen', () => {
  const c = aCategoria({ name: 'Utensilios', total_items_in_this_category: 12000, children_categories: [],
    path_from_root: [{ id: 'MLC1', name: 'Hogar' }, { id: 'MLC2', name: 'Cocina' }, { id: 'MLC3', name: 'Utensilios' }] })
  assert.equal(c.ruta, 'Hogar > Cocina > Utensilios')
  assert.equal(c.padreId, 'MLC2')
  assert.equal(c.hoja, true)
  assert.equal(c.totalItems, 12000)
  assert.equal(aCategoria({ name: 'Hogar', children_categories: [{ id: 'MLC2', name: 'Cocina' }], path_from_root: [{ id: 'MLC1', name: 'Hogar' }] }).hoja, false)
})

test('panorama: búsquedas nuevas = las que no estaban en la captura anterior', () => {
  assert.deepEqual(terminosNuevos(['a', 'b', 'c'], ['b', 'x']), ['a', 'c'])
  assert.deepEqual(terminosNuevos(['a'], undefined), ['a'])
})

test('panorama: las grandes a diario, las chicas cada 3 días', async () => {
  const { hojasQueTocan, DIARIAS } = await import('../src/services/panoramaMl.js')
  const hojas = Array.from({ length: DIARIAS + 3 }, (_, i) => ({ id: `C${i}` }))
  const ultima = new Map([['C0', '2026-09-27'], ['C1', '2026-09-26'], [`C${DIARIAS}`, '2026-09-26'], [`C${DIARIAS + 1}`, '2026-09-24']])
  const tocan = new Set(hojasQueTocan(hojas, ultima, '2026-09-27').map((h) => h.id))
  assert.equal(tocan.has('C0'), false, 'ya leída hoy')
  assert.equal(tocan.has('C1'), true, 'grande: todos los días')
  assert.equal(tocan.has(`C${DIARIAS}`), false, 'chica leída ayer: espera')
  assert.equal(tocan.has(`C${DIARIAS + 1}`), true, 'chica leída hace 3 días: toca')
  assert.equal(tocan.has(`C${DIARIAS + 2}`), true, 'chica nunca leída: toca')
})

test('panorama: 404 o vacío = ML no lo publica; freno o error de red se reintenta', async () => {
  const { noPublicado } = await import('../src/services/panoramaMl.js')
  assert.equal(noPublicado({ error: '/trends/MLC/MLC440853 → 404: Not found public trends.' }, true), true)
  assert.equal(noPublicado({ datos: [] }, true), true, 'respuesta vacía sin error')
  assert.equal(noPublicado({ datos: [{ keyword: 'x' }] }, false), false)
  assert.equal(noPublicado({ frenado: true, error: '429 Too Many Requests' }, true), false)
  assert.equal(noPublicado({ error: 'ETIMEDOUT' }, true), false, 'red caída: no se marca')
  assert.equal(noPublicado({ error: '500 Internal Server Error' }, true), false)
})

test('panorama: una categoría marcada sin dato no se pide hasta que vence la marca', async () => {
  const { pedibles } = await import('../src/services/panoramaMl.js')
  const ahora = new Date('2026-10-02T12:00:00Z')
  const hojas = [
    { id: 'A' },
    { id: 'B', sinTendenciasHasta: new Date('2026-11-01') },
    { id: 'C', sinTendenciasHasta: new Date('2026-09-30') },
  ]
  assert.deepEqual(pedibles(hojas, 'sinTendenciasHasta', ahora).map((h) => h.id), ['A', 'C'])
})

test('búsquedas que suben: lo de temporada que ya no se alcanza no es oportunidad; lo que no es de temporada sí', async () => {
  const { clasificarBusqueda } = await import('../src/services/panoramaMl.js')
  const { temporadaDe } = await import('../src/services/calendarioTemporadas.js')
  const oct = new Date('2026-10-08T12:00:00-03:00')
  assert.equal(clasificarBusqueda('poleron gorro hombre', temporadaDe('poleron gorro hombre Abrigos > Polerones', oct)).tipo, 'estacional-tarde')
  assert.equal(clasificarBusqueda('disfraces para bebes halloween', temporadaDe('disfraces para bebes halloween', oct)).tipo, 'estacional-tarde')
  assert.equal(clasificarBusqueda('fundas para autos a medida', temporadaDe('fundas para autos a medida Accesorios de Interior > Cubre Asientos', oct)).tipo, 'novedad')
  // el verano todavía se alcanza en octubre
  assert.equal(clasificarBusqueda('quitasol playa', temporadaDe('quitasol playa', oct)).tipo, 'estacional-a-tiempo')
})

test('vocabulario de temporada: casos reales del barrido del 8-oct (falsos positivos y verdaderos)', async () => {
  const { temporadaDe } = await import('../src/services/calendarioTemporadas.js')
  const oct = new Date('2026-10-08T12:00:00-03:00')
  const id = (t) => temporadaDe(t, oct)?.id ?? null
  // no son de temporada
  for (const t of ['bulbo electroventilador vw Interruptores', 'ventilador ps5 Coolers', 'pasta termica mx 4 Pasta Térmica', 'carpa indoor 150x150x200 Carpas para Cultivo Interior',
    'cooler master notepal x3 Coolers Externos', 'plumones para pizarra Marcadores', 'bloqueador de camaras seguridad vigilancia Kits de Seguridad', 'yerba mate playadito Yerba Mate',
    'arpon pesca submarina Arpones', 'control de xbox deadpool Fundas y Estuches', 'protector solar parabrisas Cortinas Parasoles', 'castillo inflable usado Castillos', 'evaporador aire acondicionado mitsubishi l200 Paneles Evaporadores']) {
    assert.equal(id(t), null, t)
  }
  // sí son
  assert.equal(id('cloro granulado piscina Cloros'), 'verano')
  assert.equal(id('protector solar piel grasa Protectores y Bloqueadores'), 'verano')
  assert.equal(id('ventilador de pie Ventiladores'), 'verano')
  assert.equal(id('salamandra a lena bosca A Leña'), 'invierno')
  assert.equal(id('calefactor a gas A Gas'), 'invierno')
  assert.equal(id('valvula calefaccion Grifos de Calefacción'), 'invierno')
  assert.equal(id('patines de nieve Patines para Hielo'), 'invierno')
  assert.equal(id('pantuflas elmo Pantuflas'), 'invierno')
  assert.equal(id('camiseta termica hombre Camisetas'), 'invierno')
  assert.equal(id('disfraces para bebes halloween Disfraces Completos'), 'halloween')
})
