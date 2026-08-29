import mongoose from 'mongoose'

// Lo que Mercado Libre COBRA de verdad, línea por línea. Hasta ahora el
// sistema estimaba la comisión desde el tarifario y la tarifa Full con un fijo
// de $1.200; el detalle de facturación trae el cargo real y —lo que faltaba— el
// CARGO POR ENVÍO, que en ticket bajo pesa más que la comisión (brochas
// maquillaje, venta de $1.795: comisión $305 y envío $799).
//
// Cada línea viene con item_id, así que se cablea sola al producto propio y de
// ahí al nicho.
const cargoMlSchema = new mongoose.Schema({
  detalleId: { type: String, required: true, unique: true },
  documentoId: String,
  periodo: { type: String, index: true }, // clave del período: 'AAAA-MM-01'
  fecha: { type: Date, index: true },
  // Tipos medidos sobre el período 2026-08 (300 líneas), por peso:
  //   CFF  envíos de ML          108 líneas  $152.606  ← el envío de verdad
  //   PADS Product Ads            20         $137.327
  //   CV   cargo por venta       113         $ 59.919
  //   BPAD anulación de PADS      14         $ 57.112
  //   CFCB colecta Full           10         $ 18.417
  //   BFF  anulación de envío      3         $  2.398
  //   BV   anulación de venta      3         $    931
  //   CXD  envíos (código viejo)   1         $    799
  //   CFWA almacenamiento Full    28         $    647
  // Los que empiezan con B son ANULACIONES: vienen con monto positivo y anulan
  // un cargo anterior, que a su vez llega con estado BONUS_ON_BILL.
  tipo: { type: String, index: true },
  concepto: String,
  montoClp: Number,
  montoSinDescuentoClp: Number,
  descuentoClp: Number,
  // 'BONUS_ON_BILL' = anulado en la factura: NO es un costo real
  estado: { type: String, default: null },
  anulado: { type: Boolean, default: false },
  // esta línea ANULA otro cargo: `bonificaA` es el detalleId del anulado
  esAnulacion: { type: Boolean, default: false },
  bonificaA: { type: String, default: null, index: true },
  // ya descontado del pago de la operación (vs cobrado aparte)
  descontadoDeLaVenta: { type: Boolean, default: null },
  itemId: { type: String, index: true },
  tituloItem: String,
  orderId: String,
  precioVentaClp: Number,
  categoriaMl: String,
  marketplace: String,
  guardadoEl: { type: Date, default: Date.now },
})

cargoMlSchema.index({ itemId: 1, fecha: -1 })

export const CargoMl = mongoose.model('CargoMl', cargoMlSchema)
