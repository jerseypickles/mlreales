import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  itemId: { type: String, required: true },
  titulo: String,
  nichoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nicho', default: null },
  categoria: { type: String, required: true },
  desde: { type: Date, required: true },
  hasta: { type: Date, required: true },
  dia: { type: String, required: true },
  visitas: { type: Number, required: true },
  unidades: { type: Number, required: true },
  precio: { type: Number, required: true },
  full: { type: Boolean, required: true },
  // Ventas pagadas observadas, no pedidos ni rentabilidad realizada.
  fuente: { type: String, default: 'ordenes-pagadas-y-visitas-7d' },
}, { versionKey: false })
schema.index({ itemId: 1, dia: 1 }, { unique: true })
schema.index({ hasta: -1 })
export const ObservacionProductoMl = mongoose.model('ObservacionProductoMl', schema)
