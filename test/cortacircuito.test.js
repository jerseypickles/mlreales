import test from 'node:test'
import assert from 'node:assert/strict'
import { esFatal, debeReintentar } from '../src/services/cortacircuito.js'

// El 29-ago-2026 la cuenta de Zyte se suspendió y el sistema trató ese 403 como
// cualquier otro error: 3 intentos con backoff POR CADA NICHO sobre 82 activos.
// ~246 peticiones contra una cuenta muerta, reintentando algo que ningún
// reintento arregla, y 40 minutos de scans perdidos en silencio.

test('la cuenta suspendida es fatal: reintentar es tirar peticiones', () => {
  assert.equal(
    esFatal({ status: 403, message: 'Zyte HTTP 403: {"type":"/auth/account-suspended","title":"Account Suspended"}' }),
    true,
  )
  assert.equal(esFatal({ status: 401, message: 'no autorizado' }), true)
  assert.equal(esFatal({ status: 402, message: 'payment required' }), true)
  assert.equal(esFatal({ message: 'over-quota' }), true)
})

// Éstos SÍ se arreglan reintentando, y hoy quedó demostrado: la página 2 de
// "cama perro" dio un 520 y el reintento la rescató.
test('los errores transitorios no abren el cortacircuito', () => {
  assert.equal(esFatal({ status: 520, message: 'Zyte HTTP 520' }), false)
  assert.equal(esFatal({ status: 500, message: 'internal error' }), false)
  assert.equal(esFatal({ message: 'The operation was aborted' }), false)
  assert.equal(esFatal({ message: 'Zyte devolvió 0 tarjetas: posible bloqueo' }), false)
  assert.equal(esFatal(null), false)
})

// Un 403 del SITIO destino no es lo mismo que un 403 de la CUENTA: ML bloquea
// una petición y eso se reintenta; la cuenta suspendida, no.
test('un 403 del sitio destino no se confunde con uno de cuenta', () => {
  assert.equal(esFatal({ status: 403, message: 'Zyte HTTP 403: target returned 403' }), false)
})

// Pasada la espera se deja pasar UNA petición de prueba: si ya se pagó, el
// sistema se recupera solo en vez de esperar a que alguien lo note.
test('el cortacircuito se prueba solo tras la espera', () => {
  const abierto = (hace) => ({ abierto: true, desdeEl: new Date(Date.now() - hace) })
  assert.equal(debeReintentar(abierto(2 * 60_000)), false, 'a los 2 minutos no')
  assert.equal(debeReintentar(abierto(20 * 60_000)), true, 'a los 20 sí')
  assert.equal(debeReintentar({ abierto: false }), true, 'cerrado siempre pasa')
  assert.equal(debeReintentar(null), true, 'sin estado se deja pasar')
})
