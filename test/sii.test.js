import test from 'node:test'
import assert from 'node:assert/strict'
import { parsearCookies, expiracionDe, resumirLiquidaciones, TIPO_LIQUIDACION_FACTURA } from '../src/services/sii.js'

// Los datos son los REALES capturados del RCV el 25-ago-2026 sobre el período
// 202608. No son inventados: si el SII cambia la forma, estos tests fallan y
// eso es exactamente lo que queremos que pase.

const VENTAS = [
  { folio: 1087194, fecha: '23/08/2026', razonSocial: 'MercadoLibre Chile LTDA', netoClp: 282928, ivaClp: 53748, exentoClp: 0, totalClp: 336676, comisionIvaClp: 0, estadoContab: 'REGISTRO', operacion: 'VENTA' },
  { folio: 1081925, fecha: '16/08/2026', razonSocial: 'MercadoLibre Chile LTDA', netoClp: 131347, ivaClp: 24943, exentoClp: 0, totalClp: 156290, comisionIvaClp: 0, estadoContab: 'REGISTRO', operacion: 'VENTA' },
  { folio: 1073915, fecha: '09/08/2026', razonSocial: 'MercadoLibre Chile LTDA', netoClp: 94729, ivaClp: 18015, exentoClp: 0, totalClp: 112744, comisionIvaClp: 0, estadoContab: 'REGISTRO', operacion: 'VENTA' },
  { folio: 1068187, fecha: '02/08/2026', razonSocial: 'MercadoLibre Chile LTDA', netoClp: 1540, ivaClp: 293, exentoClp: 0, totalClp: 1833, comisionIvaClp: 0, estadoContab: 'REGISTRO', operacion: 'VENTA' },
]

// los MISMOS folios por el otro registro, en cero y repartidos en dos estados
const COMPRAS = [
  { folio: 1073915, fecha: '09/08/2026', razonSocial: 'MercadoLibre Chile LTDA', netoClp: 0, ivaClp: 0, totalClp: 0, comisionIvaClp: null, evento: 'No reclamado en plazo', estadoContab: 'REGISTRO', operacion: 'COMPRA' },
  { folio: 1068187, fecha: '02/08/2026', razonSocial: 'MercadoLibre Chile LTDA', netoClp: 0, ivaClp: 0, totalClp: 0, comisionIvaClp: null, evento: 'No reclamado en plazo', estadoContab: 'REGISTRO', operacion: 'COMPRA' },
  { folio: 1087194, fecha: '23/08/2026', razonSocial: 'MercadoLibre Chile LTDA', netoClp: 0, ivaClp: 0, totalClp: 0, comisionIvaClp: null, evento: null, estadoContab: 'PENDIENTE', operacion: 'COMPRA' },
  { folio: 1081925, fecha: '16/08/2026', razonSocial: 'MercadoLibre Chile LTDA', netoClp: 0, ivaClp: 0, totalClp: 0, comisionIvaClp: null, evento: null, estadoContab: 'PENDIENTE', operacion: 'COMPRA' },
]

const agosto = () => resumirLiquidaciones({ periodo: '2026-08', ventas: VENTAS, compras: COMPRAS })

test('el tipo de la liquidación factura es 43', () => {
  assert.equal(TIPO_LIQUIDACION_FACTURA, 43)
})

test('[500]/[519]: cuenta FOLIOS distintos, no filas de los dos registros', () => {
  // los 4 documentos llegan por ventas Y por compras: 8 filas, 4 documentos.
  // Contar filas declararía 8 donde son 4.
  assert.equal(agosto().documentos, 4)
})

test('[501]: el IVA débito sale del registro de VENTAS', () => {
  assert.equal(agosto().ivaDebitoClp, 293 + 18015 + 24943 + 53748)
  assert.equal(agosto().ivaDebitoClp, 96999)
})

