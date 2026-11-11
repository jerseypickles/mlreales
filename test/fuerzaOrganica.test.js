import test from 'node:test'
import assert from 'node:assert/strict'
import { fuerzaOrganica, MIN_UNIDADES } from '../src/services/ml/fuerzaOrganica.js'

// días seguidos con stock; `f(i)` da lo que cambia
const serie = (n, f) => Array.from({ length: n }, (_, i) => ({ dia: new Date(Date.UTC(2026, 8, 1) + i * 86400e3).toISOString().slice(0, 10), gasto: 0, unidades: 0, organicas: 0, directas: 0, visitas: 0, clicks: 0, stockFraccion: 1, ...f(i) }))

test('la prueba manda: con la publicidad apagada no volvió a vender, por muchas reseñas que tenga', () => {
  // 30 días con anuncio vendiendo 1 cada dos días, después 20 días sin anuncio y sin ventas
  const dias = serie(50, (i) => (i < 30 ? { gasto: 500, unidades: i % 2, directas: i % 2, visitas: 20, clicks: 14 } : { visitas: 4 }))
  const r = fuerzaOrganica(dias, { resenias: 7, nota: 5 })
  assert.deepEqual([r.estado, r.base], ['depende-del-anuncio', 'comprobado'])
  assert.deepEqual(r.prueba.conAnuncio, { dias: 30, ventasDia: 0.5 })
  assert.deepEqual(r.prueba.sinAnuncio, { dias: 20, ventasDia: 0 })
  assert.match(r.texto, /Sin anuncio vendió 0 al día en 20 días con stock; con anuncio, 0,5 al día en 30/)
  assert.equal(r.resenias, 7, 'las reseñas son contexto, no la medida')
})

test('la prueba manda: si sin anuncio vende casi lo mismo, el anuncio sobra', () => {
  const dias = serie(40, (i) => (i < 20 ? { gasto: 800, unidades: 2 } : { unidades: i % 5 === 0 ? 1 : 2 }))
  const r = fuerzaOrganica(dias)
  assert.deepEqual([r.estado, r.base], ['se-vende-solo', 'comprobado'])
  assert.equal(r.prueba.sinVsCon, 0.9)
  assert.match(r.texto, /el anuncio le está sobrando/)
})

test('la prueba manda: a medio camino, la publicidad suma pero no es todo', () => {
  const dias = serie(30, (i) => (i < 15 ? { gasto: 800, unidades: 2 } : { unidades: 1 }))
  const r = fuerzaOrganica(dias)
  assert.deepEqual([r.estado, r.base], ['mixto', 'comprobado'])
  assert.match(r.texto, /Solo vende 50% de lo que vende con anuncio/)
})

test('sin prueba todavía, la mezcla de ML avisa a quién hacérsela', () => {
  // siempre con anuncio: 12 ventas orgánicas y 4 directas, 200 visitas con 40 clics pagados
  const solo = fuerzaOrganica(serie(16, () => ({ gasto: 300, unidades: 1, organicas: 0.75, directas: 0.25, visitas: 12.5, clicks: 2.5 })))
  assert.deepEqual([solo.estado, solo.base], ['se-vende-solo', 'indicio'])
  assert.deepEqual([solo.mezcla.pctVentasSinAnuncio, solo.mezcla.pctVisitasSinAnuncio], [75, 80])
  assert.match(solo.texto, /^8 de cada 10 ventas llegan sin anuncio \(visitas: 8 de cada 10\)\. Puede que ya se venda solo: prueba 7 días/)

  // las ventas orgánicas no bastan si casi todas las visitas son clics pagados
  const dudoso = fuerzaOrganica(serie(16, () => ({ gasto: 300, unidades: 1, organicas: 0.75, directas: 0.25, visitas: 10, clicks: 8 })))
  assert.deepEqual([dudoso.estado, dudoso.base], ['mixto', 'indicio'])

  const depende = fuerzaOrganica(serie(20, () => ({ gasto: 300, unidades: 1, organicas: 0.1, directas: 0.9, visitas: 10, clicks: 7 })))
  assert.deepEqual([depende.estado, depende.base], ['depende-del-anuncio', 'indicio'])
  assert.equal(depende.texto, 'Solo 1 de cada 10 ventas llega sin anuncio (visitas: 3 de cada 10): por ahora depende de la publicidad.')
  // sin ninguna venta orgánica la frase no dice "0 de cada 10"
  const nada = fuerzaOrganica(serie(20, () => ({ gasto: 300, unidades: 1, organicas: 0, directas: 1, visitas: 10, clicks: 10 })))
  assert.equal(nada.texto, 'Casi ninguna venta llega sin anuncio (y casi ninguna visita): por ahora depende de la publicidad.')
})

test('con pocas ventas no se opina, y los días sin stock no cuentan para nada', () => {
  const pocas = fuerzaOrganica(serie(10, (i) => ({ gasto: 300, unidades: i < 5 ? 1 : 0, organicas: i < 2 ? 1 : 0, directas: i >= 2 && i < 5 ? 1 : 0 })))
  assert.equal(pocas.estado, 'pocos-datos')
  assert.match(pocas.texto, new RegExp(`5 de ${MIN_UNIDADES}`))
  assert.match(pocas.texto, /2 sin anuncio y 3 por el anuncio/)

  // 20 días sin anuncio pero SIN STOCK: no son una prueba de que no vende
  const quebrado = serie(40, (i) => (i < 20 ? { gasto: 500, unidades: 1, directas: 1 } : { stockFraccion: 0 }))
  const r = fuerzaOrganica(quebrado)
  assert.equal(r.prueba.sinAnuncio.dias, 0)
  assert.deepEqual([r.estado, r.base], ['depende-del-anuncio', 'indicio'])

  assert.equal(fuerzaOrganica([]).estado, 'sin-datos')
  assert.equal(fuerzaOrganica(serie(5, () => ({ stockFraccion: 0.1 }))).estado, 'sin-datos')
})

test('si no vende ni con anuncio ni sin él, el problema no es la publicidad', () => {
  const r = fuerzaOrganica(serie(20, (i) => (i < 10 ? { gasto: 400, visitas: 5, clicks: 4 } : { visitas: 1 })))
  assert.deepEqual([r.estado, r.base], ['sin-ventas', 'comprobado'])
})
