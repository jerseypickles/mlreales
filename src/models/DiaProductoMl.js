import mongoose from 'mongoose'

// LIBRO DIARIO de cada producto propio: un renglón por producto y día UTC (el
// día con que ML reporta las visitas). Existe porque las series embebidas en
// ProductoPropio son rodantes —mediciones guarda 6 días, historialPrecios 20
// cambios— y lo que no se congela acá se pierde para cualquier modelo futuro.
// Guarda TODO día, también los de cero visitas, sin stock o con promo: qué se
// usa para entrenar se decide al entrenar, no al capturar.
const schema = new mongoose.Schema({
  itemId: { type: String, required: true },
  dia: { type: String, required: true }, // AAAA-MM-DD, día UTC
  titulo: String,
  categoria: { type: String, default: null },
  // solo en días escritos en su fecha: a la historia recuperada no se le
  // atribuye un nicho que quizá no tenía entonces
  nichoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nicho', default: null },
  visitas: { type: Number, required: true },
  unidades: { type: Number, required: true }, // órdenes pagadas de ese día
  ordenes: { type: Number, required: true },
  precio: { type: Number, default: null }, // promedio ponderado por tiempo del precio efectivo
  precioMin: { type: Number, default: null },
  precioMax: { type: Number, default: null },
  cambiosPrecio: { type: Number, default: 0 },
  // anterior al primer cambio de precio que se conserva: es el `anterior` de
  // ese cambio, cierto solo hasta el cambio previo que ya no está
  precioInferido: { type: Boolean, default: false },
  logistica: { type: String, default: null },
  cambioLogistica: { type: Boolean, default: false },
  // fracción de las mediciones del día con stock; null = no se midió
  stockFraccion: { type: Number, default: null },
  actualizadoEl: { type: Date, required: true },
}, { versionKey: false })
schema.index({ itemId: 1, dia: 1 }, { unique: true })
schema.index({ dia: -1 })
export const DiaProductoMl = mongoose.model('DiaProductoMl', schema)
