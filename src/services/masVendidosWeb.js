// EL RANKING DE MÁS VENDIDOS, LEÍDO DE LA PÁGINA PÚBLICA (20-nov-2026).
//
// Mercado Libre cerró el ranking por la API el 14-oct-2026 (/highlights → 403) y con él se apagó la fuente que mejores
// nichos traía. Medido al auditar el radar ese día, por la venta posterior de los nichos que propuso cada fuente: los
// del ranking y los de las tiendas que reponen fueron los únicos sin ninguno flojo. La página web «Más vendidos» sigue
// publicando lo mismo: el top 20 de cada categoría con su puesto, título, precio, vendedor y «+N vendidos».
//
// Se lee con Zyte en modo navegador (por HTTP ML devuelve una página de espera que pide JavaScript) y se guarda en la
// MISMA colección del ranking de la API (RankingMasVendidos, con `fuente: 'web'`), así todo lo que ya la leía vuelve a
// andar sin tocarlo: las entradas al top que recibe el radar y el panel de más vendidos. A diferencia de la API, la
// página trae el nombre y el precio, así que las fichas se guardan al tiro, sin preguntarle nada más a ML.
//
// Cuesta lo que una página de listado. Por eso va en pasadas chicas y con su propio tope mensual: primero las
// categorías anchas (las raíces y su primer nivel), que son las que sirven para descubrir, y después las de los nichos
// del tablero. Siempre toca la que lleva más tiempo sin leerse, así el tope decide cada cuánto se repite la vuelta y
// no qué categorías quedan fuera.
import { RankingMasVendidos, FichaMasVendido } from '../models/RankingMasVendidos.js'
import { CategoriaMl } from '../models/CategoriaMl.js'
import { objetoDesde } from './jsonEmbebido.js'
import { urlImagen } from './listadoMl.js'
import { conCupo } from './detalleMl.js'
import { raizUtil } from './panoramaMl.js'
import { diaChile } from './inventarioFull.js'
import { config } from '../config/env.js'

const DIA = 86400e3
const ZYTE = 'https://api.zyte.com/v1/extract'
// sobre esta fracción del presupuesto del mes, el ranking deja de leer
export const RESERVA_PARA_MEDIR = 0.9
export const urlMasVendidos = (categoriaId) => `https://www.mercadolibre.cl/mas-vendidos/${categoriaId}`

// Pura. El cuerpo del pedido a Zyte: navegador y una espera corta para que la página termine de armarse.
export const cuerpoMasVendidos = (categoriaId) => ({ url: urlMasVendidos(categoriaId), geolocation: 'CL', browserHtml: true, actions: [{ action: 'waitForTimeout', timeout: 2 }] })

// Pura. Las publicaciones del ranking, en orden. La página trae sus datos embebidos como una lista de tarjetas
// («polycards», la misma forma que las de una búsqueda) con el puesto en el cartel «N.º MÁS VENDIDO». El id del
// ranking es el del producto de catálogo cuando existe (así venía de la API) y el de la publicación cuando no.
export function parsearMasVendidos(html) {
  const texto = String(html ?? '')
  const vistos = new Set()
  const items = []
  const ancla = '"polycards":['
  let desde = 0
  for (;;) {
    const i = texto.indexOf(ancla, desde)
    if (i === -1) break
    desde = i + ancla.length
    const tarjetas = objetoDesde(texto, i + ancla.length - 1)
    if (!Array.isArray(tarjetas)) continue
    for (const t of tarjetas) {
      const meta = t?.metadata ?? {}
      const itemId = meta.id ?? null
      const id = meta.product_id ?? itemId
      if (!id || vistos.has(id)) continue
      vistos.add(id)
      const componente = (tipo) => (t.components ?? []).find((c) => c?.type === tipo)?.[tipo] ?? null
      const cartel = /(\d{1,3})\s*º/.exec(t.float_highlight_generic?.highlight?.text ?? '')
      const senal = meta.signal ?? {}
      const precio = Number(senal.prc ?? componente('price')?.current_price?.value)
      const vendidos = Number(senal.sales)
      items.push({
        id, itemId, tipo: meta.product_id ? 'catalogo' : 'publicacion', posicion: cartel ? Number(cartel[1]) : items.length + 1,
        titulo: componente('title')?.text ?? null,
        vendedor: String(componente('seller')?.text ?? '').replace(/\{[^}]*\}/g, '').trim() || null,
        precio: Number.isFinite(precio) && precio > 0 ? precio : null,
        vendidos: Number.isFinite(vendidos) && vendidos > 0 ? vendidos : null,
        tiendaOficial: Boolean(senal.official_store),
        url: meta.url ? `https://${String(meta.url).replace(/^https?:\/\//, '')}` : null,
        imagen: urlImagen(t.pictures?.pictures?.[0]?.id) ?? null,
      })
    }
  }
  return items.sort((a, b) => a.posicion - b.posicion)
}

