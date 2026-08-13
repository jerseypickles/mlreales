import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parsearRespuestaGoogle,
  curvaMensual,
  describirCurva,
  posicionEnElAno,
  saltoEsCreible,
} from '../src/services/estacionalidad.js'

// curvas REALES medidas en Google Trends el 12-ago-2026 (Chile, 5 años)
const QUITASOL = [63, 38, 11, 6, 4, 4, 5, 10, 17, 26, 34, 53]
const BROCHAS = [25, 26, 17, 22, 26, 29, 29, 32, 26, 27, 37, 63]

test('parsearRespuestaGoogle: corta el prefijo anti-incrustación de Google', () => {
  assert.deepEqual(parsearRespuestaGoogle(")]}',\n{\"a\":1}"), { a: 1 })
  assert.equal(parsearRespuestaGoogle('<html>Error 429</html>'), null)
  assert.equal(parsearRespuestaGoogle(''), null)
})

test('curvaMensual: promedia los puntos semanales por mes calendario', () => {
  const enero = Date.UTC(2025, 0, 6) / 1000
  const enero2 = Date.UTC(2025, 0, 20) / 1000
  const julio = Date.UTC(2025, 6, 7) / 1000
  const curva = curvaMensual([
    { time: String(enero), value: [80] },
    { time: String(enero2), value: [60] },
    { time: String(julio), value: [10] },
  ])
  assert.equal(curva.length, 12)
  assert.equal(curva[0], 70) // (80+60)/2
  assert.equal(curva[6], 10)
  assert.equal(curva[3], 0) // sin datos ese mes
  assert.equal(curvaMensual([]), null)
})

test('describirCurva: separa estacional de todo-el-año con casos reales', () => {
  const q = describirCurva(QUITASOL)
  assert.equal(q.mesPico, 1, 'quitasol pica en enero')
  assert.equal(q.clasificacion, 'estacional')
  assert.ok(q.ratioPico > 2.5, `ratio real 2.79, dio ${q.ratioPico}`)

  // brochas parece de venta pareja pero tiene ola de regalo en diciembre:
  // el ratio 2.11 lo delata, y por eso la reposición tiene fecha
  const b = describirCurva(BROCHAS)
  assert.equal(b.mesPico, 12)
  assert.equal(b.clasificacion, 'estacional')

  const plana = describirCurva(Array(12).fill(50))
  assert.equal(plana.clasificacion, 'todo-el-año')
  assert.equal(plana.ratioPico, 1)

  assert.equal(describirCurva(Array(12).fill(0)), null, 'sin señal no se inventa forma')
  assert.equal(describirCurva([1, 2, 3]), null)
})

test('posicionEnElAno: agosto es el valle del quitasol, diciembre su rampa', () => {
  const ago = posicionEnElAno(QUITASOL, 8)
  assert.equal(ago.momento, 'valle', 'medir un estacional en su valle no es "no vende"')
  const ene = posicionEnElAno(QUITASOL, 1)
  assert.equal(ene.momento, 'pico')
  const jun = posicionEnElAno(BROCHAS, 6)
  assert.equal(jun.momento, 'normal')
})

test('saltoEsCreible: la curva plana desenmascara el artefacto de catálogo', () => {
  // caso real: mochila porta bebé pasó de 1.140 a 155.237 ventas/día entre dos
  // scans consecutivos del mismo mes. Ninguna temporada hace eso.
  const falso = saltoEsCreible({
    anterior: 1140,
    actual: 155237,
    curva: Array(12).fill(50),
    mesActual: 8,
    mesAnterior: 8,
  })
  assert.equal(falso.creible, false)
  assert.match(falso.motivo, /plana/)

  // un salto suave no necesita explicación estacional
  const normal = saltoEsCreible({ anterior: 100, actual: 180, curva: QUITASOL, mesActual: 11, mesAnterior: 10 })
  assert.equal(normal.creible, true)

  // un salto grande SOLO se perdona cuando la curva se mueve de verdad entre
  // esos meses. Ojo con lo que esto implica en la práctica: dos scans
  // consecutivos están a días de distancia, así que casi siempre caen en el
  // mismo mes y ninguna temporada explica un 5x semanal — el veredicto correcto
  // para un salto brusco es "artefacto" salvo en un cambio de mes muy abrupto.
  const abrupta = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 40, 100]
  const temporada = saltoEsCreible({ anterior: 50, actual: 500, curva: abrupta, mesActual: 11, mesAnterior: 10 })
  assert.equal(temporada.creible, true)
  assert.match(temporada.motivo, /temporada/)

  // el mismo salto dentro de un mes plano no se perdona
  const dentroDelMes = saltoEsCreible({ anterior: 50, actual: 500, curva: abrupta, mesActual: 5, mesAnterior: 5 })
  assert.equal(dentroDelMes.creible, false)

  // sin curva no se juzga: null es "no sé", jamás "es falso"
  const sinCurva = saltoEsCreible({ anterior: 100, actual: 9000, curva: null, mesActual: 8 })
  assert.equal(sinCurva.creible, null)
  assert.match(sinCurva.motivo, /sin curva/)

  assert.equal(saltoEsCreible({ anterior: 0, actual: 10 }), null)
})
