import mongoose from 'mongoose'

// Si un proveedor de scraping está caído. Vive en la base y no en memoria
// porque Render reinicia el proceso y el estado se perdería justo cuando más
// se necesita: en medio de una caída.
const proveedorEstadoSchema = new mongoose.Schema({
  proveedor: { type: String, required: true, unique: true }, // 'zyte' | 'apify'
  abierto: { type: Boolean, default: false },
  motivo: String,
  desdeEl: Date,
  cerradoEl: Date,
})

export const ProveedorEstado = mongoose.model('ProveedorEstado', proveedorEstadoSchema)
