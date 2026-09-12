import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  huella: { type: String, required: true, unique: true },
  modeloId: { type: mongoose.Schema.Types.ObjectId, ref: 'ModeloMl', required: true },
  serieId: { type: mongoose.Schema.Types.ObjectId, ref: 'SerieNichoMl', required: true },
  keyword: { type: String, required: true },
  emitidoEl: { type: Date, required: true },
  periodo: { type: String, required: true },
  datos: { type: mongoose.Schema.Types.Mixed, required: true },
  // Se adjunta el resultado observado sin reescribir la predicción original.
  evaluacion: { type: mongoose.Schema.Types.Mixed, default: null },
}, { versionKey: false })
schema.index({ keyword: 1, emitidoEl: -1 })
schema.index({ periodo: 1, 'evaluacion.medidoEl': 1 })
export const PrediccionMl = mongoose.model('PrediccionMl', schema)
