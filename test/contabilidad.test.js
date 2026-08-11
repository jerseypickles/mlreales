import test from 'node:test'
import assert from 'node:assert/strict'
import { desglosarIva, rangoDelMes, IVA_PCT } from '../src/services/contabilidad.js'

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

test('rangoDelMes: diciembre cierra en enero del año siguiente', () => {
  const { desde, hasta } = rangoDelMes('2026-12')
  assert.equal(desde.toISOString(), '2026-12-01T04:00:00.000Z')
  assert.equal(hasta.toISOString(), '2027-01-01T04:00:00.000Z')
})
