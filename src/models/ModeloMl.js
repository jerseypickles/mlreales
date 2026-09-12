import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  huella: { type: String, required: true, unique: true },
  objetivo: { type: String, required: true, enum: ['busquedas-google', 'unidades-por-visita', 'unidades-por-visita-contexto'] },
  creadoEl: { type: Date, default: Date.now },
  // El registro incluye algoritmo, variables, hiperparámetros, cobertura,
  // evaluación independiente y pesos. No se promueve automáticamente.
  resultado: { type: mongoose.Schema.Types.Mixed, required: true },
}, { versionKey: false })
schema.index({ objetivo: 1, creadoEl: -1 })
export const ModeloMl = mongoose.model('ModeloMl', schema)
