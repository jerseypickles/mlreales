import mongoose from 'mongoose'

// Lo que el sistema APRENDIÓ con plata real, no lo que estimó. Un nicho que
// vende deja de ser una hipótesis y pasa a ser un hecho anclado a su categoría
// de ML: desde ahí el radar puede salir a buscar las categorías hermanas en vez
// de adivinar keywords sueltas. Es la memoria de largo plazo del cerebro.
const aprendizajeSchema = new mongoose.Schema({
  tipo: { type: String, enum: ['nicho-vende', 'formato-gana', 'categoria-probada'], required: true },
  keyword: { type: String, index: true },
  nichoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nicho', default: null },
  // ancla en el árbol real de ML (no en la keyword): permite explorar hermanas
  categoriaMl: { type: String, default: null },
  categoriaRuta: { type: String, default: null },
  categoriaPadre: { type: String, default: null },
  // evidencia medida que sostiene el hecho
  evidencia: { type: mongoose.Schema.Types.Mixed, default: null },
  // frase corta que se inyecta a los prompts
  leccion: { type: String, required: true },
  primeraVezEl: { type: Date, default: Date.now },
  actualizadoEl: { type: Date, default: Date.now },
})

aprendizajeSchema.index({ tipo: 1, keyword: 1 }, { unique: true })

export const Aprendizaje = mongoose.model('Aprendizaje', aprendizajeSchema)
