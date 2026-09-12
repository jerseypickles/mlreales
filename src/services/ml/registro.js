import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { SerieNichoMl } from '../../models/SerieNichoMl.js'
import { ObservacionProductoMl } from '../../models/ObservacionProductoMl.js'
import { ProductoPropio } from '../../models/ProductoPropio.js'
import { VentaMl } from '../../models/VentaMl.js'
import { normalizarMeses, indiceMes } from './series.js'
import { diaChile } from '../inventarioFull.js'

export const huellaDe = (dato) => createHash('sha256').update(JSON.stringify(dato)).digest('hex')

export async function guardarSeriesMl(resultados, { pais, idioma, ahora = new Date() }) {
  if (mongoose.connection.readyState !== 1) return { guardadas: 0, motivo: 'sin MongoDB' }
  const ops = resultados.flatMap((r) => {
    const mesCaptura = indiceMes(ahora.toISOString().slice(0, 7))
    const meses = normalizarMeses(r.monthly_searches).filter((m) => indiceMes(m.periodo) < mesCaptura)
    if (typeof r.keyword !== 'string' || !r.keyword.trim() || !meses.length) return []
    const dato = { keyword: r.keyword, pais, idioma, fuente: 'google-ads', meses }
    // El cero completo también se conserva: excluirlo sesgaría el entrenamiento.
    const huella = huellaDe({ ...dato, dia: ahora.toISOString().slice(0, 10) })
    return [{ updateOne: { filter: { huella }, update: { $setOnInsert: { ...dato, huella, capturadoEl: ahora } }, upsert: true } }]
  })
  if (!ops.length) return { guardadas: 0 }
  const r = await SerieNichoMl.bulkWrite(ops)
  return { guardadas: r.upsertedCount }
}

const DIA = 86400e3
export function observacionDeProducto(propio, ventas, { desdeSincronizado, ahora = new Date() }) {
  const ultima = [...(propio.mediciones ?? [])].sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha)).at(-1)
  if (!ultima || !desdeSincronizado || !propio.categoriaMl || !Number.isFinite(ultima.visitas) || ultima.visitas < 1) return null
  if (!ultima.visitasDesde || !ultima.visitasHasta) return null
  const hasta = new Date(ultima.visitasHasta), desde = new Date(ultima.visitasDesde)
  const capturada = +new Date(ultima.fecha)
  if (!Number.isFinite(+hasta) || !Number.isFinite(+desde) || Math.abs(+hasta - +desde - 7 * DIA) > 1000 ||
      !Number.isFinite(capturada) || capturada > +ahora || +ahora - capturada > 6 * 3600e3 ||
      +hasta > capturada || +ahora - +hasta > 2 * DIA ||
      +new Date(desdeSincronizado) > +desde || !Number.isFinite(+new Date(desdeSincronizado))) return null
  const precio = ultima.precioEfectivo ?? ultima.precio
  const logistica = propio.envioMl?.logistica
  if (!Number.isFinite(precio) || precio <= 0 || !logistica) return null
  // Un cambio de precio/logística dentro de la ventana no se etiqueta con
  // los atributos del último día. Tampoco se enseña un quiebre como poca demanda.
  const cambios = [...(propio.historialPrecios ?? []), ...(propio.historialLogistica ?? [])]
  if (cambios.some((c) => +new Date(c.fecha) >= +desde && +new Date(c.fecha) <= capturada)) return null
  const stock = new Map((propio.stockDiario ?? []).map((s) => [s.dia, s]))
  const dias = new Set([diaChile(new Date(+hasta - 1))])
  for (let t = +desde; t < +hasta; t += DIA / 2) dias.add(diaChile(new Date(t)))
  for (const dia of dias) {
    const s = stock.get(dia)
    if (!s || s.mediciones < 1 || s.conStock !== s.mediciones) return null
  }
  const itemId = propio.itemIdMl ?? propio.sku
  const ordenes = new Set()
  let unidades = 0
  for (const v of ventas) {
    if (v.orderId == null || !Number.isFinite(+new Date(v.fecha)) || v.estado !== 'paid' || +new Date(v.fecha) < +desde || +new Date(v.fecha) >= +hasta || ordenes.has(String(v.orderId))) continue
    ordenes.add(String(v.orderId))
    for (const item of v.items ?? []) if (item.itemId === itemId && Number.isFinite(item.cantidad) && item.cantidad > 0) unidades += item.cantidad
  }
  return { itemId, titulo: propio.titulo, nichoId: propio.nichoId ?? null, categoria: propio.categoriaMl,
    desde, hasta, dia: diaChile(hasta), visitas: ultima.visitas, unidades, precio, full: logistica === 'fulfillment' }
}

export async function registrarObservacionesPropias(sincronizacion, { ahora = new Date() } = {}) {
  if (!sincronizacion?.completa) return { guardadas: 0, motivo: 'sin sincronización completa de órdenes' }
  const propios = await ProductoPropio.find({ estado: 'activo' }).lean()
  const ventas = await VentaMl.find({ fecha: { $gte: new Date(+ahora - 8 * DIA) }, estado: 'paid' }).lean()
  const observaciones = propios.map((p) => observacionDeProducto(p, ventas, { ahora, desdeSincronizado: sincronizacion.desde })).filter(Boolean)
  if (!observaciones.length) return { guardadas: 0, motivo: 'sin ventanas completas con stock y atributos estables' }
  const r = await ObservacionProductoMl.bulkWrite(observaciones.map((o) => ({ updateOne: {
    filter: { itemId: o.itemId, dia: o.dia }, update: { $setOnInsert: o }, upsert: true,
  } })))
  return { guardadas: r.upsertedCount }
}
