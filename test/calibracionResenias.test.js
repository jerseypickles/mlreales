import test from 'node:test'
import assert from 'node:assert/strict'
import { casosPropios, casosBalde, casosStock, resumirMetodo, veredictoCalibracion } from '../src/services/ml/calibracionResenias.js'

const d = (n) => new Date(Date.UTC(2026, 8, 1 + n, 12))

test('propios: ventas exactas contra reseñas de la API, con mínimo de unidades', () => {
  const propios = [
    { itemIdMl: 'MLC1', mediciones: [{ fecha: d(0), numReviews: 2 }, { fecha: d(5), numReviews: 3 }] },
    { itemIdMl: 'MLC2', mediciones: [{ fecha: d(0), numReviews: 1 }] },
  ]
  const casos = casosPropios(propios, new Map([['MLC1', 54], ['MLC2', 5]]))
  assert.equal(casos.length, 1, 'MLC2 tiene muy pocas ventas para calibrar')
  assert.ok(Math.abs(casos[0].reseniasPorVenta - 3 / 54) < 1e-9, 'usa la última lectura de reseñas')
})

test('balde: primer cruce por publicación, sin catálogo, sin repetidos entre nichos ni reseñas compartidas', () => {
  const s = (sku, keyword, n, vendidos, numReviewsApi) => ({ sku, keyword, fecha: d(n), vendidos, numReviewsApi })
  const snaps = [
    s('A', 'k1', 0, 100, 40), s('A', 'k1', 7, 500, 50), s('A', 'k1', 14, 1000, 90), // cuenta el primer cruce: 50/500
    s('A', 'k2', 0, 100, 40), s('A', 'k2', 7, 500, 50), // la misma publicación en otro nicho: no se duplica
    s('CAT', 'k1', 0, 100, 10), s('CAT', 'k1', 7, 500, 20), // catálogo: fuera
    s('CH', 'k1', 0, 5, 1), s('CH', 'k1', 7, 25, 2), // balde chico: fuera
    s('X', 'k3', 0, 100, 30), s('X', 'k3', 7, 500, 60), s('Y', 'k3', 0, 100, 30), s('Y', 'k3', 7, 500, 60), // trayectoria compartida
  ]
  const productos = [{ sku: 'A', itemId: 'MLC-A' }, { sku: 'CAT', tipoListing: 'catalogo' }, { sku: 'CH' }, { sku: 'X' }, { sku: 'Y' }]
  const { casos, descartes } = casosBalde(snaps, productos)
  assert.deepEqual(casos.map((c) => [c.itemId, c.balde, c.resenias]), [['MLC-A', 500, 50]])
  assert.equal(descartes.catalogo, 1)
  assert.equal(descartes.baldeChico, 1)
  assert.equal(descartes.compartida, 2)
})

test('stock: solo el tramo exacto del mismo vendedor sin reposición, y sin contar los propios', () => {
  const l = (n, stock, extra = {}) => ({ fecha: d(n), ok: true, stock, topado: false, fuente: 'texto', sellerId: '9', ...extra })
  const seguidos = [{ sku: 'MLC5', vendedor: 'V' }, { sku: 'MLC6', esPropio: true }]
  const lecturas = new Map([
    ['MLC5', [l(0, 40), l(3, 35), l(6, 30), l(9, 22), l(10, 50, { topado: true })]], // 0→9: 18 u exactas; después repone
    ['MLC6', [l(0, 40), l(9, 20)]],
  ])
  const resenias = new Map([['MLC5', [{ dia: '2026-09-01', numReviews: 100 }, { dia: '2026-09-10', numReviews: 101 }]], ['MLC6', [{ dia: '2026-09-01', numReviews: 1 }, { dia: '2026-09-10', numReviews: 2 }]]])
  const casos = casosStock(seguidos, lecturas, resenias)
  assert.equal(casos.length, 1, 'el propio no se cuenta dos veces')
  assert.equal(casos[0].unidades, 18)
  assert.equal(casos[0].resenias, 1)
})

test('veredicto: el factor solo sale si dos métodos con casos suficientes coinciden', () => {
  const m = (casos, r) => ({ casos, reseniasPorVenta: r })
  assert.equal(veredictoCalibracion({ propios: m(3, 0.05), balde: m(200, 0.06), stock: m(0) }).estado, 'faltan-datos')
  assert.equal(veredictoCalibracion({ propios: m(10, 0.05), balde: m(200, 0.055) }).estado, 'coinciden')
  assert.equal(veredictoCalibracion({ propios: m(10, 0.02), balde: m(200, 0.06) }).estado, 'no-coinciden')
  assert.equal(resumirMetodo([{ reseniasPorVenta: 0.05 }, { reseniasPorVenta: 0.1 }]).casos, 2)
})
