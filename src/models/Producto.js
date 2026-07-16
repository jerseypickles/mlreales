import mongoose from 'mongoose'

const productoSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true },
  keywordOrigen: String,
  titulo: String,
  url: String,
  tipoListing: { type: String, enum: ['catalogo', 'listing'], default: 'listing' },
  categoriaML: String,
  domainML: String,
  vendedor: String,
  sellerId: String,
  esTiendaOficial: { type: Boolean, default: false },
  esFull: { type: Boolean, default: false },
  envioRapido: { type: Boolean, default: false },
  activo: { type: Boolean, default: true },
  primeraVezVisto: Date,
  ultimaVezVisto: Date,
})

productoSchema.index({ keywordOrigen: 1 })
productoSchema.index({ vendedor: 1 })

export const Producto = mongoose.model('Producto', productoSchema)
