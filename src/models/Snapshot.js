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
  vendidos: Number, // Fase 2 (nivel 2)
  stock: Number, // Fase 2 (nivel 2)
  posicion: Number,
  keyword: String,
})

snapshotSchema.index({ sku: 1, fecha: -1 })
snapshotSchema.index({ keyword: 1, fecha: -1 })

export const Snapshot = mongoose.model('Snapshot', snapshotSchema)
