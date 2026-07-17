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
  origenCrossBorder: { type: Boolean, default: false }, // despachado desde China (nivel 2)
  imagen: String, // thumbnail de ML (nivel 2)
  reputacionSeller: String, // ej "5_green" (nivel 2)
  powerSeller: String, // "platinum" | "gold" | "silver" (nivel 2)
  categoriaRuta: String, // breadcrumbs legibles, ej "Hogar > Climatización > Ventiladores" (nivel 2)
  preguntas: { type: mongoose.Schema.Types.Mixed, default: null }, // [{texto, respuesta}] de compradores (nivel 2)
  activo: { type: Boolean, default: true },
  primeraVezVisto: Date,
  ultimaVezVisto: Date,
})

productoSchema.index({ keywordOrigen: 1 })
productoSchema.index({ vendedor: 1 })

export const Producto = mongoose.model('Producto', productoSchema)
