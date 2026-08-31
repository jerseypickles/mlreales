import test from 'node:test'
import assert from 'node:assert/strict'
import { aRefrescar } from '../src/services/refrescoCurvas.js'

// La curva se medía UNA VEZ y nunca más: `calcularMetricas` la pide solo si
// falta. Medido el 30-ago-2026, 54 de 84 nichos activos tenían la curva de
// hace ~46 días. La FORMA del año no cambia, pero `busquedasMes` sí: Google
// devuelve el promedio móvil de 12 meses y cada mes lo corre.
const hace = (dias) => new Date(Date.now() - dias * 86400e3)

test('se refresca lo vencido, y lo más viejo primero', () => {
  const r = aRefrescar([
    { keyword: 'fresca', medidoEl: hace(5) },
    { keyword: 'vieja', medidoEl: hace(46) },
    { keyword: 'viejisima', medidoEl: hace(90) },
  ])
  assert.deepEqual(r, ['viejisima', 'vieja'])
})

// Las que nunca se midieron NO entran acá: de esas se encarga calcularMetricas
// al primer reporte. Meterlas dobles gastaría dos llamadas por lo mismo.
test('la curva que nunca se midió no es cosa del refresco', () => {
  assert.deepEqual(aRefrescar([{ keyword: 'nueva', medidoEl: null }]), [])
  assert.deepEqual(aRefrescar([]), [])
})

test('la vigencia se puede mover sin tocar código', () => {
  const curvas = [{ keyword: 'x', medidoEl: hace(20) }]
  assert.deepEqual(aRefrescar(curvas, { vigenciaDias: 30 }), [])
  assert.deepEqual(aRefrescar(curvas, { vigenciaDias: 15 }), ['x'])
})
