import mongoose from 'mongoose'

// EL RANKING DE MÁS VENDIDOS DE ML, GUARDADO CADA DÍA.
//
// ML publica por su API oficial, gratis, los 20 más vendidos de cada categoría
// (/highlights/MLC/category/{id}). Desde el 29-ago se usaba solo como control
// de calidad de un scan. Guardado a diario deja ver lo que ninguna foto muestra:
// qué producto ENTRÓ al top 20 esta semana y cuál viene subiendo — demanda
// dicha por ML, no estimada por reseñas. Un documento por categoría y día de
// Chile; lo que no se guarda hoy no se puede comparar mañana.
const schema = new mongoose.Schema({
  categoriaId: { type: String, required: true },
  dia: { type: String, required: true }, // AAAA-MM-DD, día de Chile
  // nichos del tablero cuya categoría dominante es ésta, al capturar
  nichos: { type: [String], default: [] },
  items: {
    type: [{ _id: false, id: String, tipo: String, posicion: Number }],
    default: [],
  },
  capturadoEl: { type: Date, required: true },
}, { versionKey: false })
schema.index({ categoriaId: 1, dia: 1 }, { unique: true })
schema.index({ dia: -1 })
export const RankingMasVendidos = mongoose.model('RankingMasVendidos', schema)

// Ficha mínima de cada id visto en un ranking: el ranking trae solo ids, y un
// id sin nombre ni foto no le sirve a nadie para decidir.
const fichaSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  tipo: String,
  titulo: { type: String, default: null },
  imagen: { type: String, default: null },
  precio: { type: Number, default: null },
  url: { type: String, default: null },
  // de dónde salió la ficha: 'scan' (ya lo medíamos), 'catalogo' (API de productos)
  fuente: { type: String, default: null },
  resueltoEl: { type: Date, default: null },
  intentos: { type: Number, default: 0 },
}, { versionKey: false })
export const FichaMasVendido = mongoose.model('FichaMasVendido', fichaSchema)
