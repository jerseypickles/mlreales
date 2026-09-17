import mongoose from 'mongoose'

// LISTA DE SEGUIMIENTO DE STOCK. El nicho completo se lee cada ~6,5 días, y en
// ese lapso un vendedor chico puede bajar de "+25" a "3" y reponer a "+25" sin
// que se note. Acá vive una lista corta de publicaciones —vendedores como el
// importador, con stock visible— que se leen solas y seguido, con un tope de
// gasto mensual (US$30, pedido del importador el 17-sep-2026).
const schema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  nichoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nicho', default: null },
  keyword: { type: String, default: null },
  titulo: String,
  imagen: String,
  vendedor: String,
  // publicación propia: se lee desde afuera igual que un competidor, y como su
  // venta real se conoce, calibra cuánto del total ve el método
  esPropio: { type: Boolean, default: false },
  itemIdPropio: { type: String, default: null },
  activo: { type: Boolean, default: true },
  motivoBaja: { type: String, default: null },
  agregadoEl: { type: Date, required: true },
  proximaLecturaEl: { type: Date, required: true },
  ultima: { type: { _id: false, fecha: Date, stock: Number, topado: Boolean, fuente: String }, default: null },
  lecturas: { type: Number, default: 0 },
  // lecturas seguidas en "+50": ahí no se ve nada y la plata rinde más en otro lado
  sinInfoSeguidas: { type: Number, default: 0 },
  fallosSeguidos: { type: Number, default: 0 },
  // reposiciones reales vistas: un vendedor que ya demostró que vende y repone NO
  // se da de baja por volver a "+50" — es justo después de reponer, y va a bajar
  reposicionesVistas: { type: Number, default: 0 },
}, { versionKey: false })
schema.index({ activo: 1, proximaLecturaEl: 1 })
schema.index({ nichoId: 1 })
export const SeguimientoStock = mongoose.model('SeguimientoStock', schema)

// Cada lectura, con su fecha. También las fallidas: se pagaron igual.
const lecturaSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  fecha: { type: Date, required: true },
  ok: { type: Boolean, default: true },
  stock: { type: Number, default: null },
  topado: { type: Boolean, default: null },
  fuente: { type: String, default: null },
  precio: { type: Number, default: null },
  vendidosFicha: { type: Number, default: null },
  numReviews: { type: Number, default: null },
  costoUsd: { type: Number, default: 0 },
}, { versionKey: false })
lecturaSchema.index({ sku: 1, fecha: -1 })
lecturaSchema.index({ fecha: -1 })
export const LecturaStock = mongoose.model('LecturaStock', lecturaSchema)
