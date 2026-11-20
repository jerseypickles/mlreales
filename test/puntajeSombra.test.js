import test from 'node:test'
import assert from 'node:assert/strict'
import { demandaMedida, puntajeAlterno, compararPuntajes, cambiosEnLaMesa, ordenConEmpates, MIN_CASOS_PUNTAJE, representatividad, nivelConVentaMl, PESO_DEMANDA_ML } from '../src/services/ml/puntajeSombra.js'

const base = { demanda: 80, constancia: 70, entrada: 60, economia: 90, competencia: 50 }

test('puntaje alterno: la venta medida mueve el puntaje y sin ella no hay alterno', () => {
  assert.equal(demandaMedida(0), 0)
  assert.equal(demandaMedida(60), 100)
  assert.equal(demandaMedida(600), 100)
  const poco = puntajeAlterno({ componentes: base, reseniasDia: 1 })
  const mucho = puntajeAlterno({ componentes: base, reseniasDia: 50 })
  assert.ok(mucho > poco + 10, `con la misma búsqueda, vender más sube el puntaje (${poco} → ${mucho})`)
  assert.equal(puntajeAlterno({ componentes: base, reseniasDia: null }), null)
  assert.equal(puntajeAlterno({ componentes: { ...base, economia: null }, reseniasDia: 5 }), null)
  assert.ok(puntajeAlterno({ componentes: base, reseniasDia: 50, confianza: 0.5 }) < mucho, 'conserva el descuento por búsqueda')
})

test('puntaje alterno: contra las ventas reales pide muestra antes de dar un ganador', () => {
  const casos = Array.from({ length: MIN_CASOS_PUNTAJE }, (_, i) => ({ actual: 80 - i, alterno: 50 + i * 3, ventaDia: i }))
  assert.equal(compararPuntajes(casos.slice(0, 4)).estado, 'pocos-casos')
  const r = compararPuntajes(casos)
  assert.equal(r.ordenAlterno, 1)
  assert.equal(r.ordenActual, -1)
  assert.equal(r.estado, 'gana-alterno')
})

test('puntaje alterno: dice quién sube y quién baja en la mesa', () => {
  const r = cambiosEnLaMesa([
    { keyword: 'caro sin venta', actual: 85, alterno: 60 }, { keyword: 'parejo', actual: 75, alterno: 74 },
    { keyword: 'barato que vende', actual: 62, alterno: 80 }, { keyword: 'sin medir', actual: 70, alterno: null },
  ])
  assert.equal(r.nichos, 3)
  assert.equal(r.sinVentaMedida, 1)
  assert.equal(r.suben[0].keyword, 'barato que vende')
  assert.equal(r.bajan[0].keyword, 'caro sin venta')
})

test('puntaje alterno: los empates no dependen del orden de llegada', () => {
  // tres productos sin ventas y tres con: un puntaje que separa bien los dos grupos ordena bien, llegue como llegue
  const a = [50, 51, 52, 80, 81, 82], v = [0, 0, 0, 1, 2, 3]
  const alReves = [52, 51, 50, 80, 81, 82]
  assert.ok(ordenConEmpates(a, v) > 0.85)
  assert.equal(ordenConEmpates(a, v), ordenConEmpates(alReves, v), 'los tres empatados en cero valen lo mismo en cualquier orden')
  assert.equal(ordenConEmpates([1, 1, 1], [1, 2, 3]), null, 'sin variación no hay orden que medir')
  const m = cambiosEnLaMesa([{ keyword: 'a', actual: 70, alterno: 70 }, { keyword: 'b', actual: 70, alterno: 70 }, { keyword: 'c', actual: 60, alterno: 60 }])
  assert.equal(m.suben.length + m.bajan.length, 0, 'dos nichos empatados no se mueven de lugar')
})

test('puntaje de la mesa: la venta de hoy pesa según la temporada en que se midió', () => {
  // meses que pesan 0,8 del año promedio o más: entera; la mitad o menos: nada; entre medio, en línea
  assert.deepEqual([1.4, 1, 0.8, 0.65, 0.5, 0.3, null].map((f) => Math.round(representatividad(f) * 100) / 100), [1, 1, 1, 0.5, 0, 0, 1])
  // con menos peso de la venta medida, el puntaje se acerca al que da la búsqueda
  const lleno = puntajeAlterno({ componentes: base, reseniasDia: 0 })
  const medio = puntajeAlterno({ componentes: base, reseniasDia: 0, peso: PESO_DEMANDA_ML / 2 })
  const nada = puntajeAlterno({ componentes: base, reseniasDia: 0, peso: 0 })
  assert.ok(lleno < medio && medio < nada, `${lleno} < ${medio} < ${nada}`)
})

