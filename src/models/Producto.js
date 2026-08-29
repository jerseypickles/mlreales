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
  catalogId: String, // id de catálogo de ML (nivel 1 por Zyte)
  itemId: String, // id de la publicación; es lo que pide /reviews/item
  esTiendaOficial: { type: Boolean, default: false },
  // null = el listado no mostró el flag (desconocido ≠ sin Full)
  esFull: { type: Boolean, default: null },
  // logistic_type exacto de la API oficial para items de catálogo (fulfillment/xd_drop_off/…)
  logisticaMl: { type: String, default: null },
  envioRapido: { type: Boolean, default: false },
  // despacha desde el extranjero. Lo llenaba solo el nivel 2 (fracción del
  // listado); desde el 15-ago también el nivel 1, que lo trae para el 100%
  origenCrossBorder: { type: Boolean, default: false },
  origenEnvio: { type: String, default: null }, // "China", "USA" (nivel 1)
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
