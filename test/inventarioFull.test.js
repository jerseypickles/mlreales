import test from 'node:test'
import assert from 'node:assert/strict'
import { velocidadDiaria, coberturaYReposicion, urgencia, primeraEntrada } from '../src/services/inventarioFull.js'

// Medido el 28-ago-2026 sobre las Brochas Set 18 (inventario EKVS28895):
// el item declaraba available_quantity 20 y la bodega tenía 9. El libro lo
// confirma: entraron 20, se vendieron 11, quedan 9. La cobertura que mostraba
// el panel estaba al doble de la real.

const HOY = new Date('2026-08-28T12:00:00Z')

test('velocidadDiaria: un producto nuevo NO se divide por la ventana completa', () => {
  // 11 ventas en 13 días de vida son 0,85/día, no 0,37 (11/30)
  const primerInbound = new Date('2026-08-15T03:12:00Z')
  const v = velocidadDiaria({ unidades: 11, ventanaDias: 30, desdeEl: primerInbound, hoy: HOY })
  assert.ok(v > 0.8 && v < 0.9, `dio ${v}`)
  const ingenuo = 11 / 30
  assert.ok(v > ingenuo * 2, 'la ventana fija lo subestimaba a menos de la mitad')
})

test('velocidadDiaria: un producto viejo sí usa la ventana completa', () => {
  const viejo = new Date('2026-01-01T00:00:00Z')
  assert.equal(velocidadDiaria({ unidades: 30, ventanaDias: 30, desdeEl: viejo, hoy: HOY }), 1)
})

test('velocidadDiaria: piso de un día, para que 3 ventas en una tarde no sean 12/día', () => {
  const hace6h = new Date(HOY.getTime() - 6 * 3600e3)
  assert.equal(velocidadDiaria({ unidades: 3, ventanaDias: 30, desdeEl: hace6h, hoy: HOY }), 3)
})

test('velocidadDiaria: sin ventas no hay velocidad', () => {
  assert.equal(velocidadDiaria({ unidades: 0, ventanaDias: 30 }), 0)
  assert.equal(velocidadDiaria({ unidades: null, ventanaDias: 30 }), 0)
})

test('la cobertura cuenta lo que va EN CAMINO', () => {
  // gritar quiebre con un inbound ya despachado es el error que hay que evitar
  const sin = coberturaYReposicion({ stock: 9, velocidadDia: 1 })
  const con = coberturaYReposicion({ stock: 9, velocidadDia: 1, enCamino: 30 })
  assert.equal(sin.diasCobertura, 9)
  assert.equal(con.diasCobertura, 39)
  assert.ok(con.aEnviar < sin.aEnviar, 'y pide reponer menos')
})

test('cuánto enviar para llegar al objetivo', () => {
  // caso real: Brochas Set 18, 9 en bodega, ~0,85/día, objetivo 45 días
  const r = coberturaYReposicion({ stock: 9, velocidadDia: 0.85, objetivoDias: 45 })
  assert.equal(r.necesarioParaObjetivo, 39) // ceil(0,85 × 45)
  assert.equal(r.aEnviar, 30)
  assert.equal(r.diasCobertura, 11)
})

test('sin ventas no se pide reponer nada', () => {
  const r = coberturaYReposicion({ stock: 5, velocidadDia: 0 })
  assert.equal(r.diasCobertura, null)
  assert.equal(r.aEnviar, 0, 'un producto que no vende no necesita más stock')
})

test('el semáforo distingue quebrado de crítico de holgado', () => {
  assert.equal(urgencia(null), 'sin_ventas')
  assert.equal(urgencia(0), 'quebrado')
  assert.equal(urgencia(9), 'critico')
  assert.equal(urgencia(14), 'critico')
  assert.equal(urgencia(20), 'reponer')
  assert.equal(urgencia(63), 'holgado')
})

test('primeraEntrada toma el inbound más viejo, no el último', () => {
  // el envío del 23-ago llegó partido (4 + ajustes); el que marca el inicio de
  // la vida vendible es el del 15
  const movs = [
    { tipo: 'venta', fecha: new Date('2026-08-26') },
    { tipo: 'entrada', fecha: new Date('2026-08-23') },
    { tipo: 'entrada', fecha: new Date('2026-08-15') },
  ]
  assert.equal(primeraEntrada(movs).toISOString().slice(0, 10), '2026-08-15')
  assert.equal(primeraEntrada([]), null)
  assert.equal(primeraEntrada([{ tipo: 'venta', fecha: new Date() }]), null)
})