test('puntaje de la mesa: el nivel usa la venta medida en ML y dice de dónde sale cuando no puede', () => {
  const serie = [{ s: 80, c: base, k: 1 }, { s: 78, c: { ...base, entrada: 50 }, k: 1 }, { s: 84, c: { ...base, entrada: 80 } }]
  // mucha búsqueda y nada vendido: baja; mucha venta: sube sobre el que no vende
  const flojo = nivelConVentaMl(serie, { reseniasDia: 0, scans: 3, factorTemporada: 1 })
  const fuerte = nivelConVentaMl(serie, { reseniasDia: 60, scans: 3, factorTemporada: 1 })
  assert.deepEqual([flojo.fuente, flojo.motivo, flojo.pesoMl, flojo.scans], ['venta-ml', null, PESO_DEMANDA_ML, 3])
  assert.ok(flojo.score < 80 && fuerte.score > flojo.score + 15, `${flojo.score} y ${fuerte.score}`)
  // el nivel es el promedio de la serie recalculada; el último y cuánto vibra salen de la misma serie
  const uno = (c) => puntajeAlterno({ componentes: c, reseniasDia: 0 })
  assert.equal(flojo.score, Math.round((uno(serie[0].c) + uno(serie[1].c) + uno(serie[2].c)) / 3))
  assert.deepEqual([flojo.scoreUltimo, flojo.dispersion], [uno(serie[0].c), uno(serie[2].c) - uno(serie[1].c)])
  // medido en temporada baja, la venta pesa menos y el puntaje baja menos; fuera de temporada no entra
  const baja = nivelConVentaMl(serie, { reseniasDia: 0, scans: 3, factorTemporada: 0.65 })
  assert.deepEqual([baja.fuente, baja.motivo, baja.pesoMl, baja.factorTemporada], ['venta-ml', 'temporada-baja', 0.35, 0.65])
  assert.equal(nivelConVentaMl(serie, { reseniasDia: 0, scans: 3, factorTemporada: 0.93 }).motivo, null) // un mes apenas bajo el promedio es un mes normal
  assert.ok(baja.score > flojo.score)
  const fuera = nivelConVentaMl(serie, { reseniasDia: 0, scans: 3, factorTemporada: 0.4 })
  assert.deepEqual([fuera.fuente, fuera.motivo, fuera.score ?? null], ['busqueda-google', 'fuera-de-temporada', null])
  // lo medido se lleva al nivel de un mes promedio: en plena temporada (el doble del año) vale la mitad
  const enTemporada = nivelConVentaMl(serie, { reseniasDia: 20, scans: 3, factorTemporada: 2 })
  assert.deepEqual([enTemporada.reseniasDia, enTemporada.reseniasNiveladas, enTemporada.score], [20, 10, nivelConVentaMl(serie, { reseniasDia: 10, scans: 3, factorTemporada: 1 }).score])
  assert.equal(nivelConVentaMl(serie, { reseniasDia: 20, scans: 3, factorTemporada: 5 }).reseniasNiveladas, 10) // nunca más del doble
  assert.equal(baja.reseniasNiveladas, 0)
  // una sola medición, ninguna, o una serie sin componentes: sigue el puntaje de la búsqueda
  assert.deepEqual([nivelConVentaMl(serie, { reseniasDia: 5, scans: 1 }).motivo, nivelConVentaMl(serie, {}).motivo, nivelConVentaMl([{ s: 70 }], { reseniasDia: 5, scans: 3 }).motivo, nivelConVentaMl(null, { reseniasDia: 5, scans: 3 }).motivo],
    ['sin-venta-medida', 'sin-venta-medida', 'sin-componentes', 'sin-componentes'])
  assert.equal(nivelConVentaMl(serie, { reseniasDia: 5.04, scans: 1 }).reseniasDia, 5) // el número medido viaja igual, para mostrarlo
})
