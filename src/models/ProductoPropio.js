import mongoose from 'mongoose'

// Producto del usuario en ML, seguido aparte de los nichos: serie propia de
// precio/reseñas/rating con medición diaria (batch chico del actor de detalle).
const productoPropioSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  titulo: String,
  imagen: String,
  estado: { type: String, enum: ['activo', 'pausado'], default: 'activo' },
  ultimoScanEl: { type: Date, default: null },
  // serie embebida (una medición por scan, acotada): suficiente para deltas y gráficos
  mediciones: {
    type: [
      {
        _id: false,
        fecha: Date,
        precio: Number,
        numReviews: Number,
        rating: Number,
      },
    ],
    default: [],
  },
  creadoEl: { type: Date, default: Date.now },
})

export const ProductoPropio = mongoose.model('ProductoPropio', productoPropioSchema)
