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
  // HALLAZGOS DE OTROS CEREBROS SOBRE ESTE PRODUCTO.
  //
  // El analista de publicidad, el de nichos y el optimizador de listings corren
  // separados y no se hablaban. Se vio con la lámpara UV: publicidad detectó
  // que su problema es el TÍTULO —CTR 0,48% con 26.238 impresiones, y el título
  // usa "lampara de uñas uv" (50 búsquedas/mes) en vez de "lampara para uñas"
  // (1.600)— pero quien puede arreglarlo es el optimizador, que nunca se
  // enteró. El hallazgo moría en la pantalla de publicidad.
  //
  // Acá aterrizan: cada uno anota lo que encontró en el producto, y el que
  // tiene la herramienta lo ve.
  hallazgos: {
    type: [
      {
        _id: false,
        de: { type: String, enum: ['publicidad', 'nichos', 'listing', 'contabilidad'] },
        que: String,
        detalle: String,
        // qué medir para saber si el arreglo sirvió
        queEsperar: String,
        fecha: { type: Date, default: Date.now },
        resuelto: { type: Boolean, default: false },
      },
    ],
    default: [],
  },
  ultimoScanEl: { type: Date, default: null },
  // RELOJ APARTE PARA LA PASADA COMPLETA. Los propios corren en dos ciclos: el
  // frecuente de 45 min (solo API oficial, $0) y el completo diario, que además
  // sincroniza los cargos de ML y auto-importa publicaciones nuevas.
  //
  // Los dos escribían `ultimoScanEl`, así que el ciclo barato reseteaba el
  // reloj que el completo miraba para saber si le tocaba: nunca pasaban las 20
  // horas y la pasada completa no corrió NUNCA. Se vio el 18-ago-2026 — los
  // cargos de ML llevaban 7 días congelados y cada corrida horaria registraba
  // "cargosMl: null". El auto-import de publicaciones nuevas tampoco corría.
  ultimoScanCompletoEl: { type: Date, default: null },
  // cambios de título detectados por el scan diario: [{fecha, anterior, nuevo}].
  // Con la serie de visitas al lado, dice si el cambio sirvió.
  historialTitulos: { type: [mongoose.Schema.Types.Mixed], default: [] },
  // logística actual de la publicación según la API oficial:
  // {logistica: fulfillment|self_service|xd_drop_off|…, flex, envioGratis, fecha}
  envioMl: { type: mongoose.Schema.Types.Mixed, default: null },
  // cambios de logística detectados por el scan (ej: colecta → Full cuando ML
  // activa el stock en bodega): intervención medible por la lupa
  historialLogistica: { type: [mongoose.Schema.Types.Mixed], default: [] },
  // promoción de ML vigente {activa, ofertaPropia, campanasDisponibles}: con
  // campaña activa el precio de lista NO es el que ve el comprador
  promoMl: { type: mongoose.Schema.Types.Mixed, default: null },
  // cambios del PRECIO EFECTIVO (lo que paga el cliente): [{fecha, anterior,
  // nuevo, motivo}] — cada uno es una intervención que la lupa mide
  historialPrecios: { type: [mongoose.Schema.Types.Mixed], default: [] },
  // serie embebida (una medición por scan, acotada): suficiente para deltas y gráficos
  mediciones: {
    type: [
      {
        _id: false,
        fecha: Date,
        precio: Number,
        // precio EFECTIVO que ve el comprador (con promo aplicada) — la serie
        // del experimento de elasticidad se lee de aquí, no del de lista
        precioEfectivo: Number,
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
  // Stock REAL en la bodega de Full, con lo retenido y su motivo. Se guarda
  // aparte de `mediciones.stock` porque el item declara otra cosa: el descuadre
  // entre ambos es un dato, no un error a esconder (ver services/inventarioFull).
  inventarioFull: { type: mongoose.Schema.Types.Mixed, default: null },

  creadoEl: { type: Date, default: Date.now },
})

export const ProductoPropio = mongoose.model('ProductoPropio', productoPropioSchema)
