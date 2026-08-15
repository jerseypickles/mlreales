import mongoose from 'mongoose'

// Serie temporal: 1 documento por producto por scan. Todos los snapshots de un
// mismo scan comparten la misma `fecha`, lo que permite reconstruir el listado
// completo de ese momento.
const snapshotSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  fecha: { type: Date, required: true },
  precio: Number,
  precioAnterior: Number,
  descuentoPct: Number,
  cuotas: String,
  rating: Number,
  numReviews: Number,
  vendidos: Number, // badge público "+N vendidos", en baldes (nivel 1)
  // "últimas N unidades" del listado: 1..5, o null si ML no lo muestra (= más
  // de 5). Es el stock del COMPETIDOR, no el propio. Ojo strict mode: sin
  // declararlo acá Mongoose lo descarta en silencio, como pasó con promoMl.
  unidadesRestantes: Number,
  selloMl: String, // "MÁS VENDIDO", "OFERTA IMPERDIBLE", "OFERTA RELÁMPAGO"
  stock: Number, // Fase 2 (nivel 2)
  posicion: Number,
  keyword: String,
  // ids de las preguntas visibles en la página (nivel 2): el diff entre scans
  // cuenta preguntas NUEVAS reales — segundo proxy de demanda, independiente
  // del conteo de reseñas y sus agregados de catálogo
  preguntasIds: { type: [String], default: undefined },
})

snapshotSchema.index({ sku: 1, fecha: -1 })
snapshotSchema.index({ keyword: 1, fecha: -1 })

export const Snapshot = mongoose.model('Snapshot', snapshotSchema)
