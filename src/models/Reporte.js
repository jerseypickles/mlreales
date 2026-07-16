import mongoose from 'mongoose'

const reporteSchema = new mongoose.Schema({
  nichoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nicho', required: true },
  keyword: String,
  fecha: { type: Date, required: true }, // fecha del scan que originó el reporte
  metricas: mongoose.Schema.Types.Mixed,
  topProductos: { type: [mongoose.Schema.Types.Mixed], default: [] },
  topSellers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  scoreOportunidad: { type: Number, default: null }, // Fase 2
  analisis: { type: mongoose.Schema.Types.Mixed, default: null }, // veredicto IA (analista.js)
  creadoEl: { type: Date, default: Date.now },
})

reporteSchema.index({ nichoId: 1, fecha: -1 })

export const Reporte = mongoose.model('Reporte', reporteSchema)
