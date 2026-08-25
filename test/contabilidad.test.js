import test from 'node:test'
import assert from 'node:assert/strict'
import { desglosarIva, rangoDelMes, IVA_PCT, ivaDeCargo, codigosF29, importacionesEnJuego } from '../src/services/contabilidad.js'

// En Chile el precio de ML es CON IVA incluido: el neto sale dividiendo por
// 1,19, no multiplicando por 0,19. Confundirlo infla el neto en ~19%.

test('desglosarIva: el bruto YA trae el IVA adentro', () => {
  const r = desglosarIva(2990)
  assert.equal(r.brutoClp, 2990)
  assert.equal(r.netoClp, 2513) // 2990 / 1,19 = 2512,6
  assert.equal(r.ivaClp, 477)
  assert.equal(r.netoClp + r.ivaClp, r.brutoClp, 'neto + IVA debe reconstruir el bruto exacto')
})

test('desglosarIva: neto e IVA siempre suman el bruto, sin peso perdido', () => {
  for (const bruto of [1795, 2790, 2890, 2990, 5990, 19990, 106746]) {
    const r = desglosarIva(bruto)
    assert.equal(r.netoClp + r.ivaClp, bruto, `falla en ${bruto}`)
  }
})

test('desglosarIva: sin ventas no hay débito', () => {
  assert.deepEqual(desglosarIva(0), { brutoClp: 0, netoClp: 0, ivaClp: 0 })
  assert.deepEqual(desglosarIva(null), { brutoClp: 0, netoClp: 0, ivaClp: 0 })
  assert.deepEqual(desglosarIva(-100), { brutoClp: 0, netoClp: 0, ivaClp: 0 })
})

test('la tasa es 19%', () => {
  assert.equal(IVA_PCT, 19)
})

test('rangoDelMes: el mes empieza a medianoche en Chile, no en UTC', () => {
  // una venta de las 22:00 del 31 de julio es de JULIO; con corte UTC caería
  // en agosto y el período cerraría con el débito equivocado
  const { desde, hasta } = rangoDelMes('2026-08')
  assert.equal(desde.toISOString(), '2026-08-01T04:00:00.000Z')
  assert.equal(hasta.toISOString(), '2026-09-01T04:00:00.000Z')

  const ventaDe31Julio2200 = new Date('2026-08-01T02:00:00Z') // 22:00 del 31-jul en Chile
  assert.ok(ventaDe31Julio2200 < desde, 'esa venta NO es de agosto')
})

test('una boleta que cubre varias órdenes se cuenta UNA vez', () => {
  // medido el 10-ago: 51 de 52 órdenes traían tag pack_order y 3 boletas
  // cubrían más de una. Sumar por orden daba $26.966 donde eran $22.287.
  const ventas = [
    { boleta: { invoiceId: 'A', ivaClp: 589, brutoClp: 3685 } },
    { boleta: { invoiceId: 'A', ivaClp: 589, brutoClp: 3685 } }, // misma boleta, otra orden
    { boleta: { invoiceId: 'B', ivaClp: 1743, brutoClp: 10922 } },
    { boleta: { invoiceId: 'B', ivaClp: 1743, brutoClp: 10922 } },
    { boleta: { invoiceId: 'B', ivaClp: 1743, brutoClp: 10922 } },
  ]
  const porFactura = new Map()
  for (const v of ventas) if (!porFactura.has(v.boleta.invoiceId)) porFactura.set(v.boleta.invoiceId, v.boleta)
  const iva = [...porFactura.values()].reduce((s, b) => s + b.ivaClp, 0)
  assert.equal(porFactura.size, 2)
  assert.equal(iva, 589 + 1743, 'sumar por orden habría dado 6.407')
})

test('rangoDelMes: diciembre cierra en enero del año siguiente', () => {
  const { desde, hasta } = rangoDelMes('2026-12')
  assert.equal(desde.toISOString(), '2026-12-01T04:00:00.000Z')
  assert.equal(hasta.toISOString(), '2027-01-01T04:00:00.000Z')
})

// ─────────────────────────────────────────────────────────────────────────────
// LOS CASILLEROS DEL F29 (aviso del SII del 25-ago-2026 sobre el mandato de ML)

test('ivaDeCargo: los dos extremos, porque no consta si ML factura con IVA adentro', () => {
  // 100.000 con IVA incluido son 15.966 de impuesto; netos son 19.000.
  const r = ivaDeCargo(100_000)
  assert.equal(r.siIncluido, 15_966)
  assert.equal(r.siNeto, 19_000)
  assert.ok(r.siNeto > r.siIncluido, 'el supuesto neto siempre da más crédito')
})

test('ivaDeCargo: sin cargo no hay crédito', () => {
  assert.deepEqual(ivaDeCargo(0), { siIncluido: 0, siNeto: 0 })
  assert.deepEqual(ivaDeCargo(null), { siIncluido: 0, siNeto: 0 })
})

test('el F29 pide los CUATRO casilleros que nombra el SII', () => {
  const cs = codigosF29({ debitoIvaClp: 22_287, comisionClp: 50_000, documentos: 1 })
  assert.deepEqual(cs.map((c) => c.codigo), [500, 501, 519, 520])
  assert.deepEqual(
    cs.map((c) => c.lado),
    ['debito', 'debito', 'credito', 'credito'],
    '500/501 son débito y 519/520 crédito: cruzarlos es la inconsistencia que el correo advierte',
  )
})

