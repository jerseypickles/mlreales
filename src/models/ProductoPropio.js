import mongoose from 'mongoose'

// Producto del usuario en ML, seguido aparte de los nichos: serie propia de
// precio/reseñas/rating con medición diaria (batch chico del actor de detalle).
const productoPropioSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  titulo: String,
  imagen: String,
  estado: { type: String, enum: ['activo', 'pausado'], default: 'activo' },
  // item id MLC… de la publicación cuando el sku seguido es una página /up/
  // (MLCU…): abre la puerta oficial de item/visitas para el mismo producto
  itemIdMl: { type: String, default: null },
  // estado de la publicación en ML según la API oficial (active/paused/closed)
  estadoMl: { type: String, default: null },
  // caja de compra del catálogo (price_to_win): {estado, precioParaGanar,
  // precioActual, fecha} — solo items que compiten en un catálogo
  buyBox: { type: mongoose.Schema.Types.Mixed, default: null },
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
        // solo con cuenta ML conectada: datos oficiales que el scraper no ve
        stock: Number,
        vendidos: Number, // acumulado real — su delta entre scans = ventas reales
        visitas: Number, // últimos 7 días
      },
    ],
    default: [],
  },
  creadoEl: { type: Date, default: Date.now },
})

export const ProductoPropio = mongoose.model('ProductoPropio', productoPropioSchema)
