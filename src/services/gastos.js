import mongoose from 'mongoose'
import { Nicho } from '../models/Nicho.js'

// Gasto agregado por mes calendario (Apify + LLM): respalda el techo mensual.
// El costo por nicho sigue viviendo en Nicho.costoUsd; esto suma lo del mes.
const gastoSchema = new mongoose.Schema({
  mes: { type: String, unique: true }, // '2026-07'
  usd: { type: Number, default: 0 },
})

export const GastoMensual = mongoose.model('GastoMensual', gastoSchema)

// Mismo gasto, abierto por DÍA y por FUENTE. Existe porque el contador mensual
// suma scraping e IA en un solo número y no permitía responder "¿cuánto se
// gasta en IA al día?" — el costo por llamada al LLM se registraba y se perdía.
// Dos docs por día, sin migración: el mensual sigue mandando en el presupuesto.
const gastoDiarioSchema = new mongoose.Schema({
  dia: { type: String }, // '2026-08-10' en hora de Chile
  fuente: { type: String, enum: ['ia', 'apify'] },
  usd: { type: Number, default: 0 },
  llamadas: { type: Number, default: 0 },
})
gastoDiarioSchema.index({ dia: 1, fuente: 1 }, { unique: true })

export const GastoDiario = mongoose.model('GastoDiario', gastoDiarioSchema)

const enChile = (fecha) => fecha.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })

export function mesActual(fecha = new Date()) {
  return enChile(fecha).slice(0, 7)
}

export function diaActual(fecha = new Date()) {
  return enChile(fecha)
}

// fuente: 'ia' (llamada al LLM) | 'apify' (corrida de actor). Es obligatoria a
// propósito: un gasto sin clasificar vuelve a mezclar las dos cosas.
export async function registrarGasto(nichoId, usd, fuente) {
  if (!usd || !Number.isFinite(usd)) return
  if (fuente !== 'ia' && fuente !== 'apify') {
    throw new Error(`registrarGasto: fuente debe ser 'ia' o 'apify' (llegó ${JSON.stringify(fuente)})`)
  }
  await Promise.all([
    // nichoId null = gasto del sistema sin nicho (ej: scan de productos propios)
    nichoId ? Nicho.updateOne({ _id: nichoId }, { $inc: { costoUsd: usd } }) : Promise.resolve(),
    GastoMensual.updateOne({ mes: mesActual() }, { $inc: { usd } }, { upsert: true }),
    GastoDiario.updateOne({ dia: diaActual(), fuente }, { $inc: { usd, llamadas: 1 } }, { upsert: true }),
  ])
}

export async function gastoDelMes() {
  const doc = await GastoMensual.findOne({ mes: mesActual() }).lean()
  return doc?.usd ?? 0
}

// Gasto de IA atribuible a cada nicho, sumando el costo que cada análisis
// guarda en su propio reporte. Nicho.costoUsd mezcla actor y LLM; esto aísla
// la IA y además dice cuántos análisis se le corrieron.
export async function iaPorNicho({ limite = 15 } = {}) {
  const { Reporte } = await import('../models/Reporte.js')
  const filas = await Reporte.aggregate([
    { $match: { 'analisis.costoUsd': { $gt: 0 } } },
    { $group: { _id: '$nichoId', keyword: { $last: '$keyword' }, usd: { $sum: '$analisis.costoUsd' }, analisis: { $sum: 1 } } },
    { $sort: { usd: -1 } },
    { $limit: limite },
  ])
  return filas.map((f) => ({
    nichoId: f._id,
    keyword: f.keyword,
    usd: Math.round(f.usd * 1000) / 1000,
    analisis: f.analisis,
    usdPorAnalisis: Math.round((f.usd / f.analisis) * 1000) / 1000,
  }))
}

// Frenar ANTES del muro de Apify, no al chocar: los jobs queman 3 reintentos
// por job cuando el actor rechaza por límite.
export const UMBRAL_APIFY = 0.9

