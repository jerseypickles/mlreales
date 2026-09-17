import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarioTemporadas, calendarioParaPrompt, temporadaInalcanzableDe } from '../src/services/calendarioTemporadas.js'
import { ventanaDeCompra } from '../src/services/ventana.js'

const el = (f) => new Date(`${f}T15:00:00Z`)
const estado = (cal, id) => cal.find((t) => t.id === id).estado

test('17 de septiembre: queda verano, vienen vuelta a clases y San Valentín, y Navidad ya no se pide', () => {
  const cal = calendarioTemporadas(el('2026-09-17'))
  assert.equal(estado(cal, 'verano'), 'a-tiempo')
  assert.equal(estado(cal, 'vuelta-a-clases'), 'a-tiempo')
  assert.equal(estado(cal, 'san-valentin'), 'a-tiempo')
  // el contenedor entra a mitad de noviembre o en diciembre y la temporada termina el 24
  assert.equal(estado(cal, 'navidad'), 'ya-no-llega')
  assert.equal(estado(cal, 'halloween'), 'ya-no-llega')
  assert.equal(estado(cal, 'invierno'), 'todavia-no')
  assert.equal(cal[0].id, 'verano', 'ordenado por el plazo más cercano')
  const texto = calendarioParaPrompt(el('2026-09-17'))
  assert.match(texto, /17 de septiembre de 2026/)
  assert.match(texto, /PROHIBIDO[\s\S]*NAVIDAD/)
})

test('una temporada larga tolera llegar empezada; una de fin duro exige el caso pesimista', () => {
  // 5-oct: el peor barco deja el stock vendiendo el 29-dic, con el verano empezado pero dos meses por delante
  assert.equal(estado(calendarioTemporadas(el('2026-10-05')), 'verano'), 'justo')
  assert.equal(estado(calendarioTemporadas(el('2026-10-25')), 'verano'), 'ya-no-llega')
  // Navidad: el 1-sep es el último día; el 2 ya no, aunque el barco rápido alcanzaría
  assert.equal(estado(calendarioTemporadas(el('2026-09-01')), 'navidad'), 'a-tiempo')
  assert.equal(estado(calendarioTemporadas(el('2026-09-03')), 'navidad'), 'ya-no-llega')
  // en julio toca Navidad y todavía no vuelta a clases
  const julio = calendarioTemporadas(el('2026-07-01'))
  assert.equal(estado(julio, 'navidad'), 'a-tiempo')
  assert.equal(estado(julio, 'vuelta-a-clases'), 'todavia-no')
})

test('la guarda en código y la mesa obedecen el mismo calendario', () => {
  assert.equal(temporadaInalcanzableDe('luces led navidad', el('2026-09-17'))?.id, 'navidad')
  assert.equal(temporadaInalcanzableDe('luces led navidad', el('2026-07-01')), null)
  assert.equal(temporadaInalcanzableDe('mochila escolar', el('2026-09-17')), null)
  assert.equal(temporadaInalcanzableDe('quitasol playa', el('2026-10-25')), null, 'sin palabra de temporada no hay guarda: decide la curva medida')
  // el árbol de Navidad, pico en noviembre: por meses decía "último mes para pedir"
  const curva = { clasificacion: 'estacional', mesPico: 11, ratioPico: 5.3 }
  const sin = ventanaDeCompra({ curvaAnual: curva }, { hoy: el('2026-09-17') })
  assert.equal(sin.estado, 'ultimo-mes')
  const con = ventanaDeCompra({ keyword: 'arbol de navidad', curvaAnual: curva }, { hoy: el('2026-09-17') })
  assert.deepEqual([con.estado, con.perdioLaTemporada, con.picoPerdido, con.pico, con.hasta], ['futura', true, '2026-11', '2027-11', '2027-09'])
  assert.match(con.motivo, /ya no se alcanza/)
  // gafas de sol, pico en diciembre pero temporada larga: sigue abierta
  assert.equal(ventanaDeCompra({ keyword: 'gafas de sol', curvaAnual: { clasificacion: 'estacional', mesPico: 12 } }, { hoy: el('2026-09-17') }).estado, 'ahora')
})
