import test from 'node:test'
import assert from 'node:assert/strict'
import { rendimientoPorFuente, MINIMO_POR_FUENTE } from '../src/services/ml/fuentesRadar.js'

test('fuentes del radar: tasa de "entrar" por señal, con muestra mínima', () => {
  const nichos = [], veredictos = new Map()
  for (let i = 0; i < 12; i++) {
    nichos.push({ _id: `r${i}`, radarInfo: { fuente: 'ranking-ml' }, etapaCompra: i === 0 ? 'cotizando' : 'evaluando' })
    veredictos.set(`r${i}`, { veredicto: i < 6 ? 'entrar' : 'no_entrar', score: 70 })
  }
  for (let i = 0; i < 4; i++) { nichos.push({ _id: `x${i}`, radarInfo: { fuente: 'intuicion' } }); veredictos.set(`x${i}`, { veredicto: 'no_entrar', score: 40 }) }
  nichos.push({ _id: 'viejo', radarInfo: {} })
  const r = Object.fromEntries(rendimientoPorFuente(nichos, veredictos).map((f) => [f.fuente, f]))
  assert.equal(r['ranking-ml'].tasaEntrar, 50)
  assert.equal(r['ranking-ml'].avanzados, 1)
  assert.equal(r['ranking-ml'].conMuestra, true)
  assert.equal(r.intuicion.conMuestra, false, `con menos de ${MINIMO_POR_FUENTE} veredictos no se le cuenta al radar`)
  assert.equal(r['sin-registrar'].nichos, 1)
})
