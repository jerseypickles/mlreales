import mongoose from 'mongoose'

// La forma del año de una keyword, medida en Google Trends (índice 0-100
// relativo a SÍ MISMA — no comparable entre keywords, ver services/estacionalidad.js).
//
// No es un dato del ciclo de scan: se mide una vez y sirve meses, así que vive
// en su propia colección y no dentro del Reporte. Que falte no rompe nada; el
// nicho queda "sin curva" y sigue con la estimación de la IA.
const curvaEstacionalSchema = new mongoose.Schema({
  keyword: { type: String, required: true, unique: true },
  geo: { type: String, default: 'CL' },
  anos: { type: Number, default: 5 },
  // 12 valores, enero a diciembre
  curva: { type: [Number], required: true },
  mesPico: Number,
  mesValle: Number,
  nombreMesPico: String,
  ratioPico: Number,
  // 'alza-suave' = se vende todo el año pero con un bulto: NO abre ventana
  clasificacion: { type: String, enum: ['estacional', 'alza-suave', 'todo-el-año'] },
  promedio: Number,
  // 'google-ads' = volumen absoluto de DataForSEO (fuente primaria);
  // 'trends' = índice 0-100 de Google Trends (contraste, miente en volumen bajo)
  fuente: { type: String, enum: ['google-ads', 'trends'], default: 'trends' },
  // lo que Trends nunca pudo dar: el TAMAÑO, comparable entre keywords
  busquedasMes: Number,
  // ¿EL PRODUCTO ESTÁ VIVO? Últimos 12 meses contra los 12 anteriores. La
  // estacionalidad se cancela sola —cada mes contra el mismo mes del año
  // pasado— y queda la tendencia. Sin esto no se podía distinguir "baja porque
  // es su temporada baja" de "baja porque el mercado se muere", que es la
  // pregunta del importador antes de girar plata a un contenedor.
  variacionInteranualPct: Number,
  salud: { type: String, enum: ['muriendo', 'bajando', 'estable', 'subiendo', 'despegando'], default: null },
  // La frase con la que se MIDIÓ en Google, que puede no ser la del nicho: las
  // keywords nacieron comprimidas ("rizador pelo" son 50 búsquedas/mes,
  // "rizador de pelo" 1.900). El nicho NO se renombra —rompería su serie— así
  // que solo el lado de Google usa la forma buena y la tarjeta lo declara.
  keywordMedida: String,
  correccionFactor: Number,
  competenciaAds: String,
  competenciaIndice: Number,
  cpcUsd: Number,
  medidoEl: { type: Date, required: true },
  // para el cron de relleno: cuántas veces falló y cuándo fue el último intento,
  // así los que Google bloquea no se reintentan en bucle el mismo día
  intentosFallidos: { type: Number, default: 0 },
  ultimoIntento: Date,
})

export const CurvaEstacional = mongoose.model('CurvaEstacional', curvaEstacionalSchema)
