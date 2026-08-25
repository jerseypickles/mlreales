import mongoose from 'mongoose'

// Último valor conocido de un indicador (dólar observado, UF). Existe para que
// un reinicio no vuelva a costear con el número viejo del archivo: la fuente
// tarda entre 6 y 15 segundos, así que el valor se sirve de acá y se refresca
// por detrás.
const indicadorSchema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true }, // 'dolar' | 'uf'
  valor: { type: Number, required: true },
  fecha: { type: Date, default: null }, // el día que publica el Banco Central
  fuente: { type: String, default: null },
  leidoEl: { type: Date, default: Date.now },
})

export const Indicador = mongoose.model('Indicador', indicadorSchema)
