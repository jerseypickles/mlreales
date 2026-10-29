import mongoose from 'mongoose'

// Solo observación de ML. No atribuye el cambio a una persona ni ejecuta ajustes.
const schema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true },
  campanaId: { type: Number, required: true },
  observadoEl: { type: Date, required: true },
  ultimaVistaEl: { type: Date, required: true },
  anteriorVistaEl: { type: Date, default: null },
  anteriorDesde: { type: Date, default: null },
  antes: { type: mongoose.Schema.Types.Mixed, default: null },
  despues: { type: mongoose.Schema.Types.Mixed, required: true },
  recomendaciones: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { versionKey: false })
schema.index({ campanaId: 1, observadoEl: -1 })
export const CambioCampanaMl = mongoose.model('CambioCampanaMl', schema)
