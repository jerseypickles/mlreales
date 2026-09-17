import mongoose from 'mongoose'

// PUBLICIDAD POR PRODUCTO Y DÍA. Hasta el 17-sep-2026 las métricas de Product
// Ads se leían en vivo para la pantalla y no se guardaban: ML las retiene ~90
// días, así que el gasto que explica las visitas de cada semana se iba
// perdiendo. Sin esto ningún modelo puede separar lo que vendió el producto de
// lo que compró la publicidad (25% del bruto de agosto).
//
// El día es el de CHILE, que es como Product Ads cuenta sus fechas (ver
// services/ads.js); el libro de visitas y ventas va en día UTC. A escala de
// semana la diferencia de 3-4 horas no mueve la lectura, y queda declarada.
// `itemId: '*'` es el total de la cuenta ese día y marca el día como leído.
const schema = new mongoose.Schema({
  itemId: { type: String, required: true },
  dia: { type: String, required: true }, // AAAA-MM-DD, día de Chile
  campanaId: { type: Number, default: null },
  estado: { type: String, default: null },
  prints: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  costo: { type: Number, default: 0 },
  unidadesAds: { type: Number, default: 0 }, // directas + indirectas atribuidas
  unidadesDirectas: { type: Number, default: 0 },
  unidadesIndirectas: { type: Number, default: 0 },
  unidadesOrganicas: { type: Number, default: 0 },
  ventaAds: { type: Number, default: 0 },
  anuncios: { type: Number, default: null }, // solo en la fila '*'
  actualizadoEl: { type: Date, required: true },
}, { versionKey: false })
schema.index({ itemId: 1, dia: 1 }, { unique: true })
schema.index({ dia: -1 })
export const AdsDiaMl = mongoose.model('AdsDiaMl', schema)
