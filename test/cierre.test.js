import test from 'node:test'
import assert from 'node:assert/strict'
import { cierreDelPeriodo, fechaDocumento } from '../src/services/contabilidad.js'

// "Necesito control, porque si cierra ML, ¿cierra el SII o no?" — no, y por eso
// existe esto. Tres relojes sobre el mismo mes y lo que decide es la FECHA DEL
// DOCUMENTO, no el cierre de nadie.

const rcvAgosto = {
  documentos: 4,
  detalle: [
    { folio: 1087194, fecha: '23/08/2026' },
    { folio: 1081925, fecha: '16/08/2026' },
    { folio: 1073915, fecha: '09/08/2026' },
    { folio: 1068187, fecha: '02/08/2026' },
  ],
}
const mlAbierto = { desde: '2026-07-29', hasta: '2026-08-25', estado: 'OPEN', totalClp: 515364, medidoClp: 494604, descuadreClp: 20760 }
const mlCerrado = { ...mlAbierto, estado: 'CLOSED', descuadreClp: 0 }
const chequeo = (r, id) => r.chequeos.find((c) => c.id === id)

test('fechaDocumento: DD/MM/AAAA, que es lo que da el RCV', () => {
  assert.equal(fechaDocumento('23/08/2026').toISOString().slice(0, 10), '2026-08-23')
  assert.equal(fechaDocumento('02/08/2026').toISOString().slice(0, 10), '2026-08-02')
  assert.equal(fechaDocumento('2026-08-23'), null, 'el ISO no es el formato del RCV')
  assert.equal(fechaDocumento(null), null)
})

test('con el mes abierto, las liquicaciones que faltan son ESPERA, no alerta', () => {
  // el 25-ago faltan las de la última semana y eso es normal: distinguir
  // "falta que llegue" de "falta que hagas algo" es la mitad del valor
  const r = cierreDelPeriodo({ periodo: '2026-08', rcv: rcvAgosto, credito: { ivaCreditoClp: 0 }, periodoMl: mlAbierto, hoy: new Date('2026-08-25T20:00:00Z') })
  assert.equal(chequeo(r, 'liquidaciones').estado, 'esperando')
  assert.equal(r.mesCerrado, false)
  assert.equal(r.puedeDeclarar, false)
})

test('con el mes cerrado y la última liquidación vieja, es ALERTA', () => {
  // la del 23/08 con el mes cerrado el 31 deja una semana sin documentar: ese
  // IVA es débito que no se estaría declarando
  const r = cierreDelPeriodo({ periodo: '2026-08', rcv: rcvAgosto, credito: { ivaCreditoClp: 5000, documentos: 1 }, periodoMl: mlCerrado, hoy: new Date('2026-09-03T12:00:00Z') })
  assert.equal(chequeo(r, 'liquidaciones').estado, 'alerta')
  assert.match(chequeo(r, 'liquidaciones').detalle, /falta al menos un documento/)
})

test('una liquidación dentro de la holgura cierra el mes en verde', () => {
  const rcv = { documentos: 5, detalle: [...rcvAgosto.detalle, { folio: 1092000, fecha: '30/08/2026' }] }
  const r = cierreDelPeriodo({ periodo: '2026-08', rcv, credito: { ivaCreditoClp: 78794, documentos: 1 }, periodoMl: mlCerrado, hoy: new Date('2026-09-03T12:00:00Z') })
  assert.equal(chequeo(r, 'liquidaciones').estado, 'ok')
  assert.equal(r.puedeDeclarar, true, 'los tres en verde: se puede declarar')
})

test('ML con su período ABIERTO: la factura no existe y eso es esperar', () => {
  const r = cierreDelPeriodo({ periodo: '2026-08', rcv: rcvAgosto, credito: { ivaCreditoClp: 0 }, periodoMl: mlAbierto, hoy: new Date('2026-08-25T20:00:00Z') })
  assert.equal(chequeo(r, 'factura-cargos').estado, 'esperando')
  assert.match(chequeo(r, 'factura-cargos').detalle, /sigue abierto/)
})

test('ML cerró y NO emitió: alerta, con el riesgo dicho', () => {
  // el caso que preocupa: crédito que se va al F29 del mes siguiente
  const r = cierreDelPeriodo({ periodo: '2026-08', rcv: rcvAgosto, credito: { ivaCreditoClp: 0 }, periodoMl: mlCerrado, hoy: new Date('2026-09-03T12:00:00Z') })
  const c = chequeo(r, 'factura-cargos')
  assert.equal(c.estado, 'alerta')
  assert.match(c.detalle, /mes siguiente/)
})

test('el descuadre contra lo que ML declara se marca en plata', () => {
  const r = cierreDelPeriodo({ periodo: '2026-08', rcv: rcvAgosto, credito: { ivaCreditoClp: 0 }, periodoMl: mlAbierto, hoy: new Date('2026-08-25T20:00:00Z') })
  const c = chequeo(r, 'descuadre')
  assert.equal(c.estado, 'alerta')
  assert.match(c.detalle, /20\.760/, 'el monto tiene que estar a la vista')
})

test('un descuadre de redondeo NO es alerta', () => {
  const r = cierreDelPeriodo({ periodo: '2026-08', rcv: rcvAgosto, credito: { ivaCreditoClp: 1 }, periodoMl: { ...mlCerrado, descuadreClp: -12 }, hoy: new Date('2026-09-03T12:00:00Z') })
  assert.equal(chequeo(r, 'descuadre').estado, 'ok')
})

test('sin sesión del SII no se inventa un verde', () => {
  const r = cierreDelPeriodo({ periodo: '2026-08', rcv: { error: 'no hay sesión' }, credito: { error: 'no hay sesión' }, periodoMl: mlAbierto, hoy: new Date('2026-08-25T20:00:00Z') })
  assert.equal(chequeo(r, 'liquidaciones').estado, 'sin_datos')
  assert.equal(r.puedeDeclarar, false)
})

test('los tres relojes viajan con sus fechas, que es de lo que se trata', () => {
  const r = cierreDelPeriodo({ periodo: '2026-08', rcv: rcvAgosto, credito: {}, periodoMl: mlAbierto, hoy: new Date('2026-08-25T20:00:00Z') })
  assert.deepEqual(r.relojes.ml, { desde: '2026-07-29', hasta: '2026-08-25', estado: 'OPEN' })
  assert.deepEqual(r.relojes.sii, { desde: '2026-08-01', hasta: '2026-08-31' })
  assert.equal(r.relojes.ultimaLiquidacion, '2026-08-23')
})
