import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  huella: { type: String, required: true, unique: true },
  keyword: { type: String, required: true, index: true },
  fuente: { type: String, default: 'google-ads' },
  pais: { type: Number, required: true },
  idioma: { type: String, required: true },
  meses: [{ _id: false, periodo: String, valor: Number }],
  capturadoEl: { type: Date, required: true },
}, { versionKey: false })
schema.index({ keyword: 1, capturadoEl: -1 })
export const SerieNichoMl = mongoose.model('SerieNichoMl', schema)
