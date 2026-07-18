import mongoose from 'mongoose'

// Criterios del importador: reglas que él escribe desde el dashboard y que se
// inyectan en los prompts (sugeridor, analista) sin necesidad de deploy.
// Ej: "el genérico vende en belleza", "nunca ropa con tallas", "ticket ideal $10-40k".
const criterioSchema = new mongoose.Schema({
  texto: { type: String, required: true, trim: true, maxlength: 300 },
  activo: { type: Boolean, default: true },
  creadoEl: { type: Date, default: Date.now },
})

export const Criterio = mongoose.model('Criterio', criterioSchema)