test('los montos de compras NO pueden pisar a los de ventas', () => {
  // el bug que tuvo esta función: fusionar por folio dejando que la fila de
  // compras (todo en cero) sobreescribiera la de ventas. La tabla quedaba en
  // cero y el débito en nada.
  const r = agosto()
  assert.equal(r.netoVentasClp, 510544)
  assert.equal(r.totalVentasClp, 607543)
  for (const d of r.detalle) assert.ok(d.totalClp > 0, `folio ${d.folio} quedó en cero`)
})

test('el estado de aceptación viene del registro de COMPRAS', () => {
  const r = agosto()
  assert.equal(r.pendientes, 2, 'los del 16 y 23 de agosto siguen en plazo')
  const f = Object.fromEntries(r.detalle.map((d) => [d.folio, d.estadoContab]))
  assert.equal(f[1068187], 'REGISTRO')
  assert.equal(f[1087194], 'PENDIENTE')
})

test('[520]: si ML no puebla la comisión, se devuelve null y no un cero', () => {
  // detLiqValComIVA viene en null/0 en la cuenta real. Un 0 se leería como
  // "la comisión no tiene IVA"; null dice "no está en el documento".
  const r = agosto()
  assert.equal(r.ivaComisionClp, null)
  assert.equal(r.comisionEnElDocumento, false)
})

test('[520]: si algún día ML la puebla, se suma sola', () => {
  const compras = COMPRAS.map((c) => ({ ...c, comisionIvaClp: 1000 }))
  const r = resumirLiquidaciones({ periodo: '2026-08', ventas: VENTAS, compras })
  assert.equal(r.ivaComisionClp, 4000)
  assert.equal(r.comisionEnElDocumento, true)
})

test('un período sin liquidaciones no inventa documentos', () => {
  const r = resumirLiquidaciones({ periodo: '2026-07', ventas: [], compras: [] })
  assert.equal(r.documentos, 0)
  assert.equal(r.ivaDebitoClp, 0)
  assert.deepEqual(r.detalle, [])
})

test('el detalle sale del folio más nuevo al más viejo', () => {
  assert.deepEqual(agosto().detalle.map((d) => d.folio), [1087194, 1081925, 1073915, 1068187])
})

// ── la sesión ────────────────────────────────────────────────────────────────

test('parsearCookies: un valor con "=" adentro no se parte a la mitad', () => {
  // NETSCAPE_LIVEWIRE.clave trae un hash bcrypt lleno de '/' y '='; partir por
  // todos los '=' lo dejaría truncado y la sesión no serviría
  const c = parsearCookies('TOKEN=ABC123; NETSCAPE_LIVEWIRE.clave=$2a$10$auROx/4v1QO=weFU; RUT_NS=78469441')
  assert.equal(c.get('TOKEN'), 'ABC123')
  assert.equal(c.get('NETSCAPE_LIVEWIRE.clave'), '$2a$10$auROx/4v1QO=weFU')
  assert.equal(c.get('RUT_NS'), '78469441')
})

test('expiracionDe: manda locexp, que viene en GMT explícito', () => {
  const c = parsearCookies('NETSCAPE_LIVEWIRE.locexp=Tue%2C%2025%20Aug%202026%2022%3A47%3A33%20GMT')
  assert.equal(expiracionDe(c).toISOString(), '2026-08-25T22:47:33.000Z')
})

test('expiracionDe: sin locexp cae a exp, que es hora de Chile y no UTC', () => {
  // leerla como UTC daría una sesión 4 horas más viva de lo que está, y las
  // llamadas fallarían con HTML en vez de avisar que hay que reconectar
  const c = parsearCookies('NETSCAPE_LIVEWIRE.exp=20260825184733')
  assert.equal(expiracionDe(c).toISOString(), '2026-08-25T22:47:33.000Z')
})

test('expiracionDe: sin ninguna de las dos devuelve null, no una fecha inventada', () => {
  assert.equal(expiracionDe(parsearCookies('TOKEN=ABC')), null)
  assert.equal(expiracionDe(parsearCookies('NETSCAPE_LIVEWIRE.exp=nodigits')), null)
})
