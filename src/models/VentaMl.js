import mongoose from 'mongoose'

// Venta real de la cuenta ML (orders API): materia prima del ciclo cerrado —
// hoy alimenta los ingresos 30d de Mis productos; cuando haya semanas de
// datos, calibra el factor reseñas→ventas con la realidad de la cuenta.
const ventaMlSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  fecha: { type: Date, required: true },
  estado: String,
  totalClp: Number,
  items: [
    {
      _id: false,
      itemId: String,
      titulo: String,
      cantidad: Number,
      precioUnitClp: Number,
    },
  ],
  guardadoEl: { type: Date, default: Date.now },
})

ventaMlSchema.index({ fecha: -1 })
ventaMlSchema.index({ 'items.itemId': 1, fecha: -1 })

export const VentaMl = mongoose.model('VentaMl', ventaMlSchema)
