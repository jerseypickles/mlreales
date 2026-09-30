import mongoose from 'mongoose'

// LO QUE SE DECLARÓ, POR MES. No existe API del SII para presentar el F29 ni
// para saber si se presentó: el importador lo marca al hacerlo. Con eso el
// panel sabe qué meses están al día, cuáles atrasados y el remanente de
// crédito que pasa al mes siguiente ([77] → [504]).
const schema = new mongoose.Schema({
  periodo: { type: String, required: true, unique: true }, // AAAA-MM
  declaradoEl: { type: String, required: true }, // AAAA-MM-DD
  folio: { type: String, default: null },
  pagadoClp: { type: Number, default: null }, // lo que se pagó, con multa e intereses si hubo
  remanenteClp: { type: Number, default: null }, // [77] declarado, si quedó crédito a favor
  notas: { type: String, default: null },
  actualizadoEl: { type: Date, default: Date.now },
}, { versionKey: false })
export const DeclaracionF29 = mongoose.models.DeclaracionF29 ?? mongoose.model('DeclaracionF29', schema)
