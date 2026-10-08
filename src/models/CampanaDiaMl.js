import mongoose from 'mongoose'

// LA CONFIGURACIÓN DE CADA CAMPAÑA, DÍA A DÍA (8-oct-2026). AdsDiaMl guarda lo
// que pasó (impresiones, clics, gasto) pero no con qué presupuesto ni ROAS
// objetivo: sin eso, una semana con menos impresiones no dice si bajó la gente
// que busca o si se bajó el presupuesto (septiembre: de ~$77k a $20k por
// semana). El importador quiere que el learning machine aprenda de sus propias
// impresiones y CPC para no depender solo de Google; esto lo hace posible.
const schema = new mongoose.Schema({
  campanaId: { type: Number, required: true },
  dia: { type: String, required: true }, // AAAA-MM-DD, día de Chile
  nombre: { type: String, default: null },
  estado: { type: String, default: null },
  presupuestoDiario: { type: Number, default: null },
  roasObjetivo: { type: Number, default: null },
  estrategia: { type: String, default: null },
  productos: { type: [String], default: [] },
  actualizadoEl: { type: Date, required: true },
}, { versionKey: false })
schema.index({ campanaId: 1, dia: 1 }, { unique: true })
schema.index({ dia: -1 })
export const CampanaDiaMl = mongoose.model('CampanaDiaMl', schema)
