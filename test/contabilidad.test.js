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

test('[500] y [519] cuentan LIQUIDACIONES, no las boletas de venta', () => {
  // las boletas a compradores son decenas al mes; los documentos que ML emite
  // al vendedor, uno. El casillero pide lo segundo: poner el primero es
  // exactamente la inconsistencia que el aviso del SII pide evitar.
  const cs = codigosF29({ debitoIvaClp: 22_287, comisionClp: 50_000, documentos: 1 })
  const c500 = cs.find((c) => c.codigo === 500)
  const c519 = cs.find((c) => c.codigo === 519)
  assert.equal(c500.valor, 1)
  assert.equal(c500.unidad, 'documentos')
  assert.equal(c519.valor, c500.valor, 'la liquidación factura sirve a los dos lados: es el mismo documento')
})

test('sin documentos sincronizados el casillero queda VACÍO, no en 1', () => {
  for (const d of [null, 0, undefined]) {
    const c = codigosF29({ debitoIvaClp: 1000, comisionClp: 100, documentos: d }).find((x) => x.codigo === 500)
    assert.equal(c.valor, null, `documentos=${d} no puede inventar un documento`)
    assert.ok(c.falta, 'y tiene que decir qué falta para llenarlo')
  }
})

test('[520] es SOLO la comisión: envíos y publicidad no van en esa línea', () => {
  // agosto: ML cobró $283.939 en total pero la comisión fue $60.000. Meter el
  // total daría $45.335 de crédito donde la línea pide $9.580.
  const soloComision = codigosF29({ comisionClp: 60_000 }).find((c) => c.codigo === 520)
  const todoElCargo = codigosF29({ comisionClp: 283_939 }).find((c) => c.codigo === 520)
  assert.equal(soloComision.valor, 9580)
  assert.equal(todoElCargo.valor, 45_335)
  assert.notEqual(soloComision.valor, todoElCargo.valor)
  assert.equal(soloComision.baseClp, 60_000, 'la base queda a la vista para poder cuadrarla')
})

test('[520] viaja con su rango mientras el supuesto de IVA siga abierto', () => {
  const c = codigosF29({ comisionClp: 60_000 }).find((x) => x.codigo === 520)
  assert.equal(c.valor, 9580) // con IVA incluido
  assert.equal(c.valorSiNeto, 11_400) // si ML factura neto
  assert.ok(c.falta, 'el supuesto sin confirmar tiene que viajar con el número')
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
