import mongoose from 'mongoose'

const nichoSchema = new mongoose.Schema({
  keyword: { type: String, required: true, trim: true, lowercase: true },
  domainCode: { type: String, default: 'CL', uppercase: true },
  estado: { type: String, enum: ['activo', 'pausado'], default: 'activo' },
  frecuenciaScan: { type: String, enum: ['diario', 'semanal'], default: 'diario' },
  // screening = detalle barato (top-10) hasta que el score justifique el completo;
  // los nichos del radar nacen en screening, los manuales en completo
  fase: { type: String, enum: ['screening', 'completo'], default: 'completo' },
  origen: { type: String, enum: ['manual', 'radar'], default: 'manual' },
  // metadata del descubrimiento del radar: razon, estacionalidad, ventanaImportacion
  radarInfo: { type: mongoose.Schema.Types.Mixed, default: null },
  // último borrador de listing generado con IA (títulos, ficha, descripción…)
  listingDraft: { type: mongoose.Schema.Types.Mixed, default: null },
  creadoEl: { type: Date, default: Date.now },
  ultimoScanEl: { type: Date, default: null },
  // { total, esMinimo } — "+9.999 resultados" del listado; esMinimo indica que ML capea el contador
  ultimoTotalResultados: { type: mongoose.Schema.Types.Mixed, default: null },
  costoUsd: { type: Number, default: 0 }, // gasto acumulado Apify + LLM atribuible al nicho
})

nichoSchema.index({ keyword: 1, domainCode: 1 }, { unique: true })

export const Nicho = mongoose.model('Nicho', nichoSchema)
