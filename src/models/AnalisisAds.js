import mongoose from 'mongoose'

// LA OPINIÓN DE LA PUBLICIDAD, CON MEMORIA.
//
// Los únicos diales que ML deja mover son el presupuesto y el objetivo de ROAS,
// y los dos son por campaña. Hasta ahora se movían a ojo: no había forma de
// saber si el 2,30x de la Campaña 1 era el número correcto o simplemente el que
// quedó puesto.
//
// Lo que hace útil a este registro no es la opinión suelta sino la SERIE: cada
// análisis guarda qué recomendó y con qué números lo dijo, así el siguiente
// puede leer si lo anterior se aplicó y qué pasó. Sin eso la IA opina de nuevo
// desde cero cada vez y nunca aprende de su propio consejo — que es exactamente
// el problema que tenía el resto del sistema antes de los aprendizajes.
const recomendacionCampana = {
  campanaId: Number,
  nombre: String,
  // lo que estaba puesto cuando se opinó
  presupuestoActual: Number,
  roasObjetivoActual: Number,
  roasRealActual: Number,
  // lo que se recomienda
  presupuestoSugerido: Number,
  roasObjetivoSugerido: Number,
  accion: { type: String, enum: ['subir-presupuesto', 'bajar-presupuesto', 'subir-objetivo', 'bajar-objetivo', 'mantener', 'cerrar'] },
  porque: String,
  // qué habría que ver si el consejo es correcto, para poder revisarlo después
  queEsperar: String,
  confianza: { type: String, enum: ['alta', 'media', 'baja'] },
}

const analisisAdsSchema = new mongoose.Schema({
  fecha: { type: Date, default: Date.now, index: true },
  // ventana de datos sobre la que opinó
  dias: Number,
  // la foto de los números en el momento de opinar: sin esto la recomendación
  // queda sin contexto y no se puede auditar después
  foto: mongoose.Schema.Types.Mixed,
  recomendaciones: { type: [recomendacionCampana], default: [] },
  // lectura general: qué está pasando con la publicidad en una frase
  titular: String,
  // lo que la IA no puede decidir y necesita del importador
  preguntas: { type: [String], default: [] },
  // revisión de su propio consejo anterior: se aplicó, y qué pasó
  revisionAnterior: String,
  modelo: String,
  costoUsd: Number,
})

analisisAdsSchema.index({ fecha: -1 })

export const AnalisisAds = mongoose.model('AnalisisAds', analisisAdsSchema)
