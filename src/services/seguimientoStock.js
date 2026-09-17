import { SeguimientoStock, LecturaStock } from '../models/SeguimientoStock.js'
import { Nicho } from '../models/Nicho.js'
import { Snapshot } from '../models/Snapshot.js'
import { Producto } from '../models/Producto.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { VentaMl } from '../models/VentaMl.js'
import { buscarDetalle } from './scraper.js'
import { registrarGasto } from './gastos.js'
import { ventaEntreLecturas } from './metricas.js'
import { ventanaDeCompra } from './ventana.js'
import { config } from '../config/env.js'

const HORA = 3600e3
const DIA = 86400e3
// el tope es del importador: "¿podría ajustarse a $30 al mes?"
export const TOPE_USD_MES = Number(process.env.SEGUIMIENTO_USD_MES) || 30
const POR_NICHO = Number(process.env.SEGUIMIENTO_POR_NICHO) || 6
const MAX_POR_PASADA = 40

// CADA CUÁNTO SE LEE, SEGÚN CUÁNTO SE PUEDE VER. La plata va donde hay
// información: en "+50" no se ve nada; cerca de un cambio de balde, un día
// importa; con el número exacto a la vista, cada lectura es una venta contada.
export function horasHastaLaProxima(ultima) {
  if (!ultima || !Number.isFinite(ultima.stock)) return 24
  if (ultima.topado && ultima.stock >= 51) return 168 // "+50": una vez por semana
  if (ultima.topado && ultima.stock >= 11) return 24 // "+10" y "+25"
  if (ultima.stock === 0) return 24 // agotado: esperar la reposición
  return 12 // "+5" o número exacto
}

// Pura. De los productos del último scan de un nicho, a quién vale la pena
// seguir: vendedor que no es tienda oficial, con stock VISIBLE (no "+50") y lo
// más arriba posible en el listado. Uno por vendedor: interesa ver a varios
// entrantes distintos, no tres publicaciones de la misma tienda.
export function elegirParaSeguir(productos, { max = POR_NICHO } = {}) {
  const vistos = new Set()
  return (productos ?? [])
    .filter((p) => p.url && p.stockFuente === 'texto' && Number.isFinite(p.stock) && !(p.stockTopado && p.stock >= 51) && p.esTiendaOficial !== true && p.esAnuncio !== true)
    .sort((a, b) => (a.posicion ?? 999) - (b.posicion ?? 999))
    .filter((p) => {
      const v = p.vendedor ?? p.sku
      if (vistos.has(v)) return false
      vistos.add(v)
      return true
    })
    .slice(0, max)
}

// Qué nichos se siguen: los que están en cotización o pedido, y los de
// temporada con la ventana de compra abierta. Es donde una decisión de compra
// está cerca y saber si el chico vende cambia algo.
async function nichosQueImportan() {
  const { CurvaEstacional } = await import('../models/CurvaEstacional.js')
  const nichos = await Nicho.find({ estado: 'activo' }).select('keyword etapaCompra radarInfo ventanaCompra').lean()
  const curvas = new Map((await CurvaEstacional.find({ keyword: { $in: nichos.map((n) => n.keyword) } }).select('keyword clasificacion mesPico ratioPico nombreMesPico').lean()).map((c) => [c.keyword, c]))
  return nichos.filter((n) => {
    if (['cotizando', 'pedido'].includes(n.etapaCompra)) return true
    const v = ventanaDeCompra({ keyword: n.keyword, ventanaCompra: n.ventanaCompra, estacionalidad: n.radarInfo?.estacionalidad, curvaAnual: curvas.get(n.keyword) })
    return ['ahora', 'ultimo-mes'].includes(v?.estado)
  })
}