// Una página del ranking. Zyte responde 520 cuando ML bloquea el intento (no se cobra): se reintenta una vez. Cada
// pedido pasa por el cupo del proceso (detalleMl.conCupo): es el mismo sitio que las fichas, y pedirle de más a la vez
// es lo que gatilla los bloqueos.
export async function leerMasVendidos(categoriaId, { apiKey = config.zyteApiKey, pedir = fetch, intentos = 2 } = {}) {
  let ultimo = null
  for (let n = 0; n < intentos; n++) {
    const r = await conCupo(() => pedir(ZYTE, { method: 'POST', signal: AbortSignal.timeout(120_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` }, body: JSON.stringify(cuerpoMasVendidos(categoriaId)) }))
    if (!r.ok) { ultimo = `Zyte HTTP ${r.status}`; continue }
    const items = parsearMasVendidos((await r.json())?.browserHtml ?? '')
    if (items.length) return items
    ultimo = 'la página llegó sin ranking'
  }
  throw new Error(`más vendidos de ${categoriaId}: ${ultimo}`)
}

// Pura. Qué categorías toca leer y en qué orden: las que nunca se leyeron (primero las anchas, de la más grande a la
// más chica, y después las del tablero) y luego las que llevan más tiempo sin leerse. Fuera las que tienen una lectura
// de hace menos de `dias`. ultima: Map(categoriaId → día de su última lectura web).
export function categoriasQueTocan({ anchas = [], delTablero = [], ultima = new Map(), dia, dias = 7 }) {
  const limite = new Date(`${dia}T12:00:00Z`)
  limite.setUTCDate(limite.getUTCDate() - dias)
  const corte = limite.toISOString().slice(0, 10)
  const vistas = new Set()
  return [...anchas.map((c) => c.id), ...delTablero]
    .filter((id) => { if (!id || vistas.has(id)) return false; vistas.add(id); return true })
    .map((id, orden) => ({ id, orden, ultima: ultima.get(id) ?? null }))
    .filter((c) => !c.ultima || c.ultima <= corte)
    .sort((a, b) => String(a.ultima ?? '').localeCompare(String(b.ultima ?? '')) || a.orden - b.orden)
}

// Las categorías anchas que vale la pena leer: las raíces útiles para un importador (panoramaMl.raizUtil) y sus
// hijas con volumen.
export async function categoriasParaDescubrir({ minItems = config.masVendidosWebMinItems } = {}) {
  const raices = (await CategoriaMl.find({ padreId: null, hoja: { $ne: null } }).select('id nombre totalItems').lean()).filter((r) => raizUtil(r.nombre))
  const hijas = await CategoriaMl.find({ padreId: { $in: raices.map((r) => r.id) }, totalItems: { $gte: minItems } }).select('id nombre totalItems').lean()
  return [...raices, ...hijas].sort((a, b) => (b.totalItems ?? 0) - (a.totalItems ?? 0))
}

// Una pasada: lee hasta `max` rankings que estén vencidos y los guarda. Se detiene sola con el presupuesto del mes,
// con su propio tope y después de tres páginas seguidas que no llegan (ML bloqueando: se sigue en la próxima).
// `leer` y `gastos` son inyectables para probar sin red.
export async function pasadaMasVendidosWeb({ ahora = new Date(), max = config.masVendidosWebPorPasada, apiKey = config.zyteApiKey, leer = leerMasVendidos, presupuestoMs = 240_000, gastos = null } = {}) {
  if (!config.masVendidosWebActivo) return { omitido: true, motivo: 'apagado (MAS_VENDIDOS_WEB_ACTIVO)' }
  if (!apiKey) return { omitido: true, motivo: 'sin ZYTE_API_KEY' }
  const { presupuesto, registrarGasto } = gastos ?? await import('./gastos.js')
  const { scraping, gastadoUsd } = await presupuesto()
  if (scraping.agotado) return { omitido: true, motivo: scraping.motivo }
  // LO QUE DESCUBRE CEDE ANTE LO QUE MIDE: con el mes cerca del techo, el ranking espera al mes siguiente para no
  // quitarle presupuesto a los scans de los nichos (si el techo se toca, se detienen los scans y los análisis)
  if (Number.isFinite(gastadoUsd) && gastadoUsd >= config.presupuestoUsdMes * RESERVA_PARA_MEDIR) {
    return { omitido: true, motivo: `el mes va en US$ ${gastadoUsd.toFixed(2)} de ${config.presupuestoUsdMes}: el ranking espera para no quitarle presupuesto a los scans` }
  }
  const dia = diaChile(ahora)
  const delMes = await RankingMasVendidos.countDocuments({ fuente: 'web', dia: { $gte: `${dia.slice(0, 7)}-01` } })
  const gastado = delMes * config.zyteCostoListadoUsd
  if (gastado >= config.masVendidosWebUsdMes) return { omitido: true, motivo: `tope del mes (US$ ${gastado.toFixed(2)} de ${config.masVendidosWebUsdMes})` }
  const { categoriasDelTablero } = await import('./rankingMasVendidos.js')
  const tablero = await categoriasDelTablero().catch(() => new Map())
  const anchas = await categoriasParaDescubrir()
  const ultima = new Map((await RankingMasVendidos.aggregate([{ $match: { fuente: 'web' } }, { $group: { _id: '$categoriaId', dia: { $max: '$dia' } } }])).map((x) => [x._id, x.dia]))
  const tocan = categoriasQueTocan({ anchas, delTablero: [...tablero.keys()], ultima, dia, dias: config.masVendidosWebDias })
  const inicio = Date.now()
  let leidas = 0, fallas = 0, seguidas = 0
  for (const { id } of tocan.slice(0, max)) {
    // la cola de tendencias atiende de a uno: una pasada larga deja esperando al seguimiento de stock y al panorama
    if (Date.now() - inicio > presupuestoMs) break
    try {
      const items = await leer(id, { apiKey })
      await RankingMasVendidos.updateOne({ categoriaId: id, dia }, { $set: { categoriaId: id, dia, nichos: tablero.get(id) ?? [], fuente: 'web', capturadoEl: ahora,
        items: items.map((i) => ({ id: i.id, tipo: i.tipo, posicion: i.posicion, itemId: i.itemId, vendidos: i.vendidos })) } }, { upsert: true })
      await FichaMasVendido.bulkWrite(items.map((i) => ({ updateOne: { filter: { id: i.id }, upsert: true,
        update: { $set: { tipo: i.tipo, titulo: i.titulo, imagen: i.imagen, precio: i.precio, url: i.url, vendedor: i.vendedor, tiendaOficial: i.tiendaOficial, vendidos: i.vendidos, resueltoEl: ahora }, $setOnInsert: { fuente: 'web' } } } })), { ordered: false })
      await registrarGasto(null, config.zyteCostoListadoUsd, 'zyte')
      leidas++; seguidas = 0
    } catch (err) {
      fallas++; seguidas++
      console.warn(`[mas-vendidos-web] ${err.message}`)
      if (seguidas >= 3) break
    }
  }
  console.log(`[mas-vendidos-web] ${dia}: ${leidas} rankings leídos, ${fallas} sin llegar, ${Math.max(0, tocan.length - leidas)} por leer`)
  return { dia, leidas, fallas, pendientes: Math.max(0, tocan.length - leidas), gastoMesUsd: Math.round((gastado + leidas * config.zyteCostoListadoUsd) * 100) / 100 }
}

// LO QUE LEE EL RADAR CUANDO TODAVÍA NO HAY MOVIMIENTO QUE COMPARAR: los primeros de cada ranking leído esta semana
// en categorías anchas, con lo que llevan vendido. Las entradas y subidas (rankingMasVendidos.entradasAlTop) necesitan
// dos lecturas de la misma categoría; esto sirve desde la primera. Cada día muestra pasillos distintos (rota por día)
// para que el radar no proponga siempre sobre los mismos. De cada ranking van primero los que no son de una tienda
// oficial: una marca con tienda propia no es un producto que un importador pueda traer.
export async function masVendidosParaRadar({ ahora = new Date(), categorias = 12, porCategoria = 4 } = {}) {
  const desde = diaChile(+ahora - 8 * DIA)
  const docs = await RankingMasVendidos.find({ fuente: 'web', dia: { $gte: desde } }).sort({ dia: -1 }).lean()
  const ultimos = new Map()
  for (const d of docs) if (!ultimos.has(d.categoriaId)) ultimos.set(d.categoriaId, d)
  const anchas = new Map((await categoriasParaDescubrir()).map((c) => [c.id, c]))
  const elegibles = [...ultimos.values()].filter((d) => anchas.has(d.categoriaId)).sort((a, b) => (anchas.get(b.categoriaId).totalItems ?? 0) - (anchas.get(a.categoriaId).totalItems ?? 0))
  if (!elegibles.length) return []
  const paso = Math.floor(+ahora / DIA) % elegibles.length
  const turno = [...elegibles.slice(paso), ...elegibles.slice(0, paso)].slice(0, categorias)
  const rutas = new Map((await CategoriaMl.find({ id: { $in: turno.map((d) => d.categoriaId) } }).select('id ruta nombre').lean()).map((c) => [c.id, c.ruta ?? c.nombre]))
  const fichas = new Map((await FichaMasVendido.find({ id: { $in: turno.flatMap((d) => d.items.map((i) => i.id)) } }).lean()).map((f) => [f.id, f]))
  return turno.flatMap((d) => {
    const filas = d.items.map((i) => ({ categoria: rutas.get(d.categoriaId) ?? d.categoriaId, posicion: i.posicion, titulo: fichas.get(i.id)?.titulo ?? null,
      precio: fichas.get(i.id)?.precio ?? null, vendidos: i.vendidos ?? fichas.get(i.id)?.vendidos ?? null, tiendaOficial: fichas.get(i.id)?.tiendaOficial === true })).filter((x) => x.titulo)
    return [...filas.filter((x) => !x.tiendaOficial), ...filas.filter((x) => x.tiendaOficial)].slice(0, porCategoria).sort((a, b) => a.posicion - b.posicion)
  })
}
