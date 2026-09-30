import mongoose from 'mongoose'

// LAS FACTURAS QUE MERCADO LIBRE TE EMITE POR SUS CARGOS, leídas del DTE.
//
// Hasta el 30-sep-2026 el crédito fiscal [520] se ESTIMABA de las líneas de
// cargos (y con un supuesto sin confirmar sobre si venían con IVA) o se leía
// del RCV del SII, que exige una sesión que vence a los pocos días. La API de
// facturación de ML entrega el documento legal: una factura electrónica tipo
// 33 mensual por todo lo que ML cobra (comisión, envíos, publicidad, colecta,
// almacenaje), con su XML firmado. De ahí salen folio, fecha de emisión, neto
// e IVA exactos. Agosto 2026: folio 15288301, emitida el 25-08, neto $443.681,
// IVA $84.299, total $527.981 — el IVA venía incluido en los cargos.
//
// Las notas de crédito (tipo 61) que ML emite al anular cargos restan crédito.
const schema = new mongoose.Schema({
  documentId: { type: String, required: true, unique: true }, // id del documento en la API de ML
  tipoDocumento: { type: String, default: null }, // BILL | CREDIT_NOTE
  estadoMl: { type: String, default: null }, // BILLED | OPEN | ...
  periodoKey: { type: String, default: null }, // período de facturación de ML (AAAA-MM-01)
  ventanaDesde: { type: String, default: null },
  ventanaHasta: { type: String, default: null },
  montoMlClp: { type: Number, default: null },
  impagoClp: { type: Number, default: null },
  vence: { type: String, default: null },
  archivos: { type: [{ _id: false, fileId: String, referencia: String }], default: [] },
  // del DTE (XML): lo que cuenta para el F29
  tipoDte: { type: Number, default: null }, // 33 factura, 61 nota de crédito
  folio: { type: Number, default: null },
  fechaEmision: { type: String, default: null }, // AAAA-MM-DD: decide en qué F29 cae
  rutEmisor: { type: String, default: null },
  netoClp: { type: Number, default: null },
  exentoClp: { type: Number, default: null },
  ivaClp: { type: Number, default: null },
  totalClp: { type: Number, default: null },
  xmlLeidoEl: { type: Date, default: null },
  actualizadoEl: { type: Date, default: null },
}, { versionKey: false })
schema.index({ fechaEmision: 1 })

export const FacturaMl = mongoose.models.FacturaMl ?? mongoose.model('FacturaMl', schema)