// Una vez al día: suma a la lista lo que el último scan de cada nicho dejó ver,
// y las publicaciones propias (para calibrar). No saca a nadie: eso lo decide
// la lectura, cuando una publicación pasa semanas en "+50" o desaparece.
export async function actualizarLista({ ahora = new Date() } = {}) {
  let agregados = 0
  for (const n of await nichosQueImportan()) {
    const yaSeguidos = await SeguimientoStock.countDocuments({ nichoId: n._id, activo: true, esPropio: false })
    if (yaSeguidos >= POR_NICHO) continue
    const ultimo = await Snapshot.findOne({ keyword: n.keyword, stock: { $ne: null } }).sort({ fecha: -1 }).select('fecha').lean()
    if (!ultimo) continue
    const snaps = await Snapshot.find({ keyword: n.keyword, fecha: ultimo.fecha, stock: { $ne: null } }).select('sku posicion stock stockTopado stockFuente esAnuncio').lean()
    const prods = new Map((await Producto.find({ sku: { $in: snaps.map((s) => s.sku) } }).select('sku url titulo imagen vendedor esTiendaOficial').lean()).map((p) => [p.sku, p]))
    const candidatos = elegirParaSeguir(snaps.map((s) => ({ ...s, ...(prods.get(s.sku) ?? {}) })), { max: POR_NICHO - yaSeguidos })
    for (const c of candidatos) {
      const r = await SeguimientoStock.updateOne({ sku: c.sku }, { $setOnInsert: { sku: c.sku, url: c.url, nichoId: n._id, keyword: n.keyword,
        titulo: c.titulo ?? null, imagen: c.imagen ?? null, vendedor: c.vendedor ?? null, agregadoEl: ahora,
        // la lectura del scan cuenta como la primera: ya se pagó
        ultima: { fecha: ultimo.fecha, stock: c.stock, topado: c.stockTopado === true, fuente: c.stockFuente },
        proximaLecturaEl: new Date(+ultimo.fecha + horasHastaLaProxima({ stock: c.stock, topado: c.stockTopado }) * HORA) } }, { upsert: true })
      if (r.upsertedCount) {
        agregados++
        await LecturaStock.create({ sku: c.sku, fecha: ultimo.fecha, stock: c.stock, topado: c.stockTopado === true, fuente: c.stockFuente, costoUsd: 0 })
      }
    }
  }
  for (const p of await ProductoPropio.find({ estado: 'activo', url: { $ne: null } }).select('sku itemIdMl url titulo imagen nichoId').lean()) {
    const r = await SeguimientoStock.updateOne({ sku: p.sku }, { $setOnInsert: { sku: p.sku, url: p.url, nichoId: p.nichoId ?? null, titulo: p.titulo ?? null,
      imagen: p.imagen ?? null, vendedor: 'propio', esPropio: true, itemIdPropio: p.itemIdMl ?? p.sku, agregadoEl: ahora, proximaLecturaEl: ahora } }, { upsert: true })
    agregados += r.upsertedCount ?? 0
  }
  return { agregados, activos: await SeguimientoStock.countDocuments({ activo: true }) }
}

export async function gastoDelMes({ ahora = new Date() } = {}) {
  const inicio = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1))
  const [m] = await LecturaStock.aggregate([{ $match: { fecha: { $gte: inicio } } }, { $group: { _id: null, usd: { $sum: '$costoUsd' }, lecturas: { $sum: 1 } } }])
  const [h] = await LecturaStock.aggregate([{ $match: { fecha: { $gte: new Date(+ahora - DIA) } } }, { $group: { _id: null, usd: { $sum: '$costoUsd' } } }])
  return { mesUsd: m?.usd ?? 0, lecturasMes: m?.lecturas ?? 0, ultimas24hUsd: h?.usd ?? 0 }
}

