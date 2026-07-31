import mongoose from 'mongoose'

// Producto del usuario en ML, seguido aparte de los nichos: serie propia de
// precio/reseñas/rating con medición diaria (batch chico del actor de detalle).
const productoPropioSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  titulo: String,
  imagen: String,
  estado: { type: String, enum: ['activo', 'pausado'], default: 'activo' },
  // item id MLC… de la publicación cuando el sku seguido es una página /up/
  // (MLCU…): abre la puerta oficial de item/visitas para el mismo producto
  itemIdMl: { type: String, default: null },
  // estado de la publicación en ML según la API oficial (active/paused/closed)
  estadoMl: { type: String, default: null },
  // caja de compra del catálogo (price_to_win): {estado, precioParaGanar,
  // precioActual, fecha} — solo items que compiten en un catálogo
  buyBox: { type: mongoose.Schema.Types.Mixed, default: null },
  // nicho del tablero contra el que se compara este producto (auditoría de listing)
  nichoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nicho', default: null },
  // costo real por unidad puesto en bodega (lo ingresa el usuario): habilita
  // el margen real por venta — sin esto, ingresos ≠ ganancia
  costoUnitarioClp: { type: Number, default: null },
  // categoría ML del item (la trae la API oficial en el scan): permite calcular
  // la comisión exacta para el margen
  categoriaMl: { type: String, default: null },
  // última auditoría de listing vs los ganadores del nicho: {estado:
  // 'generando'|'ok'|'error', generadoEl, competidores, resultado, costoUsd…}
  auditoria: { type: mongoose.Schema.Types.Mixed, default: null },
  ultimoScanEl: { type: Date, default: null },
  // cambios de título detectados por el scan diario: [{fecha, anterior, nuevo}].
  // Con la serie de visitas al lado, dice si el cambio sirvió.
  historialTitulos: { type: [mongoose.Schema.Types.Mixed], default: [] },
  // logística actual de la publicación según la API oficial:
  // {logistica: fulfillment|self_service|xd_drop_off|…, flex, envioGratis, fecha}
  envioMl: { type: mongoose.Schema.Types.Mixed, default: null },
  // cambios de logística detectados por el scan (ej: colecta → Full cuando ML
  // activa el stock en bodega): intervención medible por la lupa
  historialLogistica: { type: [mongoose.Schema.Types.Mixed], default: [] },
  // serie embebida (una medición por scan, acotada): suficiente para deltas y gráficos
  mediciones: {
    type: [
      {
        _id: false,
        fecha: Date,
        precio: Number,
        numReviews: Number,
        rating: Number,
        // solo con cuenta ML conectada: datos oficiales que el scraper no ve
        stock: Number,
        vendidos: Number, // acumulado real — su delta entre scans = ventas reales
        visitas: Number, // últimos 7 días
      },
    ],
    default: [],
  },
  creadoEl: { type: Date, default: Date.now },
})

export const ProductoPropio = mongoose.model('ProductoPropio', productoPropioSchema)
