import mongoose from 'mongoose'

// Conteo de reseñas de una publicación ajena, UNA VEZ AL DÍA, por la API
// oficial (gratis). Vive aparte de Snapshot a propósito: un Snapshot es un scan
// completo del nicho y `obtenerProductosUltimoScan` toma la última fecha por
// keyword, así que una lectura suelta lo contaminaría.
const lecturaReseniaSchema = new mongoose.Schema({
  itemId: { type: String, required: true }, // lo que pide /reviews/item
  sku: String, // como lo conoce Snapshot (puede ser el catálogo)
  dia: { type: String, required: true }, // día de Chile, AAAA-MM-DD
  numReviews: { type: Number, required: true },
  leidaEl: { type: Date, required: true },
})

lecturaReseniaSchema.index({ itemId: 1, dia: 1 }, { unique: true })
lecturaReseniaSchema.index({ dia: 1 })
// medio año alcanza para cualquier ventana de entrenamiento
lecturaReseniaSchema.index({ leidaEl: 1 }, { expireAfterSeconds: 183 * 86400 })

export const LecturaResenia = mongoose.model('LecturaResenia', lecturaReseniaSchema)