// Lee lo que toca, hasta donde alcanza la plata. Dos frenos: el del mes y uno
// diario (tope ÷ 30) para que un día malo no se coma la semana.
export async function leerPendientes({ ahora = new Date(), leer = buscarDetalle } = {}) {
  const gasto = await gastoDelMes({ ahora })
  const costo = config.zyteCostoFichaUsd
  const porPlata = Math.floor(Math.min(TOPE_USD_MES - gasto.mesUsd, TOPE_USD_MES / 30 - gasto.ultimas24hUsd) / costo)
  if (porPlata <= 0) return { leidas: 0, motivo: 'tope de gasto alcanzado', gasto }
  const pendientes = await SeguimientoStock.find({ activo: true, proximaLecturaEl: { $lte: ahora } })
    // lo propio primero (calibra), después lo más atrasado
    .sort({ esPropio: -1, proximaLecturaEl: 1 }).limit(Math.min(porPlata, MAX_POR_PASADA)).lean()
  if (!pendientes.length) return { leidas: 0, motivo: 'nada pendiente', gasto }
  const { items, costoUsd } = await leer(pendientes.map((p) => p.url))
  await registrarGasto(null, costoUsd, 'zyte')
  const cadaUna = costoUsd / pendientes.length
  let leidas = 0, bajas = 0
  for (const p of pendientes) {
    const it = items.find((i) => i.sku === p.sku) ?? items.find((i) => i.url && (i.url === p.url || i.url.includes(p.sku)))
    if (!it || !Number.isFinite(it.stockQuantity)) {
      // pagada igual. Tres fallos seguidos = la publicación ya no existe
      await LecturaStock.create({ sku: p.sku, fecha: ahora, ok: false, costoUsd: cadaUna })
      const fallos = (p.fallosSeguidos ?? 0) + 1
      await SeguimientoStock.updateOne({ _id: p._id }, { $set: { fallosSeguidos: fallos, proximaLecturaEl: new Date(+ahora + 24 * HORA),
        ...(fallos >= 3 && !p.esPropio ? { activo: false, motivoBaja: 'la ficha dejó de responder' } : {}) } })
      if (fallos >= 3 && !p.esPropio) bajas++
      continue
    }
    const ultima = { fecha: ahora, stock: it.stockQuantity, topado: it.stockTopado === true, fuente: it.stockFuente ?? null }
    await LecturaStock.create({ sku: p.sku, fecha: ahora, stock: ultima.stock, topado: ultima.topado, fuente: ultima.fuente,
      precio: it.price ?? null, vendidosFicha: it.soldQuantityFicha ?? null, numReviews: it.ratingCount ?? null, costoUsd: cadaUna })
    const sinInfo = ultima.topado && ultima.stock >= 51 ? (p.sinInfoSeguidas ?? 0) + 1 : 0
    // cuatro semanas en "+50": ese vendedor es grande y no deja ver nada
    const baja = sinInfo >= 4 && !p.esPropio
    await SeguimientoStock.updateOne({ _id: p._id }, { $set: { ultima, sinInfoSeguidas: sinInfo, fallosSeguidos: 0,
      proximaLecturaEl: new Date(+ahora + horasHastaLaProxima(ultima) * HORA), ...(baja ? { activo: false, motivoBaja: 'siempre en "+50": no deja ver ventas' } : {}) }, $inc: { lecturas: 1 } })
    if (baja) bajas++
    leidas++
  }
  return { leidas, pedidas: pendientes.length, bajas, costoUsd, gasto: await gastoDelMes({ ahora }) }
}

// Pura. La serie de lecturas de una publicación → lo que vendió como mínimo.
export function resumenDeSerie(lecturas) {
  const serie = (lecturas ?? []).filter((l) => l.ok !== false && Number.isFinite(l.stock)).sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
  let unidades = 0, reposiciones = 0, exactas = 0, tramos = 0
  for (let i = 1; i < serie.length; i++) {
    const v = ventaEntreLecturas({ ...serie[i - 1], topado: serie[i - 1].topado }, { ...serie[i], topado: serie[i].topado })
    if (!v) continue
    tramos++
    if (v.repuso) reposiciones++
    else { unidades += v.unidades; if (!v.esPiso) exactas += v.unidades }
  }
  const dias = serie.length > 1 ? (+new Date(serie.at(-1).fecha) - +new Date(serie[0].fecha)) / DIA : 0
  return { lecturas: serie.length, dias: Math.round(dias * 10) / 10, unidadesPiso: unidades, unidadesExactas: exactas, reposiciones, tramosMedidos: tramos,
    porSemana: dias >= 2 ? Math.round((unidades / dias) * 7 * 10) / 10 : null, stockAhora: serie.at(-1)?.stock ?? null, topadoAhora: serie.at(-1)?.topado ?? null }
}