// ¿Hay presupuesto para gastar? Son DOS preguntas distintas y confundirlas
// rompe cosas en las dos direcciones:
//
//  · scraping — lo frena el contador interno O el tope real de Apify. El
//    interno subcuenta (Apify no siempre devuelve el costo de la corrida, y
//    registrarGasto descarta el gasto vacío), así que por sí solo es un freno
//    que puede no dispararse nunca. Hasta ahora solo el programador miraba el
//    saldo real; radar, cableador, subnichos, propios y la auditoría no.
//
//  · ia — la frena SOLO el contador interno. Que Apify esté en su tope no es
//    razón para no correr el estratega ni revisar una ficha: no gastan actor.
// Decisión pura, con los tres números ya reunidos: se testea sin Mongo, sin
// red y sin parchar módulos.
export function decidirPresupuesto({ gastadoUsd, techoUsd, apify }) {
  const interno = gastadoUsd >= techoUsd
  const motivoInterno = `presupuesto mensual agotado (US$ ${gastadoUsd.toFixed(2)} de ${techoUsd})`
  const apifyTocado =
    Number.isFinite(apify?.topeUsd) && Number.isFinite(apify?.gastadoUsd) && apify.gastadoUsd >= apify.topeUsd * UMBRAL_APIFY

  return {
    gastadoUsd,
    apify: apify ?? null,
    ia: { agotado: interno, motivo: interno ? motivoInterno : null },
    scraping: {
      agotado: interno || apifyTocado,
      motivo: interno
        ? motivoInterno
        : apifyTocado
          ? `Apify al ${Math.round((apify.gastadoUsd / apify.topeUsd) * 100)}% de su tope (US$ ${apify.gastadoUsd.toFixed(2)} de ${apify.topeUsd}), ciclo hasta ${String(apify.cicloHasta ?? '').slice(0, 10)}`
          : null,
    },
  }
}

export async function presupuesto() {
  const gastadoUsd = await gastoDelMes()
  const { config } = await import('../config/env.js')
  let apify = null
  try {
    const { saldoApify } = await import('./apify.js')
    apify = await saldoApify()
  } catch {
    // sin saldo de Apify se cae al contador interno: mejor seguir midiendo
    // que detener el tablero porque su API no respondió
  }
  return decidirPresupuesto({ gastadoUsd, techoUsd: config.presupuestoUsdMes, apify })
}

// Serie diaria por fuente, del más reciente al más antiguo, con el promedio
// por día de los días que efectivamente tuvieron gasto.
export async function gastoPorDia({ dias = 30 } = {}) {
  const desde = new Date(Date.now() - dias * 86_400e3)
  const filas = await GastoDiario.find({ dia: { $gte: diaActual(desde) } })
    .sort({ dia: -1 })
    .lean()

  const porDia = new Map()
  for (const f of filas) {
    const entrada = porDia.get(f.dia) ?? { dia: f.dia, ia: 0, apify: 0, llamadasIa: 0 }
    entrada[f.fuente] = Math.round(f.usd * 1000) / 1000
    if (f.fuente === 'ia') entrada.llamadasIa = f.llamadas
    porDia.set(f.dia, entrada)
  }
  const serie = [...porDia.values()]
  const suma = (campo) => serie.reduce((s, d) => s + (d[campo] ?? 0), 0)
  const conIa = serie.filter((d) => d.ia > 0).length

  return {
    serie,
    totales: {
      ia: Math.round(suma('ia') * 100) / 100,
      apify: Math.round(suma('apify') * 100) / 100,
      llamadasIa: suma('llamadasIa'),
      diasConGasto: serie.length,
      // promedio sobre los días que gastaron: con 38 nichos en semanal hay
      // días sin análisis, y dividir por 30 escondería el costo de un día real
      promedioIaPorDiaActivo: conIa ? Math.round((suma('ia') / conIa) * 100) / 100 : 0,
    },
  }
}
