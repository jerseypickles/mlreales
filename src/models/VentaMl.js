import mongoose from 'mongoose'

// Venta real de la cuenta ML (orders API): materia prima del ciclo cerrado —
// hoy alimenta los ingresos 30d de Mis productos; cuando haya semanas de
// datos, calibra el factor reseñas→ventas con la realidad de la cuenta.
const ventaMlSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  fecha: { type: Date, required: true },
  estado: String,
  // una orden pagada que ML después reembolsó: deja de contar como venta
  anuladaEl: { type: Date, default: null },
  totalClp: Number,
  // LO QUE EL COMPRADOR PAGÓ DE ENVÍO (payments[].shipping_cost). Entra a la
  // cuenta con la venta y ML lo cobra de vuelta en la línea CFF de la factura:
  // es plata de paso, no costo. Orden 2000018640413256 (25-sep-2026): Set 8 a
  // $4.490 + $3.990 de envío del comprador = $8.480 pagados; ML cobró $4.789
  // de envío, o sea $799 de costo real. Sin este campo el envío salía $1.322.
  envioCompradorClp: { type: Number, default: null },
  // el carrito: órdenes del mismo envío. El envío del comprador se paga en
  // UNA de ellas y ML lo cobra en otra, así que se netea por carrito.
  packId: { type: String, default: null },
  // EL ENVÍO LEÍDO DEL ENVÍO (/shipments/{id}), que es la fuente que no falla:
  // shipping_option.cost = lo que pagó el comprador; list_cost = el cobro
  // completo de la factura; la diferencia es lo que paga el vendedor. En los
  // carritos el pago del comprador no aparece en la orden, pero sí acá.
  // Medido el 28-sep-2026 en 3 órdenes del Set 8: siempre $799,4 para el vendedor.
  shipmentId: { type: String, default: null },
  envioTotalClp: { type: Number, default: null },
  envioVendedorClp: { type: Number, default: null },
  items: [
    {
      _id: false,
      itemId: String,
      titulo: String,
      cantidad: Number,
      precioUnitClp: Number,
    },
  ],
  // Documento tributario de la venta, traído de ML (services/boletasMl.js).
  // En Full lo emite MercadoLibre Chile con sus folios pero "por cuenta y
  // orden de" el vendedor: la venta y el débito son del vendedor. Trae el
  // desglose fiscal exacto, así que el IVA del período no se estima.
  boleta: { type: mongoose.Schema.Types.Mixed, default: null },
  guardadoEl: { type: Date, default: Date.now },
})

ventaMlSchema.index({ fecha: -1 })
ventaMlSchema.index({ 'items.itemId': 1, fecha: -1 })

export const VentaMl = mongoose.model('VentaMl', ventaMlSchema)
