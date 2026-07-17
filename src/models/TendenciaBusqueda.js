import mongoose from 'mongoose'

// Serie diaria del autocompletado de ML: 1 documento por prefijo por día.
// El orden de `sugerencias` ES el dato: el autosuggest lista por volumen real
// de búsquedas, así que posición = popularidad relativa dentro del prefijo.
const tendenciaBusquedaSchema = new mongoose.Schema({
  prefijo: { type: String, required: true },
  dia: { type: String, required: true }, // YYYY-MM-DD en hora de Chile
  fecha: { type: Date, required: true },
  sugerencias: [String],
})

tendenciaBusquedaSchema.index({ prefijo: 1, dia: -1 }, { unique: true })

export const TendenciaBusqueda = mongoose.model('TendenciaBusqueda', tendenciaBusquedaSchema)
