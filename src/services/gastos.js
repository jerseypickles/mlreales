import mongoose from 'mongoose'
import { Nicho } from '../models/Nicho.js'

// Gasto agregado por mes calendario (Apify + LLM): respalda el techo mensual.
// El costo por nicho sigue viviendo en Nicho.costoUsd; esto suma lo del mes.
const gastoSchema = new mongoose.Schema({
  mes: { type: String, unique: true }, // '2026-07'
  usd: { type: Number, default: 0 },
})

export const GastoMensual = mongoose.model('GastoMensual', gastoSchema)

export function mesActual(fecha = new Date()) {
  return fecha.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }).slice(0, 7)
}

export async function registrarGasto(nichoId, usd) {
  if (!usd || !Number.isFinite(usd)) return
  await Promise.all([
    Nicho.updateOne({ _id: nichoId }, { $inc: { costoUsd: usd } }),
    GastoMensual.updateOne({ mes: mesActual() }, { $inc: { usd } }, { upsert: true }),
  ])
}

export async function gastoDelMes() {
  const doc = await GastoMensual.findOne({ mes: mesActual() }).lean()
  return doc?.usd ?? 0
}
