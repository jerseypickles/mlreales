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

test('fuentes del radar: el rendimiento se mide con lo que el nicho vendió después, por tercios', async () => {
  const { tercios, MINIMO_CON_VENTA } = await import('../src/services/ml/fuentesRadar.js')
  const nichos = [], ventas = new Map()
  // seis nichos del ranking: cuatro venden alto, ninguno bajo; seis de temporada: uno alto, cuatro bajos
  const poner = (id, fuente, venta, origen = 'radar') => { nichos.push({ _id: id, origen, radarInfo: { fuente } }); if (venta != null) ventas.set(id, venta) }
  ;[30, 28, 26, 24, 12, 11].forEach((v, i) => poner(`r${i}`, 'ranking-ml', v))
  ;[25, 10, 2, 1.5, 1, 0.5].forEach((v, i) => poner(`t${i}`, 'temporada', v))
  ;[3, 2.5].forEach((v, i) => poner(`i${i}`, 'intuicion', v))
  poner('m0', null, 0.2, 'manual')
  poner('sinventa', 'ranking-ml', null)
  const cortes = tercios([...ventas.values()])
  const r = Object.fromEntries(rendimientoPorFuente(nichos, new Map(), { ventas, cortes }).map((f) => [f.fuente, f]))
  assert.deepEqual([r['ranking-ml'].nichos, r['ranking-ml'].conVenta, r['ranking-ml'].ventaAlta, r['ranking-ml'].ventaBaja], [7, 6, 4, 0])
  assert.equal(r['ranking-ml'].floja, false)
  assert.deepEqual([r.temporada.conVenta, r.temporada.ventaAlta, r.temporada.ventaBaja, r.temporada.floja], [6, 1, 4, true])
  assert.equal(r.intuicion.conMuestraVenta, false, `con menos de ${MINIMO_CON_VENTA} nichos con venta no se saca conclusión`)
  assert.equal(r.intuicion.floja, false)
  assert.equal(r['a-mano'].nichos, 1, 'lo abierto a mano va en su propia fila')
  assert.equal(tercios([1, 2, 3]), null)
})

test('fuentes del radar: la fuente la anota el código contra lo que venía en los datos', async () => {
  const { verificarFuente } = await import('../src/services/ml/fuentesRadar.js')
  const bloques = {
    'ranking-ml': ['Set 3 Cajas De Herramientas Apilables', 'Taladro Inalámbrico 20v Con Maletín'],
    'tienda-ganadora': ['Lámpara De Mesa Táctil Recargable'],
    'tendencia-sostenida': ['nivel laser autonivelante'],
    'busqueda-que-sube': ['soporte celular'],
  }
  // calza con un producto del ranking aunque el modelo haya dicho otra cosa
  assert.deepEqual(verificarFuente({ keyword: 'caja de herramientas', fuente: 'intuicion', evidencia: '' }, bloques),
    { fuente: 'ranking-ml', verificada: true, evidencia: 'Set 3 Cajas De Herramientas Apilables', declarada: 'intuicion' })
  // la búsqueda más corta entera dentro de la idea
  assert.equal(verificarFuente({ keyword: 'soporte celular auto', fuente: 'busqueda-que-sube' }, bloques).fuente, 'busqueda-que-sube')
  assert.equal(verificarFuente({ keyword: 'nivel laser', fuente: 'autocompletado' }, bloques).fuente, 'tendencia-sostenida')
  // una sola palabra en común no alcanza
  const suelta = verificarFuente({ keyword: 'soporte monitor', fuente: 'busqueda-que-sube', evidencia: 'subió soporte' }, bloques)
  assert.deepEqual([suelta.fuente, suelta.verificada, suelta.declarada], ['intuicion', false, 'busqueda-que-sube'])
  // otra forma de decirlo: vale si la evidencia que escribió cita de verdad el dato del bloque
  const sinonimo = verificarFuente({ keyword: 'velador recargable', fuente: 'tienda-ganadora', evidencia: 'publicaron "Lámpara De Mesa Táctil Recargable"' }, bloques)
  assert.deepEqual([sinonimo.fuente, sinonimo.verificada], ['tienda-ganadora', true])
  // lo que no es un dato no se puede comprobar: queda como se declaró, sin verificar
  assert.deepEqual(verificarFuente({ keyword: 'piscina inflable', fuente: 'temporada', evidencia: 'verano' }, bloques),
    { fuente: 'temporada', verificada: false, evidencia: 'verano', declarada: 'temporada' })
  assert.equal(verificarFuente({ keyword: 'algo nuevo' }, {}).fuente, 'intuicion')
})
