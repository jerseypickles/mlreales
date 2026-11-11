import mongoose from 'mongoose'

// LOS EVENTOS COMERCIALES, CON FECHAS (8-oct-2026). El CyberDay de octubre pasó
// sin que el sistema lo supiera: visitas ×2, ventas de 0-3 a 9 y 12 al día, CTR
// de 0,25% a 0,40%, y el learning machine iba a leerlo como "lo recomendado
// funcionó". Cada evento marca días que no son normales: se excluyen de las
// comparaciones y se mide su efecto para planificar el siguiente.
const schema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true }, // 'cyberday-2026-10'
  nombre: { type: String, required: true },
  desde: { type: String, required: true }, // AAAA-MM-DD, día de Chile
  hasta: { type: String, required: true },
  // confirmado: lo dijo el importador · inferido: fechas sacadas de los datos,
  // por confirmar · por-revisar: salto detectado sin explicación · descartado
  estado: { type: String, enum: ['confirmado', 'inferido', 'por-revisar', 'descartado'], default: 'por-revisar' },
  origen: { type: String, enum: ['manual', 'inferido', 'detectado'], default: 'manual' },
  // el salto resultó ser un nivel nuevo de la cuenta (productos nuevos, campañas
  // nuevas) y no un evento: se descartó solo y sus días volvieron a ser normales
  nivelNuevo: { type: Boolean, default: false },
  nota: { type: String, default: null },
  efecto: { type: mongoose.Schema.Types.Mixed, default: null },
  actualizadoEl: { type: Date, default: Date.now },
}, { versionKey: false })
schema.index({ desde: 1 })
export const EventoComercial = mongoose.model('EventoComercial', schema)
