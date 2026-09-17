import test from 'node:test'
import assert from 'node:assert/strict'
import { alertaDeStock, coberturaYReposicion, PLAZO_ENVIO_FULL_DIAS } from '../src/services/inventarioFull.js'

// El importador, 17-sep: tres productos quebrados hace una semana y nadie avisó.
const hoy = new Date('2026-09-17T15:00:00Z')
const dias = (pares) => new Map(pares.map(([dia, conStock]) => [dia, { mediciones: 30, conStock }]))

test('alerta: avisa con FECHA LÍMITE para despachar, no cuando ya quebró', () => {
  // 18 u a 2/día = 9 días: el envío a Full tarda 7, hay que despachar en 2 días
  const a = alertaDeStock({ reposicion: coberturaYReposicion({ stock: 18, velocidadDia: 2 }), hoy })
  assert.equal(a.nivel, 'enviar_ya')
  assert.equal(a.fechaQuiebre.toISOString().slice(0, 10), '2026-09-26')
  assert.equal(a.despacharAntesDel.toISOString().slice(0, 10), '2026-09-19')
  assert.equal(PLAZO_ENVIO_FULL_DIAS, 7)
  // 30 u a 2/día = 15 días: todavía hay tiempo, pero ya se prepara
  assert.equal(alertaDeStock({ reposicion: coberturaYReposicion({ stock: 30, velocidadDia: 2 }), hoy }).nivel, 'preparar')
  assert.equal(alertaDeStock({ reposicion: coberturaYReposicion({ stock: 200, velocidadDia: 2 }), hoy }).nivel, 'ok')
  // lo que ya va en camino cuenta: no se grita con un envío despachado
  assert.equal(alertaDeStock({ reposicion: coberturaYReposicion({ stock: 18, velocidadDia: 2, enCamino: 100 }), hoy }).nivel, 'ok')
})

test('alerta: un quebrado dice desde cuándo y cuánta plata se va por día', () => {
  const a = alertaDeStock({ reposicion: coberturaYReposicion({ stock: 0, velocidadDia: 2.6 }), precioClp: 3990,
    stockPorDia: dias([['2026-09-07', 30], ['2026-09-08', 30], ['2026-09-09', 12], ['2026-09-10', 0], ['2026-09-16', 0]]), hoy })
  assert.deepEqual([a.nivel, a.sinStockDesde, a.diasQuebrado, a.perdidaDiaClp, a.perdidaAcumuladaClp], ['quebrado', '2026-09-09', 8, 10374, 82992])
  assert.equal(a.fechaQuiebre, null)
  // sin stock y sin historia: no es un quiebre, es un producto que nunca partió
  assert.equal(alertaDeStock({ reposicion: coberturaYReposicion({ stock: 0, velocidadDia: 0 }), hoy }).nivel, 'sin_ventas')
  // quebrado hace tanto que ya no tiene velocidad: igual se avisa, sin inventar la pérdida
  const viejo = alertaDeStock({ reposicion: coberturaYReposicion({ stock: 0, velocidadDia: 0 }), precioClp: 1795, stockPorDia: dias([['2026-08-20', 30], ['2026-08-21', 0]]), hoy })
  assert.deepEqual([viejo.nivel, viejo.perdidaDiaClp, viejo.diasQuebrado], ['quebrado', null, 28])
  assert.equal(alertaDeStock({ reposicion: null }), null)
})
