import mongoose from 'mongoose'

const nichoSchema = new mongoose.Schema({
  keyword: { type: String, required: true, trim: true, lowercase: true },
  domainCode: { type: String, default: 'CL', uppercase: true },
  estado: { type: String, enum: ['activo', 'pausado'], default: 'activo' },
  frecuenciaScan: { type: String, enum: ['diario', 'semanal'], default: 'diario' },
  // screening = detalle barato (top-10) hasta que el score justifique el completo;
  // los nichos del radar nacen en screening, los manuales en completo
  fase: { type: String, enum: ['screening', 'completo'], default: 'completo' },
  // 'jugada' = sub-nicho automático que aísla la recomendación del analista
  // cuando la keyword madre mezcla familias de producto (caso carpa camping)
  origen: { type: String, enum: ['manual', 'radar', 'jugada'], default: 'manual' },
  // metadata del descubrimiento del radar: razon, estacionalidad, ventanaImportacion
  radarInfo: { type: mongoose.Schema.Types.Mixed, default: null },
  // si origen='jugada': {nichoId, keyword, generadoEl} del nicho padre
  jugadaDe: { type: mongoose.Schema.Types.Mixed, default: null },
  // keywords con las que el usuario marcó "mantener aparte": el agrupador de
  // familias (solape de SKUs) no vuelve a unirlas (falso positivo declarado)
  familiaAparte: { type: [String], default: [] },
  // último borrador de listing generado con IA (títulos, ficha, descripción…)
  listingDraft: { type: mongoose.Schema.Types.Mixed, default: null },
  // campos en inglés para la hoja de cotización al proveedor (rfq.js):
  // { nichoIngles, productoIngles, especificacion, desdeAnalisis, generadoEl }
  rfq: { type: mongoose.Schema.Types.Mixed, default: null },
  // experiencia real del importador con este nicho ("ya vendimos esta paleta,
  // X unidades en Y meses"): el analista la pesa por sobre lo que infiera
  contextoUsuario: { type: String, default: null },
  // embudo de compra tras el veredicto: evaluando → cotizando → pedido (el
  // mínimo/MOQ que pida el proveedor: esa es la prueba) → vendiendo (o
  // descartado). Solo "evaluando" ocupa cupo del radar.
  etapaCompra: {
    type: String,
    enum: ['evaluando', 'cotizando', 'pedido', 'vendiendo', 'en-espera', 'descartado'],
    default: 'evaluando',
  },
  etapaCompraEl: { type: Date, default: null },
  // re-evaluación programada: un descartado estacional vuelve solo a evaluación
  // en esta fecha (la declara el analista al rechazar por ventana, o el usuario)
  revisarEl: { type: Date, default: null },
  vueltaTemporadaEl: { type: Date, default: null }, // para el badge "vuelve por temporada"
  // cotización real del proveedor (EXW por unidad de venta): se compara contra
  // el EXW máximo del análisis y alimenta el margen estimado en la planilla
  exwCotizadoUsd: { type: Number, default: null },
  // costo REAL por unidad puesto en Chile (CLP, todo incluido: producto, flete,
  // internación, despacho). Manda sobre el cálculo desde EXW: es un dato del
  // importador, no una cadena de supuestos (cubicaje/prorrateo ya nos mordió
  // dos veces). Si está, el margen es una resta exacta.
  costoPuestoClp: { type: Number, default: null },
  costoPuestoEl: { type: Date, default: null },
  exwCotizadoEl: { type: Date, default: null },
  // cantidad del pedido fijada a mano en la planilla (pisa la sugerida por el
  // análisis en primeraCompra; null = usar la sugerencia)
  unidadesPedido: { type: Number, default: null },
  // motivo corto de la etapa ("esperando registro ISP", "pensándolo",
  // "esperando respuesta de 3 proveedores") — visible en planilla y oportunidades
  notaEtapa: { type: String, default: null },
  creadoEl: { type: Date, default: Date.now },
  ultimoScanEl: { type: Date, default: null },
  // { total, esMinimo } — "+9.999 resultados" del listado; esMinimo indica que ML capea el contador
  ultimoTotalResultados: { type: mongoose.Schema.Types.Mixed, default: null },
  costoUsd: { type: Number, default: 0 }, // gasto acumulado Apify + LLM atribuible al nicho
})

nichoSchema.index({ keyword: 1, domainCode: 1 }, { unique: true })

export const Nicho = mongoose.model('Nicho', nichoSchema)
