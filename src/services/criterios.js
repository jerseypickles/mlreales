import { Criterio } from '../models/Criterio.js'

// Textos de los criterios activos del importador, para inyectar en los prompts.
// Devuelve [] si no hay (los prompts omiten el bloque).
export async function criteriosActivos() {
  const criterios = await Criterio.find({ activo: true }).sort({ creadoEl: 1 }).select('texto').lean()
  return criterios.map((c) => c.texto)
}
