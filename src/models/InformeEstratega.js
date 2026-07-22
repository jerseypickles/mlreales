import mongoose from 'mongoose'

// Informe semanal del estratega: una pasada de IA sobre el tablero completo
// (embudo, cotizaciones, tendencias, presupuesto) con acciones priorizadas.
// Se guarda la historia para comparar qué recomendó vs qué pasó.
const informeEstrategaSchema = new mongoose.Schema({
  generadoEl: { type: Date, default: Date.now },
  informe: { type: mongoose.Schema.Types.Mixed, required: true },
  modelo: { type: String, default: null },
  costoUsd: { type: Number, default: null },
})

informeEstrategaSchema.index({ generadoEl: -1 })

export const InformeEstratega = mongoose.model('InformeEstratega', informeEstrategaSchema)
