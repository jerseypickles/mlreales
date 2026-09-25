import mongoose from 'mongoose'
import { config } from '../config/env.js'
import { SeguimientoStock } from '../models/SeguimientoStock.js'
import { itemsDesdeHtml, cuerpoListado } from './listadoMl.js'

// TIENDAS DE LOS VENDEDORES QUE GANAN: qué productos nuevos están trayendo.
//
// El seguimiento de stock detecta vendedores que VENDEN Y REPONEN (15 al
// 25-sep-2026): importadores como el usuario a los que les va bien. Leer su
// tienda una vez por semana muestra qué publican de nuevo — un importador que
// ya demostró que vende rara vez sube un producto al azar. Un listado de Zyte
// por vendedor y semana (~US$0,5 al mes con 15 vendedores).

const DIA = 86400e3
const CADA_DIAS = 7
const POR_PASADA = 5

const schema = new mongoose.Schema({
  sellerId: { type: String, required: true },
  vendedor: { type: String, default: null },
  dia: { type: String, required: true },
  items: { type: [{ _id: false, itemId: String, titulo: String, precio: Number, vendidos: Number, url: String, imagen: String }], default: [] },
  capturadoEl: { type: Date, required: true },
}, { versionKey: false })
schema.index({ sellerId: 1, dia: -1 }, { unique: true })
export const TiendaVendedor = mongoose.models.TiendaVendedor ?? mongoose.model('TiendaVendedor', schema)

export const urlTienda = (sellerId) => `https://listado.mercadolibre.cl/_CustId_${sellerId}`

// Pura. Lo que la tienda publica hoy y no tenía en la lectura anterior.
export function publicacionesNuevas(hoy, antes) {
  const vistos = new Set((antes ?? []).map((i) => i.itemId))
  return (hoy ?? []).filter((i) => i.itemId && !vistos.has(i.itemId))
}

async function leerTienda(sellerId, apiKey) {
  // el mismo cuerpo del listado por keyword (espera + scroll), otra URL
  const cuerpo = { ...cuerpoListado('x'), url: urlTienda(sellerId) }
  const r = await fetch('https://api.zyte.com/v1/extract', {
    method: 'POST', signal: AbortSignal.timeout(280_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` },
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`Zyte HTTP ${r.status}`)
  const html = (await r.json())?.browserHtml ?? ''
  return itemsDesdeHtml(html, { keyword: `tienda ${sellerId}` }).map((i) => ({
    itemId: i.itemId ?? null, titulo: i.articuloTitulo ?? null, precio: i.nuevoPrecio ?? null,
    vendidos: i.cantidadVendida ?? null, url: i.zProductoLink ?? null, imagen: i.imgDireccion ?? null,
  })).filter((i) => i.itemId)
}

// Una pasada: las tiendas de vendedores que reponen cuya lectura venció.
export async function pasadaTiendas({ ahora = new Date(), apiKey = config.zyteApiKey } = {}) {
  if (!apiKey) return { motivo: 'sin ZYTE_API_KEY' }
  const ganadores = await SeguimientoStock.find({ esPropio: false, reposicionesVistas: { $gt: 0 } }).select('sellerId vendedor ultima.sellerId').lean()
  const porSeller = new Map()
  for (const g of ganadores) { const id = g.sellerId ?? g.ultima?.sellerId; if (id && !porSeller.has(id)) porSeller.set(id, g.vendedor ?? null) }
  const dia = new Date(ahora).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
  const recientes = new Set(await TiendaVendedor.distinct('sellerId', { capturadoEl: { $gte: new Date(+ahora - CADA_DIAS * DIA) } }))
  const tocan = [...porSeller].filter(([id]) => !recientes.has(id)).slice(0, POR_PASADA)
  let leidas = 0, nuevas = 0, fallos = 0
  const { registrarGasto } = await import('./gastos.js')
  for (const [sellerId, vendedor] of tocan) {
    try {
      const items = await leerTienda(sellerId, apiKey)
      await registrarGasto(null, config.zyteCostoListadoUsd, 'zyte')
      const antes = await TiendaVendedor.findOne({ sellerId }).sort({ dia: -1 }).lean()
      await TiendaVendedor.updateOne({ sellerId, dia }, { $setOnInsert: { sellerId, vendedor, dia, items, capturadoEl: ahora } }, { upsert: true })
      if (antes) nuevas += publicacionesNuevas(items, antes.items).length
      leidas++
    } catch (err) {
      fallos++
      console.warn(`[tiendas] ${sellerId}: ${err.message}`)
    }
  }
  console.log(`[tiendas] ${leidas}/${tocan.length} tiendas leídas de ${porSeller.size} vendedores que reponen · ${nuevas} publicaciones nuevas · ${fallos} fallos`)
  return { vendedores: porSeller.size, leidas, nuevas, fallos }
}

// Lo que publicaron de nuevo los vendedores que ganan, para el radar y la API.
export async function lanzamientosDeGanadores({ max = 20 } = {}) {
  const docs = await TiendaVendedor.find({}).sort({ dia: -1 }).lean()
  const porSeller = new Map()
  for (const d of docs) porSeller.set(d.sellerId, [...(porSeller.get(d.sellerId) ?? []), d])
  const salida = []
  for (const [, serie] of porSeller) {
    if (serie.length < 2) continue
    for (const i of publicacionesNuevas(serie[0].items, serie[1].items)) salida.push({ ...i, vendedor: serie[0].vendedor, desde: serie[1].dia, hasta: serie[0].dia })
  }
  return salida.slice(0, max)
}

export async function estadoTiendas() {
  const [tiendas, lecturas] = await Promise.all([TiendaVendedor.distinct('sellerId'), TiendaVendedor.countDocuments()])
  const ultimas = await TiendaVendedor.find({}).sort({ capturadoEl: -1 }).limit(20).select('sellerId vendedor dia items').lean()
  return { tiendas: tiendas.length, lecturas, ultimas: ultimas.map((t) => ({ vendedor: t.vendedor, sellerId: t.sellerId, dia: t.dia, publicaciones: t.items.length, muestra: t.items.slice(0, 5).map((i) => i.titulo) })),
    lanzamientos: await lanzamientosDeGanadores() }
}
