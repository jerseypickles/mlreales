import test from 'node:test'
import assert from 'node:assert/strict'
import { parsearDte } from '../src/services/facturasMl.js'
import { vencimientoF29, estadoF29, armarF29, liquidacionesEstimadas, mesesDesde } from '../src/services/f29.js'

// el DTE real de la factura de ML de agosto 2026 (sin firma)
const XML_AGOSTO = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0" xmlns="http://www.sii.cl/SiiDte"><Documento ID="DTE_ML_33_15288301"><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>15288301</Folio><FchEmis>2026-08-25</FchEmis></IdDoc>
<Emisor><RUTEmisor>77398220-1</RUTEmisor><RznSoc>MercadoLibre Chile Ltda.</RznSoc></Emisor><Receptor><RUTRecep>78469441-0</RUTRecep></Receptor>
<Totales><MntNeto>443681</MntNeto><MntExe>0</MntExe><TasaIVA>19</TasaIVA><IVA>84299</IVA><MntTotal>527981</MntTotal></Totales></Encabezado></Documento></DTE>`

test('parsearDte: la factura de ML de agosto', () => {
  const d = parsearDte(XML_AGOSTO)
  assert.deepEqual(d, { tipoDte: 33, folio: 15288301, fechaEmision: '2026-08-25', rutEmisor: '77398220-1', netoClp: 443681, exentoClp: 0, ivaClp: 84299, totalClp: 527981 })
  assert.equal(parsearDte('%PDF-1.4 ...'), null)
  assert.equal(parsearDte(''), null)
})

test('vencimientoF29: día 20 del mes siguiente, corrido al lunes si cae fin de semana', () => {
  assert.equal(vencimientoF29('2026-08'), '2026-09-21') // 20-sep-2026 es domingo
  assert.equal(vencimientoF29('2026-09'), '2026-10-20') // martes
  assert.equal(vencimientoF29('2026-12'), '2027-01-20')
})

test('estadoF29: atrasado, por declarar, en curso y declarado', () => {
  const hoy = new Date('2026-09-30T15:00:00Z')
  assert.deepEqual(estadoF29('2026-08', { hoy }), { vence: '2026-09-21', estado: 'atrasado', diasAtraso: 9 })
  assert.equal(estadoF29('2026-09', { hoy }).estado, 'mes-en-curso')
  assert.equal(estadoF29('2026-09', { hoy: new Date('2026-10-17T12:00:00Z') }).estado, 'vence-pronto')
  const d = estadoF29('2026-07', { hoy, declaracion: { declaradoEl: '2026-08-25' } })
  assert.equal(d.estado, 'declarado')
  assert.equal(d.diasAtraso, 5) // venció el 20-08
})

test('armarF29: débito, crédito, notas, DIN, remanente, PPM y total', () => {
  const f = armarF29({
    debito: { documentos: 5, ivaClp: 134395, fuente: 'boletas' },
    credito: { documentos: 1, ivaClp: 84299, fuente: 'factura ML' },
    notasCredito: { documentos: 1, ivaClp: 457, fuente: 'NC ML' },
    din: { documentos: 0, ivaClp: 0 },
    remanenteAnterior: 1000,
    ventasNetasClp: 707341,
  })
  assert.equal(f.ivaAPagar, 134395 - (84299 - 457) - 1000)
  assert.equal(f.ppm, 7073)
  assert.equal(f.totalAPagar, f.ivaAPagar + 7073)
  const cod = new Map(f.codigos.map((c) => [c.codigo, c.valor]))
  assert.equal(cod.get(91), f.totalAPagar)
  assert.equal(cod.get(528), 457)
  // con una DIN grande queda remanente y no se paga IVA
  const g = armarF29({ debito: { documentos: 5, ivaClp: 100000 }, credito: { documentos: 1, ivaClp: 80000 }, din: { documentos: 1, ivaClp: 500000 }, ventasNetasClp: 500000 })
  assert.equal(g.ivaAPagar, 0)
  assert.equal(g.remanente, 480000)
  assert.equal(g.totalAPagar, 5000) // el PPM se paga igual
  assert.ok(g.codigos.some((c) => c.codigo === 77))
})

test('liquidacionesEstimadas: una por domingo con ventas la semana anterior', () => {
  const dias = new Set(['2026-08-01', '2026-08-05', '2026-08-12', '2026-08-20', '2026-08-28'])
  assert.equal(liquidacionesEstimadas('2026-08', dias), 5) // domingos 2, 9, 16, 23 y 30
  assert.equal(liquidacionesEstimadas('2026-08', new Set(['2026-08-05'])), 1)
})

test('mesesDesde', () => {
  assert.deepEqual(mesesDesde('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02'])
})