test('[500] cuenta LIQUIDACIONES recibidas, no las boletas de venta', () => {
  // las boletas a compradores son decenas al mes; las liquidaciones que ML
  // emite al vendedor fueron 4 en agosto, una por semana. El casillero pide
  // las segundas: poner las primeras es la inconsistencia que el aviso evita.
  const c500 = codigosF29({ debitoIvaClp: 96999, documentos: 4, fuenteRcv: true }).find((c) => c.codigo === 500)
  assert.equal(c500.valor, 4)
  assert.equal(c500.unidad, 'documentos')
})

test('sin documentos sincronizados el casillero queda VACÍO, no en 1', () => {
  for (const d of [null, 0, undefined]) {
    const c = codigosF29({ debitoIvaClp: 1000, comisionClp: 100, documentos: d }).find((x) => x.codigo === 500)
    assert.equal(c.valor, null, `documentos=${d} no puede inventar un documento`)
    assert.ok(c.falta, 'y tiene que decir qué falta para llenarlo')
  }
})

test('[519]/[520] son la línea GENERAL de facturas recibidas, no del mandato', () => {
  // Corrección del 25-ago tras leer el instructivo oficial (línea 28): el
  // [519] cuenta "facturas recibidas que dan derecho a crédito fiscal" y el
  // [520] su crédito. No son "los mismos documentos del [500]" — la comisión
  // de ML entra ahí como una factura más, si es que ML la emite.
  const cs = codigosF29({
    debitoIvaClp: 96999,
    documentos: 4,
    credito: { documentos: 2, ivaCreditoClp: 31000 },
    fuenteRcv: true,
  })
  const c519 = cs.find((c) => c.codigo === 519)
  const c520 = cs.find((c) => c.codigo === 520)
  assert.equal(c519.valor, 2, 'cuenta las facturas del registro de compras')
  assert.notEqual(c519.valor, cs.find((c) => c.codigo === 500).valor, 'y NO copia el [500]')
  assert.equal(c520.valor, 31000)
  assert.equal(c520.falta, null)
})

test('[520] en cero avisa que falta la factura de la comisión', () => {
  // el caso real de agosto: 4 liquidaciones en compras con montos en cero y
  // ninguna factura de ML. Sin ese documento no hay crédito, y que las
  // pendientes pasen a REGISTRO no lo cambia.
  const cs = codigosF29({ debitoIvaClp: 96999, documentos: 4, credito: { documentos: 0, ivaCreditoClp: 0 }, fuenteRcv: true })
  const c520 = cs.find((c) => c.codigo === 520)
  assert.equal(c520.valor, 0)
  assert.match(c520.falta, /comisión/i)
  assert.match(cs.find((c) => c.codigo === 519).falta, /comisión/i)
})

test('sin RCV el [520] cae a lo medido y sigue con su rango', () => {
  const c = codigosF29({ comisionClp: 60_000 }).find((x) => x.codigo === 520)
  assert.equal(c.valor, 9580)
  assert.equal(c.valorSiNeto, 11_400)
  assert.equal(c.baseClp, 60_000)
  assert.ok(c.falta)
})

test('[501] lleva el IVA débito, no el bruto ni el neto', () => {
  const c = codigosF29({ debitoIvaClp: 22_287, comisionClp: 0, documentos: 1 }).find((x) => x.codigo === 501)
  assert.equal(c.valor, 22_287)
  assert.equal(c.unidad, 'clp')
})

// ─────────────────────────────────────────────────────────────────────────────
// LA DIN NO APLICA HASTA QUE LLEGUE LA PRIMERA CARGA (octubre 2026)

test('la DIN no está en juego mientras no haya llegado carga', () => {
  // el aviso valía millones... el día que aplique. En agosto no hay ninguna
  // importación que declarar y la alerta solo tapa los casilleros del mandato.
  assert.equal(importacionesEnJuego('2026-08', '2026-10'), false)
  assert.equal(importacionesEnJuego('2026-09', '2026-10'), false)
})

test('se prende sola en el período de la primera carga y no se apaga más', () => {
  assert.equal(importacionesEnJuego('2026-10', '2026-10'), true, 'el mes mismo ya cuenta')
  assert.equal(importacionesEnJuego('2026-11', '2026-10'), true)
  assert.equal(importacionesEnJuego('2027-03', '2026-10'), true, 'no se apaga al cambiar de año')
})

test('con la fecha de corte rota se prende igual: el error barato es hacia el aviso', () => {
  // perder el crédito de una DIN por un typo en una env var cuesta el IVA de
  // una importación entera; avisar de más cuesta una línea en pantalla
  for (const roto of ['', 'octubre', '2026', '2026-13-01', null]) {
    assert.equal(importacionesEnJuego('2026-08', roto), true, `corte "${roto}" no puede apagar el aviso`)
  }
  // omitirlo es otra cosa: significa "usa el corte configurado", no "está roto"
  assert.equal(importacionesEnJuego('2026-08'), false)
})

test('un período con formato inválido no prende el aviso', () => {
  assert.equal(importacionesEnJuego('agosto', '2026-10'), false)
  assert.equal(importacionesEnJuego(null, '2026-10'), false)
})
