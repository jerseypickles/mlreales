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
const ESTADOS_ML = { paused: 'pausada', closed: 'cerrada', under_review: 'en revisión', inactive: 'inactiva' }
// Las campañas de ML mueven el precio efectivo cada pocos días: anular toda
// ventana con un cambio dejaba a la tienda sin una sola observación. El precio
// de la semana es su promedio ponderado por tiempo, y el rango viaja con la
// observación para que el entrenamiento decida cuánta variación tolera.
function precioDeLaVentana(propio, { desde, hasta, capturada, precioActual }) {
  const cambios = (propio.historialPrecios ?? [])
    .filter((c) => +new Date(c.fecha) >= +desde && +new Date(c.fecha) <= capturada)
    .sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
  if (!cambios.length) return { precio: precioActual, precioMin: precioActual, precioMax: precioActual, cambiosPrecio: 0 }
  if (cambios.some((c) => !(c.anterior > 0) || !(c.nuevo > 0))) return null
  let vigente = cambios[0].anterior, t = +desde, suma = 0
  const vistos = [vigente]
  for (const c of cambios) {
    const fin = Math.min(+new Date(c.fecha), +hasta)
    if (fin > t) { suma += vigente * (fin - t); t = fin }
    vigente = c.nuevo
    if (+new Date(c.fecha) < +hasta) vistos.push(vigente)
  }
  if (+hasta > t) suma += vigente * (+hasta - t)
  return { precio: Math.round(suma / (+hasta - +desde)), precioMin: Math.min(...vistos), precioMax: Math.max(...vistos),
    cambiosPrecio: cambios.filter((c) => +new Date(c.fecha) < +hasta).length }
}

// Devuelve la observación o el MOTIVO por el que no existe: un registro que
// descarta en silencio no se distingue de uno roto.
export function diagnosticoObservacion(propio, ventas, { desdeSincronizado, ahora = new Date() }) {
  const no = (motivo) => ({ observacion: null, motivo })
  const ultima = [...(propio.mediciones ?? [])].sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha)).at(-1)
  if (!ultima) return no('sin mediciones')
  if (!desdeSincronizado || !Number.isFinite(+new Date(desdeSincronizado))) return no('órdenes sin sincronizar')
  if (!propio.categoriaMl) return no('sin categoría de ML')
  // ML pausa sola la publicación que se queda sin stock: eso no es "sin
  // visitas", es un quiebre, y el diagnóstico tiene que nombrarlo así.
  if (propio.estadoMl && propio.estadoMl !== 'active') {
    const estado = ESTADOS_ML[propio.estadoMl] ?? propio.estadoMl
    return no(ultima.stock === 0 ? `${estado} por quiebre de stock` : `publicación ${estado} en ML`)
  }
  if (!Number.isFinite(ultima.visitas) || ultima.visitas < 1) return no('sin visitas en la semana')
  if (!ultima.visitasDesde || !ultima.visitasHasta) return no('ML no declaró las fechas de la ventana de visitas')
  const hasta = new Date(ultima.visitasHasta), desde = new Date(ultima.visitasDesde)
  const capturada = +new Date(ultima.fecha)
  if (!Number.isFinite(+hasta) || !Number.isFinite(+desde) || Math.abs(+hasta - +desde - 7 * DIA) > 1000) return no('la ventana de visitas no mide siete días')
  if (!Number.isFinite(capturada) || capturada > +ahora || +ahora - capturada > 6 * 3600e3) return no('última medición con más de seis horas')
  if (+hasta > capturada || +ahora - +hasta > 2 * DIA) return no('ventana de visitas desfasada de la medición')
  if (+new Date(desdeSincronizado) > +desde) return no('las órdenes sincronizadas no cubren la ventana')
  const precioActual = ultima.precioEfectivo ?? ultima.precio
  const logistica = propio.envioMl?.logistica
  if (!Number.isFinite(precioActual) || precioActual <= 0) return no('sin precio')
  if (!logistica) return no('sin logística medida')
  // Un cambio de logística dentro de la ventana no se etiqueta con la del
  // último día. Tampoco se enseña un quiebre como poca demanda.
  if ((propio.historialLogistica ?? []).some((c) => +new Date(c.fecha) >= +desde && +new Date(c.fecha) <= capturada)) return no('cambio de logística dentro de la ventana')
  const precios = precioDeLaVentana(propio, { desde, hasta, capturada, precioActual })
  if (!precios) return no('cambio de precio sin valores registrados')
  const stock = new Map((propio.stockDiario ?? []).map((s) => [s.dia, s]))
  const dias = new Set([diaChile(new Date(+hasta - 1))])
  for (let t = +desde; t < +hasta; t += DIA / 2) dias.add(diaChile(new Date(t)))
  for (const dia of dias) {
    const s = stock.get(dia)
    if (!s || s.mediciones < 1) return no(`sin registro de stock el ${dia}`)
    if (s.conStock !== s.mediciones) return no(`sin stock parte del ${dia}`)
  }
  const itemId = propio.itemIdMl ?? propio.sku
  const ordenes = new Set()
  let unidades = 0
  for (const v of ventas) {
    if (v.orderId == null || !Number.isFinite(+new Date(v.fecha)) || v.estado !== 'paid' || +new Date(v.fecha) < +desde || +new Date(v.fecha) >= +hasta || ordenes.has(String(v.orderId))) continue
    ordenes.add(String(v.orderId))
    for (const item of v.items ?? []) if (item.itemId === itemId && Number.isFinite(item.cantidad) && item.cantidad > 0) unidades += item.cantidad
  }
  return { motivo: null, observacion: { itemId, titulo: propio.titulo, nichoId: propio.nichoId ?? null, categoria: propio.categoriaMl,
    desde, hasta, dia: diaChile(hasta), visitas: ultima.visitas, unidades, ...precios, full: logistica === 'fulfillment' } }
}

