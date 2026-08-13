import mongoose from 'mongoose'

// UN CAMBIO A LA VEZ, CON SU ANTES CONGELADO.
//
// El objetivo de ROAS es un dial por campaña, y la campaña tiene varios
// productos adentro: si se mueve el dial y al mismo tiempo se prenden o apagan
// anuncios, después no hay forma de saber qué causó qué. Este registro guarda
// la foto previa en el momento del cambio para que la comparación sea real y
// no un recuerdo.
//
// La escritura por API está cerrada (mclics rechaza con 401 aunque el permiso
// esté puesto), así que el cambio lo aplica el importador en el panel y acá se
// anota qué se movió y cuándo.
const ventana = {
  dias: Number,
  prints: Number,
  clicks: Number,
  costo: Number,
  cpc: Number,
  acos: Number,
  unidades: Number,
  venta: Number,
  organicas: Number,
  // lo que de verdad decide: venta ÷ gasto
  roasReal: Number,
}

const experimentoAdsSchema = new mongoose.Schema({
  campanaId: { type: Number, required: true },
  campanaNombre: String,
  campo: { type: String, default: 'roas_target' },
  valorAntes: Number,
  valorDespues: Number,
  hipotesis: String,
  inicioEl: { type: Date, required: true },
  finEl: Date,
  baseline: ventana,
  // El día del cambio queda partido en dos regímenes: ML reporta por día
  // completo, así que sin esto el día 1 mezcla las horas viejas con las nuevas.
  // Guardando lo acumulado en el instante del cambio, ese día se vuelve medible
  // por resta en vez de descartable.
  corteDiaCambio: {
    fecha: String,
    prints: Number,
    clicks: Number,
    costo: Number,
    unidades: Number,
    leidoEl: Date,
  },
  estado: { type: String, enum: ['corriendo', 'cerrado'], default: 'corriendo' },
  // conclusión escrita a mano cuando se cierra: qué se aprendió
  conclusion: String,
})

experimentoAdsSchema.index({ campanaId: 1, inicioEl: -1 })

export const ExperimentoAds = mongoose.model('ExperimentoAds', experimentoAdsSchema)
