import test from 'node:test'
import assert from 'node:assert/strict'
import { horasHastaLaProxima, elegirParaSeguir, resumenDeSerie } from '../src/services/seguimientoStock.js'

test('se lee más seguido donde más se ve: "+50" semanal, baldes medios diario, exacto cada 12 h', () => {
  assert.equal(horasHastaLaProxima({ stock: 51, topado: true }), 168)
  assert.equal(horasHastaLaProxima({ stock: 26, topado: true }), 24)
  assert.equal(horasHastaLaProxima({ stock: 11, topado: true }), 24)
  assert.equal(horasHastaLaProxima({ stock: 6, topado: true }), 12)
  assert.equal(horasHastaLaProxima({ stock: 3, topado: false }), 12)
  assert.equal(horasHastaLaProxima({ stock: 0, topado: false }), 24)
  assert.equal(horasHastaLaProxima(null), 24)
})

test('se sigue al vendedor chico: ni tiendas oficiales, ni anuncios, ni "+50" conocido; uno por vendedor y primero el que deja ver stock', () => {
  const p = (o) => ({ url: 'https://x', esTiendaOficial: false, ...o })
  const elegidos = elegirParaSeguir([
    p({ sku: 'A', posicion: 1, vendedor: 'Grande', stockFuente: 'texto', stock: 51, stockTopado: true }),
    p({ sku: 'B', posicion: 2, vendedor: 'Oficial', esTiendaOficial: true }),
    p({ sku: 'C', posicion: 3, vendedor: 'SinLeer' }), // stock desconocido: entra, la lectura lo descubre
    p({ sku: 'D', posicion: 4, vendedor: 'SinLeer' }),
    p({ sku: 'E', posicion: 5, vendedor: 'Visible', stockFuente: 'texto', stock: 4, stockTopado: false }),
    p({ sku: 'G', posicion: 6, vendedor: 'Pagado', esAnuncio: true }),
  ], { max: 6 })
  assert.deepEqual(elegidos.map((x) => x.sku), ['E', 'C'])
})

test('una serie de lecturas da el mínimo vendido, cuenta reposiciones y no suma lo que no se ve', () => {
  const l = (dia, stock, topado = false) => ({ fecha: new Date(`2026-09-${dia}T12:00:00Z`), stock, topado, fuente: 'texto' })
  // "+25" → "+10" → 4 → 1 → repone a "+25" → "+10"
  const r = resumenDeSerie([l('01', 26, true), l('03', 11, true), l('05', 4), l('06', 1), l('08', 26, true), l('10', 11, true), { fecha: new Date('2026-09-11'), ok: false }])
  // ≥1 (26→25) + ≥7 (11→4) + 3 exactas + repuso + ≥1
  assert.deepEqual([r.unidadesPiso, r.unidadesExactas, r.reposiciones, r.lecturas], [12, 3, 1, 6])
  assert.equal(r.porSemana, 9.3)
  assert.equal(resumenDeSerie([l('01', 51, true), l('08', 51, true)]).unidadesPiso, 0)
})