export const observacionDeProducto = (propio, ventas, opciones) => diagnosticoObservacion(propio, ventas, opciones).observacion

export async function registrarObservacionesPropias(sincronizacion, { ahora = new Date() } = {}) {
  if (!sincronizacion?.completa) return { guardadas: 0, validas: 0, descartes: [], motivo: 'sin sincronización completa de órdenes' }
  const propios = await ProductoPropio.find({ estado: 'activo' }).lean()
  const ventas = await VentaMl.find({ fecha: { $gte: new Date(+ahora - 8 * DIA) }, estado: 'paid' }).lean()
  const diagnosticos = propios.map((p) => ({ itemId: p.itemIdMl ?? p.sku, titulo: p.titulo,
    ...diagnosticoObservacion(p, ventas, { ahora, desdeSincronizado: sincronizacion.desde }) }))
  const observaciones = diagnosticos.map((d) => d.observacion).filter(Boolean)
  const descartes = diagnosticos.filter((d) => !d.observacion).map(({ itemId, titulo, motivo }) => ({ itemId, titulo, motivo }))
  if (!observaciones.length) return { guardadas: 0, validas: 0, descartes, motivo: 'sin ventanas completas con stock y atributos estables' }
  const r = await ObservacionProductoMl.bulkWrite(observaciones.map((o) => ({ updateOne: {
    filter: { itemId: o.itemId, dia: o.dia }, update: { $setOnInsert: o }, upsert: true,
  } })))
  return { guardadas: r.upsertedCount, validas: observaciones.length, descartes }
}

// El mismo diagnóstico, en vivo y sin escribir: por qué cada producto tiene o
// no una semana admisible ahora mismo. Supone la ventana de 90 días con que
// corre la sincronización de órdenes.
export async function diagnosticoObservacionesPropias({ ahora = new Date() } = {}) {
  const propios = await ProductoPropio.find({ estado: 'activo' }).lean()
  return propios.map((p) => {
    const d = diagnosticoObservacion(p, [], { ahora, desdeSincronizado: new Date(+ahora - 90 * DIA) })
    return { itemId: p.itemIdMl ?? p.sku, titulo: p.titulo, admisible: !!d.observacion, motivo: d.motivo,
      visitas: d.observacion?.visitas ?? null }
  })
}
