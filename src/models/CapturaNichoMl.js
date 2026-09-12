import mongoose from 'mongoose'

// Evidencia del scan antes de mezclarla con Producto (que contiene el último
// estado mutable). Cada revisión conserva cuándo estuvo realmente disponible.
const schema = new mongoose.Schema({
  huella: { type: String, required: true, unique: true },
  nichoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nicho', required: true },
  keyword: { type: String, required: true },
  keywordDemanda: { type: String, required: true },
  fuente: { type: String, enum: ['zyte'], required: true },
  fase: { type: String, enum: ['listado', 'detalle'], required: true },
  fechaScan: { type: Date, required: true },
  capturadoEl: { type: Date, required: true },
  productos: { type: [mongoose.Schema.Types.Mixed], required: true },
}, { versionKey: false })
schema.index({ nichoId: 1, capturadoEl: -1 })
schema.index({ nichoId: 1, fechaScan: 1, capturadoEl: -1 })
export const CapturaNichoMl = mongoose.model('CapturaNichoMl', schema)
