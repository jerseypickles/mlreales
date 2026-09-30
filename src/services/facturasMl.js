import { FacturaMl } from '../models/FacturaMl.js'
import { meliGet, meliGetTexto, hayCuentaMeli } from './meli.js'

// Sincroniza las facturas (y notas de crédito) que ML emite por sus cargos,
// con el DTE leído del XML. Ver models/FacturaMl.js.
//
// El endpoint de facturación acepta 5 pedidos por minuto: cada pedido espera
// 13 s, y el XML de cada documento se baja UNA vez (después solo se refresca
// estado e impago, que cambian cuando ML descuenta de tus ventas).

const PAUSA_MS = 13_000
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const etiqueta = (xml, nombre) => {
  const m = new RegExp(`<${nombre}>([^<]*)</${nombre}>`).exec(xml)
  return m ? m[1].trim() : null
}
const entero = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null)

// Pura. El DTE del SII → lo que importa para el F29. null si no es un DTE.
export function parsearDte(xml) {
  if (!/<(DTE|Documento)\b/.test(xml ?? '')) return null
  const tipoDte = entero(etiqueta(xml, 'TipoDTE'))
  const folio = entero(etiqueta(xml, 'Folio'))
  if (!tipoDte || !folio) return null
  return {
    tipoDte, folio,
    fechaEmision: etiqueta(xml, 'FchEmis'),
    rutEmisor: etiqueta(xml, 'RUTEmisor'),
    netoClp: entero(etiqueta(xml, 'MntNeto')) ?? 0,
    exentoClp: entero(etiqueta(xml, 'MntExe')) ?? 0,
    ivaClp: entero(etiqueta(xml, 'IVA')) ?? 0,
    totalClp: entero(etiqueta(xml, 'MntTotal')) ?? 0,
  }
}

export async function sincronizarFacturasMl({ periodos = 6 } = {}) {
  if (!(await hayCuentaMeli())) return { omitido: true, motivo: 'sin cuenta ML conectada' }
  const per = await meliGet(`/billing/integration/monthly/periods?group=ML&document_type=BILL&limit=${periodos}`)
  let documentos = 0, leidos = 0, frenado = false
  for (const p of per?.results ?? []) {
    if (frenado) break
    await esperar(PAUSA_MS)
    let r
    try {
      r = await meliGet(`/billing/integration/periods/key/${p.key}/documents?group=ML&limit=100`)
    } catch (err) {
      if (/\b429\b/.test(err.message)) { frenado = true; break }
      throw err
    }
    for (const d of r?.results ?? []) {
      documentos++
      const archivos = (d.files ?? []).map((f) => ({ fileId: String(f.file_id), referencia: f.reference_number ?? null }))
      await FacturaMl.updateOne({ documentId: String(d.id) }, { $set: {
        tipoDocumento: d.document_type ?? null, estadoMl: d.document_status ?? null, periodoKey: p.key,
        ventanaDesde: d.period?.date_from ?? null, ventanaHasta: d.period?.date_to ?? null,
        montoMlClp: entero(d.amount), impagoClp: entero(d.unpaid_amount), vence: d.expiration_date ?? null, archivos, actualizadoEl: new Date(),
      } }, { upsert: true })
      const guardada = await FacturaMl.findOne({ documentId: String(d.id) }).select('xmlLeidoEl').lean()
      if (guardada?.xmlLeidoEl || !archivos.length) continue
      // dos archivos (PDF y XML) sin decir cuál es cuál: se prueba cada uno
      for (const a of archivos) {
        await esperar(PAUSA_MS)
        let doc
        try {
          doc = await meliGetTexto(`/billing/integration/legal_document/${a.fileId}`)
        } catch (err) {
          if (/\b429\b/.test(err.message)) { frenado = true; break }
          continue
        }
        const dte = /xml/i.test(doc.tipo ?? '') || /^\s*</.test(doc.texto) ? parsearDte(doc.texto) : null
        if (!dte) continue
        await FacturaMl.updateOne({ documentId: String(d.id) }, { $set: { ...dte, xmlLeidoEl: new Date() } })
        leidos++
        break
      }
      if (frenado) break
    }
  }
  if (documentos) console.log(`[facturas-ml] ${documentos} documento(s) de ML · ${leidos} XML leído(s)${frenado ? ' · ML frenó (429), sigue en la próxima pasada' : ''}`)
  return { documentos, leidos, frenado }
}

// Las facturas y notas de crédito de ML EMITIDAS en el mes (la fecha del DTE
// decide el F29, no la ventana de facturación de ML).
export async function facturasMlDelMes(periodo) {
  const docs = await FacturaMl.find({ fechaEmision: { $gte: `${periodo}-01`, $lte: `${periodo}-31` } }).lean()
  const facturas = docs.filter((d) => d.tipoDte === 33 || d.tipoDte === 34)
  const notas = docs.filter((d) => d.tipoDte === 61)
  const suma = (xs, k) => xs.reduce((a, d) => a + (d[k] ?? 0), 0)
  return {
    facturas: facturas.length, ivaFacturas: suma(facturas, 'ivaClp'), netoFacturas: suma(facturas, 'netoClp'), totalFacturas: suma(facturas, 'totalClp'),
    notas: notas.length, ivaNotas: suma(notas, 'ivaClp'), netoNotas: suma(notas, 'netoClp'),
    detalle: docs.map((d) => ({ tipoDte: d.tipoDte, folio: d.folio, fechaEmision: d.fechaEmision, netoClp: d.netoClp, ivaClp: d.ivaClp, totalClp: d.totalClp, impagoClp: d.impagoClp, vence: d.vence, ventana: d.ventanaDesde ? `${d.ventanaDesde} a ${d.ventanaHasta}` : null })),
    // documentos de ML cuya fecha todavía no se conoce (sin XML): pueden caer acá
    sinLeer: await FacturaMl.countDocuments({ xmlLeidoEl: null, 'archivos.0': { $exists: true } }),
  }
}