// Lo que se muestra: por nicho, quién vende; y la calibración con lo propio.
export async function resumenSeguimiento({ ahora = new Date(), keyword = null } = {}) {
  const seguidos = await SeguimientoStock.find(keyword ? { keyword } : {}).lean()
  const lecturas = await LecturaStock.find({ sku: { $in: seguidos.map((s) => s.sku) }, fecha: { $gte: new Date(+ahora - 60 * DIA) } }).sort({ fecha: 1 }).lean()
  const porSku = new Map()
  for (const l of lecturas) porSku.set(l.sku, [...(porSku.get(l.sku) ?? []), { ...l, fuente: l.fuente }])
  const filas = seguidos.map((s) => ({ sku: s.sku, url: s.url, titulo: s.titulo, imagen: s.imagen, vendedor: s.vendedor, keyword: s.keyword, esPropio: s.esPropio,
    activo: s.activo, motivoBaja: s.motivoBaja, proximaLecturaEl: s.proximaLecturaEl, itemIdPropio: s.itemIdPropio, ...resumenDeSerie(porSku.get(s.sku)) }))
  // CALIBRACIÓN: en lo propio la venta real se conoce. Cuánto del total ve el piso.
  let calibracion = null
  const propios = filas.filter((f) => f.esPropio && f.dias >= 3)
  if (propios.length) {
    let piso = 0, real = 0
    for (const f of propios) {
      const serie = porSku.get(f.sku).filter((l) => l.ok !== false)
      const ventas = await VentaMl.find({ estado: { $ne: 'cancelled' }, 'items.itemId': f.itemIdPropio, fecha: { $gte: serie[0].fecha, $lte: serie.at(-1).fecha } }).lean()
      real += ventas.reduce((a, v) => a + v.items.filter((i) => i.itemId === f.itemIdPropio).reduce((b, i) => b + (i.cantidad ?? 0), 0), 0)
      piso += f.unidadesPiso
    }
    calibracion = { productos: propios.length, unidadesReales: real, unidadesVistas: piso, pctVisto: real ? Math.round((piso / real) * 100) : null }
  }
  const porNicho = new Map()
  for (const f of filas.filter((x) => !x.esPropio && x.keyword)) porNicho.set(f.keyword, [...(porNicho.get(f.keyword) ?? []), f])
  return { topeUsdMes: TOPE_USD_MES, gasto: await gastoDelMes({ ahora }), seguidos: filas.filter((f) => f.activo).length, calibracion,
    nichos: [...porNicho].map(([k, fs]) => ({ keyword: k, seguidos: fs.filter((f) => f.activo).length, vendiendo: fs.filter((f) => f.unidadesPiso > 0).length,
      unidadesPisoSemana: Math.round(fs.reduce((a, f) => a + (f.porSemana ?? 0), 0) * 10) / 10, reposiciones: fs.reduce((a, f) => a + f.reposiciones, 0), publicaciones: fs })),
    propios: filas.filter((f) => f.esPropio) }
}

// El trabajo programado: la lista se refresca una vez al día; las lecturas,
// en cada pasada.
export async function pasadaDeSeguimiento({ ahora = new Date() } = {}) {
  const ultimoAgregado = await SeguimientoStock.findOne().sort({ agregadoEl: -1 }).select('agregadoEl').lean()
  const lista = !ultimoAgregado || +ahora - +ultimoAgregado.agregadoEl > 20 * HORA ? await actualizarLista({ ahora }) : null
  return { lista, ...(await leerPendientes({ ahora })) }
}
