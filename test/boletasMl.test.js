import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizarBoleta } from '../src/services/boletasMl.js'

// Documento REAL de la cuenta, sondeado el 10-ago-2026 desde
// /users/3553763576/invoices/orders/2000017866802252. Es la referencia del
// mapeo y la prueba de quién emite qué.

const BOLETA_REAL = {
  id: 5000000087638004,
  status: 'authorized',
  issuer: {
    user_id: '3553763576',
    name: 'MercadoLibre Chile LTDA',
    identifications: { rut: '773982201' },
  },
  recipient: { name: 'Lilian Rios', identifications: { rut: '151131506' } },
  shipment: { logistic_type: 'fulfillment' },
  issued_date: '2026-08-10T23:19:16.000Z',
  invoice_series: 39,
  invoice_number: 140186101,
  amount: 5990,
  attributes: { document_type: 'BOLETA', invoice_source: 'internal' },
  fiscal_data: {
    customer_type: 'b2c',
    transaction_type: 'sale',
    messages: [{ type: 'COMPL', content: 'Por cuenta y orden de CRISTOPHER MUÑOZ COMERCIAL E IMPORTADORA E.I.R.L..' }],
    fiscal_amounts: [
      { name: 'IVA', attributes: { piva: 19, viva: 956, biva: 5033 } },
      { name: 'AMOUNTS', attributes: { net_value: 5034, gross_value: 5990 } },
    ],
  },
}

test('el emisor material es Mercado Libre, con su propio RUT', () => {
  const b = normalizarBoleta(BOLETA_REAL)
  assert.equal(b.emisorNombre, 'MercadoLibre Chile LTDA')
  assert.equal(b.emisorRut, '773982201')
})

test('pero va POR CUENTA Y ORDEN del vendedor: por eso el débito es suyo', () => {
  // la diferencia entre "ML me compró y revendió" (el débito no sería mío) y
  // "ML facturó en mi nombre" (el débito es mío) está en este mensaje
  const b = normalizarBoleta(BOLETA_REAL)
  assert.equal(b.porCuentaDe, 'CRISTOPHER MUÑOZ COMERCIAL E IMPORTADORA E.I.R.L')
})

test('el desglose fiscal viene en el documento: no hay que estimarlo', () => {
  const b = normalizarBoleta(BOLETA_REAL)
  assert.equal(b.netoClp, 5034)
  assert.equal(b.ivaClp, 956)
  assert.equal(b.brutoClp, 5990)
  assert.equal(b.ivaPct, 19)
  assert.equal(b.netoClp + b.ivaClp, b.brutoClp)
})

test('identifica el tipo de documento y su folio', () => {
  const b = normalizarBoleta(BOLETA_REAL)
  assert.equal(b.tipo, 'BOLETA')
  assert.equal(b.serie, 39)
  assert.equal(b.folio, 140186101)
  assert.equal(b.estado, 'authorized')
})

test('una orden sin documento emitido no se guarda a medias', () => {
  assert.equal(normalizarBoleta(null), null)
  assert.equal(normalizarBoleta({}), null)
})

test('un documento sin mandato deja porCuentaDe en null, no inventa', () => {
  const sinMandato = { ...BOLETA_REAL, fiscal_data: { ...BOLETA_REAL.fiscal_data, messages: [] } }
  assert.equal(normalizarBoleta(sinMandato).porCuentaDe, null)
})
