import mongoose from 'mongoose'

// DOCUMENTOS DE COMPRA QUE NO LLEGAN SOLOS.
//
// La DIN (Declaración de Ingreso de la importación) es el crédito de IVA más
// grande que va a tener la empresa: el IVA que se paga en aduana al internar la
// mercadería. No es un documento electrónico en el RCV del SII —se registra a
// mano, código 914— y va al F29 por su propia línea: [534] cantidad y [535]
// crédito. La primera llega en octubre de 2026 con los productos en camino.
//
// También sirve para una factura de proveedor que no esté en el RCV (sin
// sesión del SII, o no electrónica): va a [519]/[520].
const schema = new mongoose.Schema({
  tipo: { type: String, enum: ['din', 'factura'], required: true },
  fecha: { type: String, required: true }, // AAAA-MM-DD: decide el F29
  folio: { type: String, default: null }, // número de la DIN o folio de la factura
  proveedor: { type: String, default: null }, // aduana / agente / proveedor
  netoClp: { type: Number, default: 0 },
  ivaClp: { type: Number, required: true },
  totalClp: { type: Number, default: null },
  notas: { type: String, default: null },
  creadoEl: { type: Date, default: Date.now },
}, { versionKey: false })
schema.index({ fecha: 1 })
export const DocumentoCompra = mongoose.models.DocumentoCompra ?? mongoose.model('DocumentoCompra', schema)
