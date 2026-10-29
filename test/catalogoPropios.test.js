import test from 'node:test'
import assert from 'node:assert/strict'
import { agruparPorFamilia } from '../frontend/src/lib/familiasPropias.js'
import { publicacionVigente, FILTRO_VIGENTES, inventarioEntrada, filtrarEntradas, paginarEntradas, seriePrecioEntrada } from '../frontend/src/lib/catalogoPropios.js'
import { normalizarStockPropio, usaInventarioFull } from '../src/services/stockPropio.js'

const producto = (id, extra = {}) => ({ _id: id, sku: `sku-${id}`, titulo: `Producto ${id}`, estadoMl: 'active', mediciones: [{ fecha: '2026-01-01', precio: 1000, stock: 10 }], ...extra })

test('el catálogo excluye finalizadas antes de agrupar y sumar; mantiene pausadas y estado desconocido', () => {
  const familia = { id: 'familia-prueba', nombre: 'Producto de prueba' }
  const vivos = [producto('a', { familiaMl: familia }), producto('b', { familiaMl: familia, estadoMl: 'paused' })]
  const cerrados = [producto('c', { familiaMl: familia, estadoMl: 'closed' }), producto('d', { estadoMl: 'deleted' })]
  const entradas = agruparPorFamilia([...vivos, ...cerrados, producto('e', { estadoMl: null })])
  assert.equal(entradas.length, 2)
  assert.equal(entradas[0].m.stock, 20)
  assert.deepEqual(entradas[0].variantes.map((p) => p._id), ['a', 'b'])
  assert.equal(publicacionVigente(vivos[1]), true)
  assert.equal(FILTRO_VIGENTES.estadoMl.$nin.includes('closed'), true)
})

test('el stock Full usa disponibilidad de bodega y una familia incompleta conserva el dato desconocido', () => {
  const full = producto('a', { envioMl: { logistica: 'fulfillment' }, inventarioFull: { disponible: 4 } })
  const pendiente = producto('b', { envioMl: { logistica: 'fulfillment' } })
  assert.deepEqual(inventarioEntrada({ p: full }), { tieneFull: true, tieneBodega: false, full: 4, bodega: null })
  assert.equal(inventarioEntrada({ variantes: [full, pendiente] }).full, null)
  const bodega = producto('c', { envioMl: { logistica: 'xd_drop_off' } })
  assert.equal(inventarioEntrada({ variantes: [full, bodega] }).bodega, 10)
})

test('la búsqueda reconoce tildes, identificadores y variantes, combinada con logística', () => {
  const entradas = agruparPorFamilia([
    producto('a', { titulo: 'Lámpara Azul', envioMl: { logistica: 'fulfillment' } }),
    producto('b', { titulo: 'Lámpara Roja', envioMl: { logistica: 'xd_drop_off' } }),
    producto('c', { familiaMl: { id: 'grupo', nombre: 'Artículo', variante: 'Dorado' } }),
  ])
  assert.deepEqual(filtrarEntradas(entradas, { busqueda: 'lampara', filtro: 'full' }).map((e) => e.p._id), ['a'])
  assert.equal(filtrarEntradas(entradas, { busqueda: 'sku-b' })[0].p._id, 'b')
  assert.equal(filtrarEntradas(entradas, { busqueda: 'dorado' })[0].p._id, 'c')
  assert.equal(filtrarEntradas(entradas, { busqueda: 'inexistente' }).length, 0)
})

test('la paginación se ajusta al reducir los resultados y representa correctamente una lista vacía', () => {
  const entradas = Array.from({ length: 25 }, (_, i) => ({ clave: i }))
  assert.deepEqual(paginarEntradas(entradas, 3).entradas, [{ clave: 24 }])
  assert.equal(paginarEntradas(entradas.slice(0, 2), 3).pagina, 1)
  assert.deepEqual(paginarEntradas([], 5), { entradas: [], pagina: 1, paginas: 1, desde: 0, hasta: 0, total: 0 })
})

test('el gráfico familiar usa precios efectivos y solo mediciones comunes', () => {
  const a = producto('a', { mediciones: [{ fecha: '2026-01-01', precio: 1000 }, { fecha: '2026-01-02', precio: 1000, precioEfectivo: 900 }] })
  const b = producto('b', { mediciones: [{ fecha: '2026-01-02', precio: 1200 }] })
  assert.deepEqual(seriePrecioEntrada({ variantes: [a, b] }), [{ fecha: '2026-01-02', valor: 900 }])
})

test('un inventory_id no convierte despacho del vendedor en Full', () => {
  assert.equal(usaInventarioFull({ inventory_id: 'inventario-prueba', shipping: { logistic_type: 'xd_drop_off' } }), false)
  assert.equal(usaInventarioFull({ shipping: { logistic_type: 'fulfillment' } }), true)
  const p = producto('a', { envioMl: { logistica: 'xd_drop_off' }, inventarioFull: { disponible: 0, declaraElItem: 12 } })
  const normalizado = normalizarStockPropio(p)
  assert.equal(normalizado.inventarioFull, null)
  assert.equal(normalizado.mediciones.at(-1).stock, 12)
  assert.equal(p.mediciones.at(-1).stock, 10, 'la lectura no altera la serie guardada')
  const full = { ...p, envioMl: { logistica: 'fulfillment' } }
  assert.equal(normalizarStockPropio(full), full)
  assert.equal(normalizarStockPropio({ ...p, envioMl: null }).inventarioFull.disponible, 0)
})
