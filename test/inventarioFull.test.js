import test from 'node:test'
import assert from 'node:assert/strict'
import { velocidadDiaria, velocidadPonderada, redondearEnvio, coberturaYReposicion, urgencia, primeraEntrada } from '../src/services/inventarioFull.js'

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

test('primeraEntrada NO adivina cuando la página del libro vino llena', () => {
  // caso saca puntos, 28-ago: 17 ventas en 30 días, pero el libro se pide de a
  // 50 operaciones y la primera entrada quedó fuera. Tomar la más vieja de la
  // página daba "vendiendo desde hace 2 días" y triplicaba la velocidad: 1,83
  // en vez de 0,57, y el panel pedía reponer 72 unidades que no hacían falta.
  const movs = [
    { tipo: 'entrada', fecha: new Date('2026-08-26') },
    { tipo: 'venta', fecha: new Date('2026-08-27') },
  ]
  assert.equal(primeraEntrada(movs, { paginaLlena: true }), null, 'sin certeza, null')
  assert.ok(primeraEntrada(movs, { paginaLlena: false }), 'con la página incompleta sí se sabe')
})

test('sin fecha de inicio la velocidad cae a la ventana: subestima, no infla', () => {
  // el error barato es hacia abajo: pedir de más inmoviliza capital, pedir de
  // menos cuesta una venta que igual se detecta al siguiente scan
  const conFecha = velocidadDiaria({ unidades: 17, ventanaDias: 30, desdeEl: new Date('2026-08-26'), hoy: HOY })
  const sinFecha = velocidadDiaria({ unidades: 17, ventanaDias: 30, desdeEl: null, hoy: HOY })
  assert.ok(sinFecha < conFecha)
  assert.ok(Math.abs(sinFecha - 17 / 30) < 0.001)
})

// ── ESTABILIDAD: el forecast no puede saltar con una venta ───────────────────
//
// "He visto un producto moverse 4 veces en un rango de tiempo la cantidad a
// enviar." La primera versión CONMUTABA de ventana (7d si había ventas, 30d si
// no) y con 5-7 ventas semanales eso salta solo. Un número que cambia cuatro
// veces al día no se puede obedecer.

test('una venta más o menos NO puede mover el envío a la mitad', () => {
  const base = { unidades30: 30, desdeEl: null, hoy: HOY }
  const con5 = velocidadPonderada({ ...base, unidades7: 5 })
  const con6 = velocidadPonderada({ ...base, unidades7: 6 })
  const salto = Math.abs(con6 - con5) / con5
  assert.ok(salto < 0.1, `una venta movió la velocidad ${Math.round(salto * 100)}%`)
})

test('la semana en cero amortigua, no borra la historia', () => {
  // un producto con 30 ventas en el mes y 0 esta semana está bajando, no muerto
  const v = velocidadPonderada({ unidades7: 0, unidades30: 30, desdeEl: null, hoy: HOY })
  assert.ok(v > 0, 'no puede caer a cero de golpe')
  assert.ok(v < 1, 'pero sí tiene que bajar respecto del promedio del mes')
})

test('la semana caliente sube el número sin ignorar el mes', () => {
  // caso Set 8 del 28-ago: 88 en 30 días y 31 en 7 — acelerando de verdad
  const v = velocidadPonderada({ unidades7: 31, unidades30: 88, desdeEl: null, hoy: HOY })
  assert.ok(v > 88 / 30, 'reconoce la aceleración')
  assert.ok(v < 31 / 7, 'pero no se cuelga solo de la semana')
})

test('el envío se redondea: 34 y 36 son la misma decisión', () => {
  assert.equal(redondearEnvio(34), 35)
  assert.equal(redondearEnvio(36), 35)
  assert.equal(redondearEnvio(38), 40)
  assert.equal(redondearEnvio(112), 110, 'sobre 100 el paso es de 10')
  assert.equal(redondearEnvio(7), 7, 'bajo 10 no se redondea: cada unidad pesa')
  assert.equal(redondearEnvio(0), 0)
  assert.equal(redondearEnvio(-5), 0)
})

test('una venta de diferencia mueve el envío UN paso, no un salto', () => {
  // La exigencia correcta no es que el número quede clavado —si las ventas se
  // mueven el forecast tiene que moverse— sino que no salte. Con el
  // interruptor de ventanas, pasar de 5 a 6 ventas movía el envío de 24 a 30;
  // ahora se mueve un solo escalón de redondeo.
  const envio = (u7) =>
    coberturaYReposicion({ stock: 9, velocidadDia: velocidadPonderada({ unidades7: u7, unidades30: 30, hoy: HOY }) }).aEnviar
  const a = envio(5)
  const b = envio(6)
  assert.ok(Math.abs(b - a) <= 5, `saltó de ${a} a ${b}`)
  assert.ok(b >= a, 'y en la dirección correcta: más ventas, más stock')
})

test('el salto es MENOR que con el interruptor de ventanas', () => {
  // la comparación contra el diseño viejo, que es lo que el importador vio
  const nuevo = (u7) => velocidadPonderada({ unidades7: u7, unidades30: 30, hoy: HOY })
  const viejo = (u7) => velocidadDiaria({ unidades: u7, ventanaDias: 7, hoy: HOY })
  const saltoNuevo = (nuevo(6) - nuevo(5)) / nuevo(5)
  const saltoViejo = (viejo(6) - viejo(5)) / viejo(5)
  assert.ok(saltoNuevo < saltoViejo / 2, `nuevo ${Math.round(saltoNuevo * 100)}% vs viejo ${Math.round(saltoViejo * 100)}%`)
})
