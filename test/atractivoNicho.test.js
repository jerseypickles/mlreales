import test from 'node:test'
import assert from 'node:assert/strict'
import { crecimientoDeSerie, clasificarCrecimiento, puntaje, prefijosProgresivos, filtrarVariantes, VOLUMEN_MINIMO } from '../src/services/atractivoNicho.js'

// serie semanal sintética: 5 años, con el último año 30% arriba del promedio
function serie(porPeriodo, { hasta = '2026-08-01' } = {}) {
  const puntos = []
  for (const [anio, valor] of Object.entries(porPeriodo)) {
    for (let s = 0; s < 52; s++) {
      const f = new Date(Date.UTC(Number(anio), 7, 1 + s * 7))
      if (f > new Date(hasta)) break
      puntos.push({ date_from: f.toISOString().slice(0, 10), values: [valor] })
    }
  }
  return puntos
}

test('clasificarCrecimiento: crece / estable / cae', () => {
  assert.equal(clasificarCrecimiento(32), 'crece')
  assert.equal(clasificarCrecimiento(5), 'estable')
  assert.equal(clasificarCrecimiento(-40), 'cae')
  assert.equal(clasificarCrecimiento(null), 'sin-medir')
})

test('crecimientoDeSerie: mide contra el histórico, no contra el año pasado', () => {
  // caso pastillas de freno: sube todos los años (51→56→59→68→77 = +32%)
  const c = crecimientoDeSerie(serie({ 2021: 51, 2022: 56, 2023: 59, 2024: 68, 2025: 77 }))
  assert.equal(c.clasificacion, 'crece')
  assert.ok(c.pct >= 25, `real +32%, dio ${c.pct}%`)
  assert.equal(c.serie.length, 5)
})

test('crecimientoDeSerie: descarta el período incompleto', () => {
  // el tramo en curso arrastra el resultado hacia la estación actual. Medido:
  // árbol de navidad aparecía cayendo 87% porque agosto es su valle.
  const puntos = serie({ 2021: 12, 2022: 13, 2023: 20, 2024: 15, 2025: 14 })
  // se agregan 3 semanas del período en curso, en el valle
  for (let s = 0; s < 3; s++) {
    puntos.push({ date_from: new Date(Date.UTC(2026, 7, 1 + s * 7)).toISOString().slice(0, 10), values: [2] })
  }
  const c = crecimientoDeSerie(puntos)
  assert.equal(c.serie.length, 5, 'el período parcial no entra')
  assert.notEqual(c.clasificacion, 'cae', 'el valle en curso no puede fingir una caída')
})

test('crecimientoDeSerie: sin 3 períodos completos no se opina', () => {
  assert.equal(crecimientoDeSerie(serie({ 2024: 50, 2025: 60 })), null)
  assert.equal(crecimientoDeSerie([]), null)
})

test('puntaje: el tamaño manda y la dirección desempata', () => {
  const grande = { suficiente: true, volumen: 12100, crecimiento: 'estable' }
  const chico = { suficiente: true, volumen: 300, crecimiento: 'crece' }
  assert.ok(puntaje(grande) > puntaje(chico), 'crecer 40% sobre 300 búsquedas sigue siendo poco')

  const a = { suficiente: true, volumen: 5400, crecimiento: 'crece' }
  const b = { suficiente: true, volumen: 5400, crecimiento: 'cae' }
  assert.ok(puntaje(a) > puntaje(b), 'a igual tamaño, la dirección decide')

  // bajo el piso no compite: ningún crecimiento salva 50 búsquedas al mes
  assert.equal(puntaje({ suficiente: false, volumen: 50, crecimiento: 'crece' }), -1)
  assert.equal(VOLUMEN_MINIMO, 200)
})

test('prefijosProgresivos: un salto, no hasta la raíz', () => {
  // trepar hasta la raíz cambia de mercado: "lampara de uñas uv" llegaba a
  // "lampara" (27.100, incluye lámparas de techo y de auto)
  assert.deepEqual(prefijosProgresivos('lampara de uñas uv'), ['lampara de uñas uv', 'lampara de uñas'])
  assert.deepEqual(prefijosProgresivos('scooter niño electrico'), [
    'scooter niño electrico',
    'scooter niño',
  ])
  assert.deepEqual(prefijosProgresivos('hidrolavadora'), ['hidrolavadora'])
  assert.deepEqual(prefijosProgresivos(''), [])
})

test('filtrarVariantes: descubre el nombre real y descarta lo de otro rubro', () => {
  // respuesta típica de keywords_for_keywords para "scooter niño"
  const crudo = [
    { keyword: 'scooter electrico', search_volume: 60500, competition: 'HIGH' },
    { keyword: 'scooter infantil', search_volume: 260, competition: 'LOW' },
    { keyword: 'scooter niño', search_volume: 0 },
    { keyword: 'patines para niño', search_volume: 3600 }, // comparte "niño": entra
    { keyword: 'bicicleta de montaña', search_volume: 9900 }, // no comparte nada: fuera
    { keyword: 'monopatin', search_volume: 4400 }, // no comparte palabra: fuera
  ]
  const v = filtrarVariantes('scooter niño', crudo)
  assert.equal(v[0].keyword, 'scooter electrico', 'manda el volumen')
  assert.ok(v.some((x) => x.keyword === 'scooter infantil'), 'el sinónimo real aparece')
  assert.ok(!v.some((x) => x.keyword === 'bicicleta de montaña'), 'sin palabra en común no entra')
  assert.ok(!v.some((x) => x.keyword === 'scooter niño'), 'la propia no se sugiere a sí misma')
  assert.ok(!v.some((x) => x.volumen === 0), 'las de volumen cero no sirven')
})
