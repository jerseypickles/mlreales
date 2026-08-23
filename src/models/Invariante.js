import mongoose from 'mongoose'

// El historial de los autochequeos. Guardar la serie importa más que la última
// corrida: una invariante que se rompe y se arregla sola es una cosa, y una que
// lleva rota tres días es otra muy distinta.
const invarianteSchema = new mongoose.Schema({
  fecha: { type: Date, default: Date.now, index: true },
  total: Number,
  rotas: Number,
  resultados: { type: [mongoose.Schema.Types.Mixed], default: [] },
})

invarianteSchema.index({ fecha: -1 })

export const Invariante = mongoose.model('Invariante', invarianteSchema)
