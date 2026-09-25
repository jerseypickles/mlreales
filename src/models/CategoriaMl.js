import mongoose from 'mongoose'

// EL ÁRBOL DE CATEGORÍAS DE MERCADO LIBRE CHILE, GUARDADO.
//
// El radar miraba siempre los mismos pasillos: el ranking de más vendidos se
// leía solo en las ~100 categorías donde ya había nichos. Con el árbol entero
// guardado se puede leer el ranking de TODAS las categorías finales y ver qué
// entra al top en pasillos donde nunca se buscó (panoramaMl.js).
const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  nombre: { type: String, default: null },
  ruta: { type: String, default: null }, // "Hogar > Cocina > Utensilios"
  padreId: { type: String, default: null },
  hoja: { type: Boolean, default: null }, // sin subcategorías: donde vive el ranking
  totalItems: { type: Number, default: null },
  // null = descubierta como hija pero todavía sin leer
  actualizadoEl: { type: Date, default: null },
}, { versionKey: false })
schema.index({ hoja: 1, totalItems: -1 })
schema.index({ actualizadoEl: 1 })
export const CategoriaMl = mongoose.model('CategoriaMl', schema)

// Las búsquedas que suben en cada categoría, según ML (/trends/MLC/{id}), una
// captura por categoría y día. Comparando dos capturas aparecen las NUEVAS.
const tendenciaSchema = new mongoose.Schema({
  categoriaId: { type: String, required: true },
  dia: { type: String, required: true },
  terminos: { type: [String], default: [] },
  capturadoEl: { type: Date, required: true },
}, { versionKey: false })
tendenciaSchema.index({ categoriaId: 1, dia: 1 }, { unique: true })
tendenciaSchema.index({ dia: -1 })
export const TendenciaCategoria = mongoose.model('TendenciaCategoria', tendenciaSchema)
