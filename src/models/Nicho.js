import mongoose from 'mongoose'

const nichoSchema = new mongoose.Schema({
  keyword: { type: String, required: true, trim: true, lowercase: true },
  domainCode: { type: String, default: 'CL', uppercase: true },
  estado: { type: String, enum: ['activo', 'pausado'], default: 'activo' },
  frecuenciaScan: { type: String, enum: ['diario', 'semanal'], default: 'diario' },
  creadoEl: { type: Date, default: Date.now },
  ultimoScanEl: { type: Date, default: null },
  // { total, esMinimo } — "+9.999 resultados" del listado; esMinimo indica que ML capea el contador
  ultimoTotalResultados: { type: mongoose.Schema.Types.Mixed, default: null },
})

nichoSchema.index({ keyword: 1, domainCode: 1 }, { unique: true })

export const Nicho = mongoose.model('Nicho', nichoSchema)
