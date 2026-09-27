import test from 'node:test'
import assert from 'node:assert/strict'
import { tituloTraeFrase, fraseQueExcluye, separarSnapshots } from '../src/services/filtroNicho.js'
import { verificarGrupos } from '../src/services/vigiaMejoras.js'

// títulos reales del scan de "carpa camping" del 27-sep-2026
const T = [
  'Impermeable Lona Lateral 3x3m Para Toldo Plegable Jardin Color Azul',
  'Carpa Lona Repuesto Toldo 3x3 Impermeable Color Azul',
  'Carpa Caseta D Baño Vestidor Portátil Para Camping 1 Persona',
  'Carpa Expedition Pro 2 Discovery 5.000 Mm Columna De Agua',
  'Lona Carpa Repuesto Toldo Plegable 3x3 Mts Techo Color Blanco',
  'Carpa Camping Tienda Familiar 6-8 Personas Impermeable Beige',
  'Carpa Caseta Baño Vestidor Portátil Para Camping 1 Persona Verde',
  'Carpa 8 Personas Con 2 Habitáculones Gran Espacio 2,6x3,8x2m Color Verde Musgo',
  'Carpa Toldo Lona Impermeable Cubre Autos Cobertor 4x5 Mts',
  'Carpa Iglú Nautika Panda 2 Personas Turquesa',
]

test('tituloTraeFrase: todas las palabras, sin tildes ni plurales', () => {
  assert.equal(tituloTraeFrase(T[1], 'toldo'), true)
  assert.equal(tituloTraeFrase(T[1], 'repuesto toldo'), true)
  assert.equal(tituloTraeFrase(T[2], 'baño vestidor'), true)
  assert.equal(tituloTraeFrase(T[2], 'bano vestidores'), true)
  assert.equal(tituloTraeFrase(T[3], 'toldo'), false)
  assert.equal(tituloTraeFrase(T[5], 'tienda'), true)
  assert.equal(tituloTraeFrase(T[5], ''), false)
})

test('fraseQueExcluye y separarSnapshots: sin título se queda', () => {
  assert.equal(fraseQueExcluye(T[0], ['vestidor', 'toldo']), 'toldo')
  assert.equal(fraseQueExcluye(T[3], ['vestidor', 'toldo']), null)
  const porSku = new Map(T.map((t, i) => [`s${i}`, { titulo: t }]))
  const snaps = [...T.map((_, i) => ({ sku: `s${i}` })), { sku: 'sin-titulo' }]
  const { dentro, fuera } = separarSnapshots(snaps, porSku, ['toldo'])
  assert.equal(fuera.length, 4)
  assert.equal(dentro.length, 7)
  assert.ok(dentro.some((s) => s.sku === 'sin-titulo'))
  assert.equal(separarSnapshots(snaps, porSku, []).dentro, snaps)
})

test('verificarGrupos: la frase no puede pisar el nicho ni ser la keyword', () => {
  const productos = T.map((titulo, i) => ({ titulo, vendidos: [1000, 10000, 5000, 500, 1000, 100, 100, 100, 5000, 500][i] }))
  const grupos = [
    { nombre: 'Carpas de camping', esDelNicho: true, frase: '', indices: [3, 5, 7, 9] },
    { nombre: 'Lonas de toldo', esDelNicho: false, frase: 'toldo', indices: [0, 1, 4, 8] },
    { nombre: 'Baño vestidor', esDelNicho: false, frase: 'vestidor', indices: [2, 6] }, // solo 2: no pesa
    { nombre: 'Lo que dice carpa', esDelNicho: false, frase: 'carpa', indices: [1] }, // es la keyword
    { nombre: 'Impermeables', esDelNicho: false, frase: 'impermeable', indices: [0, 1] }, // pisa la carpa familiar
  ]
  const r = verificarGrupos('carpa camping', productos, grupos)
  assert.deepEqual(r.map((g) => g.frase), ['toldo'])
  assert.equal(r[0].productos, 4)
  assert.equal(r[0].pctProductos, 40)
  assert.equal(r[0].pctVendidos, Math.round(17000 / 23400 * 100))
})

test('verificarGrupos: la frase tiene que describir al grupo que dice la IA', () => {
  const productos = T.map((titulo) => ({ titulo, vendidos: 100 }))
  const grupos = [{ nombre: 'Lonas', esDelNicho: false, frase: 'cubre autos', indices: [0, 1, 4, 8] }]
  assert.deepEqual(verificarGrupos('carpa camping', productos, grupos), [])
})

test('verificarGrupos: grupos que se pisan quedan en uno, y una palabra corta sola no pasa', () => {
  const titulos = [
    'Aire Acondicionado Portátil 9000 BTU Frío', 'Aire Acondicionado Portátil 12000 BTU Frío Calor', 'Aire Acondicionado Portatil Midea 12000',
    'Aire Acondicionado Calefactor De Pared Frio Calor Portátil', 'Calefactor Mini Acondicionado Portátil De Pared', 'Aire Acondicionado Calefactor De Pared B',
    'Mini Enfriador Portátil Aire Acondicionado Ventilador', 'Ventilador mini aire acondicionado USB', 'Mini enfriador de aire USB escritorio',
  ]
  const productos = titulos.map((titulo) => ({ titulo, vendidos: 100 }))
  const grupos = [
    { nombre: 'Aires portátiles', esDelNicho: true, frase: '', indices: [0, 1, 2] },
    { nombre: 'Calefactor de pared', esDelNicho: false, frase: 'calefactor', indices: [3, 4, 5] },
    { nombre: 'Calefactor de pared', esDelNicho: false, frase: 'de pared', indices: [3, 4, 5] },
    { nombre: 'Enfriador USB', esDelNicho: false, frase: 'mini', indices: [6, 7, 8] },
    { nombre: 'Enfriador USB', esDelNicho: false, frase: 'ventilador', indices: [6, 7] },
  ]
  const r = verificarGrupos('aire acondicionado portatil', productos, grupos)
  assert.deepEqual(r.map((g) => g.frase).sort(), ['calefactor'])
  assert.equal('toca' in r[0], false)
})
