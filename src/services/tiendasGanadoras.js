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

// Pura. Lo que la tienda publica hoy y no estaba entre las publicaciones de antes.
export function publicacionesNuevas(hoy, antes) {
  const vistos = new Set((antes ?? []).map((i) => i.itemId))
  return (hoy ?? []).filter((i) => i.itemId && !vistos.has(i.itemId))
}

// Pura. Número de una publicación de ML y su secuencia. ML numera en orden de
// creación, pero con varias secuencias en paralelo (en oct-2026 conviven
// MLC1…, MLC2…, MLC3… y MLC4… de 10 dígitos, y el mismo día se crean de dos
// de ellas), así que solo se comparan números de la misma secuencia: mismo
// largo y mismo primer dígito.
export function secuenciaId(itemId) {
  const m = /^MLC(\d+)$/.exec(itemId ?? '')
  return m ? { secuencia: `${m[1].length}:${m[1][0]}`, n: Number(m[1]) } : null
}

// Pura. LOS LANZAMIENTOS DE VERDAD de cada tienda en su última lectura.
//
// De cada tienda se lee UNA página (48 publicaciones) y esa página rota: ML
// la ordena por relevancia, no por fecha. Comparar contra la lectura anterior
// marcaba como nuevo todo lo que solo subió a la primera página. Medido el
// 1-nov-2026 sobre todas las lecturas guardadas: nueve de cada diez
// "lanzamientos" eran publicaciones que ya existían, varias con miles de
// vendidos, y el radar las recibía como "lo que publicaron esta semana".
//
// Dos filtros:
//  1. lo que la tienda ya mostró en CUALQUIER lectura anterior no es nuevo;
//  2. una publicación con número menor que otra de su misma secuencia que ya
//     vimos —en cualquier tienda— hasta la lectura anterior ya existía en esa
//     fecha. Lo vendido no sirve para decidirlo: una publicación nueva que se
//     suma a un producto de catálogo muestra lo vendido del catálogo entero.
// Sin número comparable (secuencia nunca vista) se deja pasar: no hay prueba
// de que sea vieja.
export function lanzamientosReales(lecturas) {
  const t = (d) => +new Date(d.capturadoEl)
  const orden = (lecturas ?? []).filter((d) => d?.sellerId && Number.isFinite(t(d))).sort((a, b) => t(a) - t(b))
  const porSeller = new Map()
  for (const d of orden) porSeller.set(d.sellerId, [...(porSeller.get(d.sellerId) ?? []), d])
  const salida = []
  for (const [sellerId, serie] of porSeller) {
    if (serie.length < 2) continue
    const ultima = serie.at(-1), previa = serie.at(-2)
    // lo más nuevo visto por secuencia, en cualquier tienda, hasta la lectura previa
    const techo = new Map()
    for (const d of orden) {
      if (t(d) > t(previa)) break
      for (const i of d.items ?? []) {
        const s = secuenciaId(i.itemId)
        if (s && s.n > (techo.get(s.secuencia) ?? 0)) techo.set(s.secuencia, s.n)
      }
    }
    for (const i of publicacionesNuevas(ultima.items, serie.slice(0, -1).flatMap((d) => d.items ?? []))) {
      const s = secuenciaId(i.itemId)
      if (s && techo.has(s.secuencia) && s.n <= techo.get(s.secuencia)) continue
      salida.push({ ...i, sellerId, vendedor: ultima.vendedor, desde: previa.dia, hasta: ultima.dia })
    }
  }
  // lo más reciente primero: el radar toma solo los primeros
  return salida.sort((a, b) => String(b.hasta).localeCompare(String(a.hasta)))
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
  let leidas = 0, fallos = 0
  const leidasHoy = new Set()
  const { registrarGasto } = await import('./gastos.js')
  for (const [sellerId, vendedor] of tocan) {
    try {
      const items = await leerTienda(sellerId, apiKey)
      await registrarGasto(null, config.zyteCostoListadoUsd, 'zyte')
      await TiendaVendedor.updateOne({ sellerId, dia }, { $setOnInsert: { sellerId, vendedor, dia, items, capturadoEl: ahora } }, { upsert: true })
      leidasHoy.add(sellerId)
      leidas++
    } catch (err) {
      fallos++
      console.warn(`[tiendas] ${sellerId}: ${err.message}`)
    }
  }
  // mismo criterio que el radar: solo lanzamientos de verdad (lanzamientosReales)
  const nuevas = leidas
    ? lanzamientosReales(await TiendaVendedor.find({}).lean()).filter((l) => leidasHoy.has(l.sellerId) && l.hasta === dia).length
    : 0
  console.log(`[tiendas] ${leidas}/${tocan.length} tiendas leídas de ${porSeller.size} vendedores que reponen · ${nuevas} publicaciones nuevas · ${fallos} fallos`)
  return { vendedores: porSeller.size, leidas, nuevas, fallos }
}

// Pura. Lo más reciente primero, con un tope por vendedor: el radar toma solo
// los primeros, y sin tope una tienda que subió una docena de cosas el mismo
// día tapaba a todas las demás (1-nov-2026, apenas se limpió el ruido).
export function repartirPorTienda(lanzamientos, { porTienda = 3, max = 20 } = {}) {
  const cuenta = new Map()
  const salida = []
  for (const l of lanzamientos ?? []) {
    if (salida.length >= max) break
    const c = cuenta.get(l.sellerId) ?? 0
    if (c >= porTienda) continue
    cuenta.set(l.sellerId, c + 1)
    salida.push(l)
  }
  return salida
}

// Lo que publicaron de nuevo los vendedores que ganan, para el radar y la API.
export async function lanzamientosDeGanadores({ max = 20 } = {}) {
  const docs = await TiendaVendedor.find({}).select('sellerId vendedor dia capturadoEl items').lean()
  return repartirPorTienda(lanzamientosReales(docs), { max })
}

export async function estadoTiendas() {
  const [tiendas, lecturas] = await Promise.all([TiendaVendedor.distinct('sellerId'), TiendaVendedor.countDocuments()])
  const ultimas = await TiendaVendedor.find({}).sort({ capturadoEl: -1 }).limit(20).select('sellerId vendedor dia items').lean()
  return { tiendas: tiendas.length, lecturas, ultimas: ultimas.map((t) => ({ vendedor: t.vendedor, sellerId: t.sellerId, dia: t.dia, publicaciones: t.items.length, muestra: t.items.slice(0, 5).map((i) => i.titulo) })),
    lanzamientos: await lanzamientosDeGanadores() }
}
