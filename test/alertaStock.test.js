import test from 'node:test'
import assert from 'node:assert/strict'
import { alertaDeStock, coberturaYReposicion, sinReposicion, sinStockDesde, DIAS_PARA_AGOTADO, PLAZO_ENVIO_FULL_DIAS } from '../src/services/inventarioFull.js'

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
  // sin stock hace tanto que ya no tiene velocidad y sin nada en camino: se acabó y no viene más, deja de ser alerta
  const hist = dias([['2026-08-20', 30], ['2026-08-21', 0]])
  const viejo = alertaDeStock({ reposicion: coberturaYReposicion({ stock: 0, velocidadDia: 0 }), precioClp: 1795, stockPorDia: hist, hoy })
  assert.deepEqual([viejo.nivel, viejo.perdidaDiaClp, viejo.diasQuebrado, viejo.sinStockDesde], ['agotado', null, 28, '2026-08-20'])
  // salvo que el dueño diga que sí lo va a reponer: entonces se sigue avisando
  assert.equal(alertaDeStock({ reposicion: coberturaYReposicion({ stock: 0, velocidadDia: 0 }), stockPorDia: hist, hoy, decision: 'si' }).nivel, 'quebrado')
  assert.equal(alertaDeStock({ reposicion: null }), null)
})

test('alerta: sin stock no es una sola cosa: hay que mandar, viene en camino o se acabó y no se repone', () => {
  const reciente = dias([['2026-09-10', 30], ['2026-09-11', 0]]) // 7 días sin stock
  const r = (o) => coberturaYReposicion({ stock: 0, velocidadDia: 1, ...o })
  // se acabó hace poco y nadie anotó un envío: hay que mandar, y se le pone precio por día
  const quebrado = alertaDeStock({ reposicion: r(), stockPorDia: reciente, precioClp: 5000, hoy })
  assert.deepEqual([quebrado.nivel, quebrado.diasQuebrado, quebrado.perdidaDiaClp], ['quebrado', 7, 5000])
  // con un envío anotado se espera: no es una alerta ni se cuenta plata perdida, pero dice desde cuándo
  const viene = alertaDeStock({ reposicion: r({ enCamino: 40 }), stockPorDia: reciente, precioClp: 5000, hoy })
  assert.deepEqual([viene.nivel, viene.diasQuebrado, viene.perdidaDiaClp, viene.enCamino], ['en_camino', 7, null, 40])
  // el dueño dijo que no se repone: agotado desde el primer día
  assert.equal(alertaDeStock({ reposicion: r(), stockPorDia: reciente, hoy, decision: 'no' }).nivel, 'agotado')
  // y si todavía le queda stock, se está liquidando: no se avisa que se acaba
  assert.equal(alertaDeStock({ reposicion: coberturaYReposicion({ stock: 5, velocidadDia: 1 }), hoy, decision: 'no' }).nivel, 'ok')
  assert.equal(alertaDeStock({ reposicion: coberturaYReposicion({ stock: 5, velocidadDia: 1 }), hoy }).nivel, 'enviar_ya')

  // la regla del tiempo: dos plazos de envío a Full sin stock y sin nada en camino
  assert.equal(DIAS_PARA_AGOTADO, 2 * PLAZO_ENVIO_FULL_DIAS)
  assert.deepEqual([13, 14, 60].map((d) => sinReposicion({ stock: 0, diasSinStock: d })), [false, true, true])
  assert.deepEqual([sinReposicion({ stock: 0, diasSinStock: 60, enCamino: 10 }), sinReposicion({ stock: 3, diasSinStock: 60 }), sinReposicion({ stock: 0, diasSinStock: 60, decision: 'si' }),
    sinReposicion({ stock: 0, diasSinStock: 1, decision: 'no' }), sinReposicion({ stock: 0 })], [false, false, false, true, false])
  assert.deepEqual(sinStockDesde(reciente, hoy), { desde: '2026-09-10', dias: 7 })
  assert.deepEqual(sinStockDesde(new Map(), hoy), { desde: null, dias: null })
})
