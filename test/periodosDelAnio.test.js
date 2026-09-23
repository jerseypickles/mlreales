import test from 'node:test'
import assert from 'node:assert/strict'
import { periodosDelAnio } from '../src/services/estacionalidad.js'

const serie = (texto) => texto.trim().split(/\s+/).map((t) => { const [p, v] = t.split(':'); return { periodo: `20${p}`, valor: Number(v) } })

// datos reales de Google Ads (23-sep-2026)
const CALCULADORA = serie(`22-09:40500 22-10:49500 22-11:49500 22-12:27100 23-01:22200 23-02:22200 23-03:90500 23-04:90500 23-05:74000 23-06:74000 23-07:49500 23-08:60500 23-09:49500 23-10:60500 23-11:60500 23-12:27100 24-01:27100 24-02:27100 24-03:110000 24-04:110000 24-05:90500 24-06:74000 24-07:60500 24-08:74000 24-09:49500 24-10:60500 24-11:49500 24-12:27100 25-01:22200 25-02:27100 25-03:110000 25-04:90500 25-05:74000 25-06:60500 25-07:40500 25-08:49500 25-09:40500 25-10:49500 25-11:40500 25-12:22200 26-01:22200 26-02:27100 26-03:90500 26-04:74000 26-05:60500 26-06:49500 26-07:33100 26-08:49500`)
const FREIDORA = serie(`22-09:49500 22-10:90500 22-11:60500 22-12:49500 23-01:74000 23-02:60500 23-03:74000 23-04:60500 23-05:90500 23-06:60500 23-07:60500 23-08:60500 23-09:49500 23-10:90500 23-11:74000 23-12:60500 24-01:74000 24-02:74000 24-03:90500 24-04:90500 24-05:90500 24-06:165000 24-07:90500 24-08:90500 24-09:90500 24-10:90500 24-11:74000 24-12:74000 25-01:74000 25-02:74000 25-03:90500 25-04:74000 25-05:74000 25-06:110000 25-07:74000 25-08:74000 25-09:60500 25-10:90500 25-11:60500 25-12:60500 26-01:60500 26-02:60500 26-03:74000 26-04:74000 26-05:90500 26-06:110000 26-07:90500 26-08:90500`)
const MOCHILA = serie(`22-09:1000 22-10:1300 22-11:1000 22-12:2400 23-01:9900 23-02:12100 23-03:3600 23-04:1300 23-05:1600 23-06:1000 23-07:1600 23-08:1600 23-09:1300 23-10:1600 23-11:1900 23-12:2900 24-01:12100 24-02:14800 24-03:3600 24-04:1600 24-05:1000 24-06:1000 24-07:1300 24-08:1300 24-09:1000 24-10:1300 24-11:1600 24-12:2900 25-01:12100 25-02:12100 25-03:2900 25-04:1000 25-05:880 25-06:880 25-07:880 25-08:1000 25-09:720 25-10:880 25-11:1000 25-12:2400 26-01:9900 26-02:9900 26-03:2400 26-04:880 26-05:720 26-06:880 26-07:1000 26-08:1300`)

test('calculadora: la vuelta a clases es su temporada, aunque el ratio pico/promedio dijera "todo el año"', () => {
  const p = periodosDelAnio(CALCULADORA)
  const pico = p.picos[0]
  assert.equal(pico.meses[0], 3, `arranca en marzo: ${JSON.stringify(pico)}`)
  assert.equal(pico.porque?.id, 'ano-academico', 'marzo-mayo: colegio y universidad')
  assert.ok(pico.repite >= pico.anios - 1, 'se repite casi todos los años')
  assert.ok(p.valles.some((v) => v.meses.includes(1)), 'verano es su valle')
  assert.ok(p.amplitud >= 3)
})

test('freidora: el salto de junio es el CyberDay, no una estación', () => {
  const p = periodosDelAnio(FREIDORA)
  const junio = p.picos.find((x) => x.meses.includes(6))
  assert.ok(junio, JSON.stringify(p.picos))
  assert.equal(junio.porque?.id, 'cyberday')
})

test('mochila escolar: pico ene-feb de vuelta a clases, repetido todos los años', () => {
  const p = periodosDelAnio(MOCHILA, { keyword: 'mochila escolar' })
  assert.ok(p.picos[0].meses.includes(1) && p.picos[0].meses.includes(2))
  assert.equal(p.picos[0].porque?.id, 'vuelta-a-clases', 'su bulto es ene-feb aunque arranque en diciembre')
  assert.ok(p.picos[0].multiplicador >= 3)
})

test('sin 24 meses no se inventa un período', () => {
  assert.equal(periodosDelAnio(CALCULADORA.slice(0, 20)), null)
})

test('ene-mar sin pista en el nombre: se dicen los dos eventos, no se elige a ciegas', () => {
  const p = periodosDelAnio(MOCHILA, { keyword: 'producto x' })
  assert.match(p.picos[0].porque.nombre, / o /)
  assert.equal(p.picos[0].porque.certeza, 'ambiguo')
  assert.equal(periodosDelAnio(MOCHILA, { keyword: 'cocinilla de camping' }).picos[0].porque.id, 'verano')
})
