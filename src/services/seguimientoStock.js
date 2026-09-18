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
import { ofertasDeCatalogo, catalogoDeUrl } from './ofertasCatalogo.js'
import { meliGet } from './meli.js'
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
  if (ultima.topado) return 24 // "+5": todavía es un rango
  return 12 // número exacto: cada lectura es una venta contada
}

// Pura. De los productos del último scan de un nicho, a quién vale la pena
// seguir: vendedor que no es tienda oficial ni anuncio, lo más arriba posible
// en el listado, uno por vendedor —interesa ver a varios entrantes distintos, no
// tres publicaciones de la misma tienda—. Si el stock ya se conoce, primero los
// que lo dejan ver y nunca los que están en "+50"; si no se conoce, entra igual:
// la primera lectura lo descubre (US$0,006) y cuatro semanas en "+50" lo sacan.
// La primera versión exigía stock conocido y dejó la lista vacía: ese dato solo
// existe en los nichos escaneados desde el 17-sep.
// Una URL de catálogo (/p/MLC…) no es de nadie: muestra al ganador de la caja de
// compra, que rota. La publicación propia del vendedor (articulo.mercadolibre.cl)
// sí es suya, y su stock se puede seguir. Se prefieren esas.
export const esUrlDeCatalogo = (url) => /\/p\/MLC/i.test(String(url ?? ''))

// A QUIÉN CONVIENE SEGUIR. La primera versión de esta regla elegía al revés, y se
// vio en los datos del 18-sep: de 351 seguidos solo 13 (4%) eran Full con
// publicación propia, y de los 22 medibles la mitad eran tiendas cross-border
// ("Hongkong Store", "Loja Meicai", "CNCHONGQING…") clavadas en 1-5 unidades.
// Dos errores opuestos:
//   · DESCARTABA a quien está en "+50". Pero "+50" con Full es inventario real en
//     la bodega de ML, y el día que cae a "+25" son ≥25 unidades vendidas: el
//     número más grande y más limpio que da este método.
//   · PREFERÍA a quien muestra poco stock. Eso selecciona justo al dropshipper que
//     pone 3 unidades nominales, nunca las mueve y nunca repone.
// El importador lo dijo antes que los datos: "si la publicación es Full es porque
// están enviando a los almacenes de Mercado Libre". Full = hay caja de por medio.
const nominal = (p) => p.stockFuente === 'texto' && Number.isFinite(p.stock) && !p.stockTopado && p.stock <= 5

export function elegirParaSeguir(productos, { max = POR_NICHO } = {}) {
  const visible = (p) => p.stockFuente === 'texto' && Number.isFinite(p.stock)
  // cuánto vale seguirlo, de menor (mejor) a mayor
  const valor = (p) => (p.esFull ? 0 : 4) + (esUrlDeCatalogo(p.url) ? 2 : 0) + (nominal(p) ? 1 : 0)
  const vistos = new Set()
  return (productos ?? [])
    .filter((p) => p.url && p.esTiendaOficial !== true && p.esAnuncio !== true
      // "+50" sin Full no se puede leer: ni se mueve ni hay bodega detrás
      && !(visible(p) && p.stockTopado && p.stock >= 51 && !p.esFull))
    .sort((a, b) => valor(a) - valor(b) || Number(visible(b)) - Number(visible(a)) || (a.posicion ?? 999) - (b.posicion ?? 999))
    .filter((p) => {
      const v = p.vendedor ?? p.sku
      if (vistos.has(v)) return false
      vistos.add(v)
      return true
    })
    .slice(0, max)
}

// Quién ocupa un cupo sin poder dar señal. Una ficha de catálogo TODAVÍA puede
// servir si el mismo vendedor se queda con la caja de compra, y eso se sabe
// recién cuando dos lecturas traen su identificación. Se cede el lugar solo de
// quien ya demostró que rota, o del que lleva varias lecturas sin poder
// atribuirse a nadie.
export const seguidoFlojo = (p) =>
  !p.itemIdReal && (p.esCatalogo === true || esUrlDeCatalogo(p.url)) && ((p.cambiosDeVendedor ?? 0) >= 1 || ((p.lecturas ?? 0) >= 4 && !p.sellerId))

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

// DEJAR DE LEER LA PÁGINA DE CATÁLOGO. Una ficha /p/MLC… muestra al ganador de la
// caja de compra, que rota; el 18-sep-2026 el 38% de esas lecturas eran de otro
// vendedor. La API oficial lo resuelve gratis: `/products/{id}/items` lista todas
// las ofertas con su `item_id`, su `seller_id` y su logística, y con el item_id se
// lee la publicación PROPIA del vendedor, que siempre muestra SU stock.
//
// Cuando ya sabemos a quién seguimos (una lectura nos dio su seller_id) se toma su
// oferta. Cuando no, se toma la MEJOR de la lista —Full primero, después la más
// barata sin tienda oficial— y se sigue a ese: el "vendedor" que traía el listado
// era de todos modos el que tenía la caja en ese momento, así que no se pierde
// nada y se gana una medición atribuible. El apodo real llega de `/users/{id}`, que
// de paso corrige los casos en que el listado había guardado la MARCA.
export async function resolverCatalogos({ max = 25 } = {}) {
  const pendientes = await SeguimientoStock.find({
    activo: true, esPropio: false, itemIdReal: null, url: { $regex: '/p/MLC', $options: 'i' },
  }).sort({ lecturas: -1 }).limit(max).lean()
  if (!pendientes.length) return { resueltos: 0, sinOfertas: 0 }
  const tomados = new Set((await SeguimientoStock.find({ itemIdReal: { $ne: null } }).select('itemIdReal').lean()).map((p) => p.itemIdReal))
  let resueltos = 0, sinOfertas = 0
  for (const p of pendientes) {
    const ofertas = await ofertasDeCatalogo(catalogoDeUrl(p.url)).catch(() => [])
    if (!ofertas.length) { sinOfertas++; continue }
    const libres = ofertas.filter((o) => !tomados.has(o.itemId))
    const mia = ofertas.find((o) => p.sellerId && o.sellerId === String(p.sellerId))
      ?? libres.find((o) => o.esFull && !o.esTiendaOficial)
      ?? libres.find((o) => !o.esTiendaOficial)
      ?? libres[0]
    if (!mia) { sinOfertas++; continue }
    tomados.add(mia.itemId)
    const apodo = mia.sellerId ? await meliGet(`/users/${mia.sellerId}`).then((u) => u?.nickname ?? null).catch(() => null) : null
    await SeguimientoStock.updateOne({ sku: p.sku }, { $set: {
      itemIdReal: mia.itemId, urlLectura: mia.url, sellerId: mia.sellerId, esFull: mia.esFull,
      logisticType: mia.logisticType, esCatalogo: true, ...(apodo ? { vendedor: apodo } : {}),
    } })
    resueltos++
  }
  return { resueltos, sinOfertas, pendientes: await SeguimientoStock.countDocuments({ activo: true, esPropio: false, itemIdReal: null, url: { $regex: '/p/MLC', $options: 'i' } }) }
}

// Una vez al día: suma a la lista lo que el último scan de cada nicho dejó ver,
// y las publicaciones propias (para calibrar). No saca a nadie: eso lo decide
// la lectura, cuando una publicación pasa semanas en "+50" o desaparece.
export async function actualizarLista({ ahora = new Date() } = {}) {
  let agregados = 0, cedidos = 0
  for (const n of await nichosQueImportan()) {
    const seguidos = await SeguimientoStock.find({ nichoId: n._id, activo: true, esPropio: false }).select('sku url esCatalogo esFull lecturas reposicionesVistas cambiosDeVendedor sellerId itemIdReal urlLectura').lean()
    const ultimo = await Snapshot.findOne({ keyword: n.keyword }).sort({ fecha: -1 }).select('fecha').lean()
    if (!ultimo) continue
    // solo lo de arriba del listado: es donde un entrante compite de verdad
    const snaps = await Snapshot.find({ keyword: n.keyword, fecha: ultimo.fecha, posicion: { $lte: 60 } }).select('sku posicion stock stockTopado stockFuente esAnuncio').lean()
    const prods = new Map((await Producto.find({ sku: { $in: [...snaps.map((s) => s.sku), ...seguidos.map((p) => p.sku)] } }).select('sku url titulo imagen vendedor esTiendaOficial esFull').lean()).map((p) => [p.sku, p]))
    // CUPO CEDIDO. Los 6 lugares del nicho se llenaron antes de saber que una
    // ficha de catálogo no se puede atribuir a un vendedor: quedaron ocupados por
    // quien no puede dar señal. El que todavía no mostró nada le cede el lugar a
    // un candidato Full con publicación propia.
    const flojos = seguidos.filter((p) => seguidoFlojo(p) && !p.reposicionesVistas)
    const firmes = seguidos.length - flojos.length
    const yaEstan = new Set(seguidos.map((p) => p.sku))
    const todos = elegirParaSeguir(snaps.map((s) => ({ ...s, ...(prods.get(s.sku) ?? {}) })).filter((p) => p.vendedor), { max: POR_NICHO })
    const mejores = todos.filter((c) => !yaEstan.has(c.sku) && c.esFull && !esUrlDeCatalogo(c.url))
    const ceder = Math.max(0, Math.min(flojos.length, mejores.length - Math.max(0, POR_NICHO - seguidos.length)))
    for (const f of flojos.slice(0, ceder)) {
      await SeguimientoStock.updateOne({ sku: f.sku }, { $set: { activo: false, motivoBaja: 'ficha de catálogo: el stock puede ser de otro vendedor' } })
      cedidos++
    }
    const libres = POR_NICHO - (firmes + flojos.length - ceder)
    if (libres <= 0) continue
    const candidatos = [...mejores, ...todos.filter((c) => !yaEstan.has(c.sku) && !mejores.includes(c))].slice(0, libres)
    for (const c of candidatos) {
      const conocido = c.stockFuente === 'texto' && Number.isFinite(c.stock)
      // si es catálogo, se guarda ya la publicación propia del vendedor
      let propia = null
      const catalogoNuevo = catalogoDeUrl(c.url)
      if (catalogoNuevo) {
        const ofertas = await ofertasDeCatalogo(catalogoNuevo)
        propia = ofertas.find((o) => Number.isFinite(c.precio) && o.precio === c.precio) ?? (ofertas.length === 1 ? ofertas[0] : null)
      }
      const r = await SeguimientoStock.updateOne({ sku: c.sku }, { $setOnInsert: { sku: c.sku, url: c.url, nichoId: n._id, keyword: n.keyword,
        titulo: c.titulo ?? null, imagen: c.imagen ?? null, vendedor: c.vendedor ?? null, agregadoEl: ahora, esCatalogo: esUrlDeCatalogo(c.url),
        esFull: propia ? propia.esFull : (c.esFull ?? null), logisticType: propia?.logisticType ?? null,
        itemIdReal: propia?.itemId ?? null, urlLectura: propia?.url ?? null, sellerId: propia?.sellerId ?? null,
        // si el scan ya leyó su stock, esa cuenta como la primera lectura: ya se pagó
        ...(conocido ? { ultima: { fecha: ultimo.fecha, stock: c.stock, topado: c.stockTopado === true, fuente: c.stockFuente } } : {}),
        proximaLecturaEl: conocido ? new Date(+ultimo.fecha + horasHastaLaProxima({ stock: c.stock, topado: c.stockTopado }) * HORA) : ahora } }, { upsert: true })
      if (r.upsertedCount) {
        agregados++
        if (conocido) await LecturaStock.create({ sku: c.sku, fecha: ultimo.fecha, stock: c.stock, topado: c.stockTopado === true, fuente: c.stockFuente, costoUsd: 0 })
      }
    }
  }
  for (const p of await ProductoPropio.find({ estado: 'activo', url: { $ne: null } }).select('sku itemIdMl url titulo imagen nichoId').lean()) {
    const r = await SeguimientoStock.updateOne({ sku: p.sku }, { $setOnInsert: { sku: p.sku, url: p.url, nichoId: p.nichoId ?? null, titulo: p.titulo ?? null,
      imagen: p.imagen ?? null, vendedor: 'propio', esPropio: true, itemIdPropio: p.itemIdMl ?? p.sku, agregadoEl: ahora, proximaLecturaEl: ahora } }, { upsert: true })
    agregados += r.upsertedCount ?? 0
  }
  return { agregados, cedidos, activos: await SeguimientoStock.countDocuments({ activo: true }) }
}

export async function gastoDelMes({ ahora = new Date() } = {}) {
  const inicio = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1))
  const [m] = await LecturaStock.aggregate([{ $match: { fecha: { $gte: inicio } } }, { $group: { _id: null, usd: { $sum: '$costoUsd' }, lecturas: { $sum: 1 } } }])
  const [h] = await LecturaStock.aggregate([{ $match: { fecha: { $gte: new Date(+ahora - DIA) } } }, { $group: { _id: null, usd: { $sum: '$costoUsd' } } }])
  return { mesUsd: m?.usd ?? 0, lecturasMes: m?.lecturas ?? 0, ultimas24hUsd: h?.usd ?? 0 }
}

// Lee lo que toca, hasta donde alcanza la plata. Dos frenos: el del mes y uno
// diario, para que un día malo no se coma la semana.
export async function leerPendientes({ ahora = new Date(), leer = buscarDetalle } = {}) {
  const gasto = await gastoDelMes({ ahora })
  const costo = config.zyteCostoFichaUsd
  // EL FRENO DIARIO REPARTE LO QUE QUEDA DEL MES, no un treintavo fijo. El primer
  // día (17-sep) el treintavo se agotó a las 10 de la mañana con US$29 del mes
  // sin tocar, y la segunda lectura —la que dice si alguien vendió— quedó para
  // el día siguiente. Lo disponible hoy es lo que queda del mes dividido por los
  // días que faltan: en un mes completo da US$1 al día; empezando a mitad de
  // mes, más. El tope mensual no se mueve.
  const finDeMes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 1))
  const diasQueQuedan = Math.max(1, Math.ceil((+finDeMes - +ahora) / DIA))
  const paraHoy = (TOPE_USD_MES - (gasto.mesUsd - gasto.ultimas24hUsd)) / diasQueQuedan
  const porPlata = Math.floor(Math.min(TOPE_USD_MES - gasto.mesUsd, paraHoy - gasto.ultimas24hUsd) / costo)
  if (porPlata <= 0) return { leidas: 0, motivo: 'tope de gasto alcanzado', gasto }
  // A QUIÉN SE LEE PRIMERO. Ordenar solo por atraso dejaba a los 300 que nunca se
  // habían leído por delante de la SEGUNDA lectura de los que ya se leyeron —y la
  // segunda lectura es la única que dice si alguien vendió—. Con el tope de
  // US$30 eso la postergaba días. Reparto de cada pasada: lo propio siempre (es
  // la calibración); después, hasta la mitad para releer a quien deja ver su
  // stock, y el resto para conocer a los nuevos; lo que sobre de un lado pasa al otro.
  const cupo = Math.min(porPlata, MAX_POR_PASADA)
  const vencidos = await SeguimientoStock.find({ activo: true, proximaLecturaEl: { $lte: ahora } }).sort({ proximaLecturaEl: 1 }).lean()
  const propios = vencidos.filter((p) => p.esPropio)
  const dejaVer = (p) => p.ultima && Number.isFinite(p.ultima.stock) && !(p.ultima.topado && p.ultima.stock >= 51)
  // dentro de cada grupo, primero quien puede dar señal: Full con publicación
  // propia antes que un catálogo que quizá no se pueda atribuir
  const utilidad = (p) => (p.esFull ? 0 : 2) + (seguidoFlojo(p) ? 1 : 0)
  const relecturas = vencidos.filter((p) => !p.esPropio && dejaVer(p)).sort((a, b) => utilidad(a) - utilidad(b))
  const resto = vencidos.filter((p) => !p.esPropio && !dejaVer(p)).sort((a, b) => Number(Boolean(a.ultima)) - Number(Boolean(b.ultima)) || utilidad(a) - utilidad(b))
  const libre = Math.max(0, cupo - propios.length)
  const paraReleer = relecturas.slice(0, Math.max(Math.ceil(libre / 2), libre - resto.length))
  const pendientes = [...propios, ...paraReleer, ...resto.slice(0, libre - paraReleer.length)].slice(0, cupo)
  if (!pendientes.length) return { leidas: 0, motivo: 'nada pendiente', gasto }
  const { items, costoUsd } = await leer(pendientes.map((p) => p.urlLectura ?? p.url))
  await registrarGasto(null, costoUsd, 'zyte')
  const cadaUna = costoUsd / pendientes.length
  let leidas = 0, bajas = 0
  for (const p of pendientes) {
    // la ficha devuelve en `sku` el id de la publicación que realmente pintó: si
    // no es la que pedimos, la lectura no es de este vendedor y no sirve
    const idEsperado = (p.itemIdReal ?? p.sku ?? '').replace(/^MLC/i, '')
    const it = items.find((i) => String(i.sku ?? '').replace(/^MLC/i, '') === idEsperado)
      ?? (p.itemIdReal ? null : items.find((i) => i.url && (i.url === p.url || i.url.includes(p.sku))))
    if (!it || !Number.isFinite(it.stockQuantity)) {
      // pagada igual. Tres fallos seguidos = la publicación ya no existe
      await LecturaStock.create({ sku: p.sku, fecha: ahora, ok: false, costoUsd: cadaUna })
      const fallos = (p.fallosSeguidos ?? 0) + 1
      await SeguimientoStock.updateOne({ _id: p._id }, { $set: { fallosSeguidos: fallos, proximaLecturaEl: new Date(+ahora + 24 * HORA),
        ...(fallos >= 3 && !p.esPropio ? { activo: false, motivoBaja: 'la ficha dejó de responder' } : {}) } })
      if (fallos >= 3 && !p.esPropio) bajas++
      continue
    }
    const ultima = { fecha: ahora, stock: it.stockQuantity, topado: it.stockTopado === true, fuente: it.stockFuente ?? null, sellerId: it.sellerId ?? null, vendedorLeido: it.sellerName ?? null }
    await LecturaStock.create({ sku: p.sku, fecha: ahora, stock: ultima.stock, topado: ultima.topado, fuente: ultima.fuente,
      precio: it.price ?? null, vendidosFicha: it.soldQuantityFicha ?? null, numReviews: it.ratingCount ?? null, costoUsd: cadaUna,
      sellerId: it.sellerId ?? null, vendedorLeido: it.sellerName ?? null })
    const sinInfo = ultima.topado && ultima.stock >= 51 ? (p.sinInfoSeguidas ?? 0) + 1 : 0
    // cuatro semanas en "+50": ese vendedor es grande y no deja ver nada
    // Resuelto a la publicación propia del vendedor, la ambigüedad desaparece: esa
    // página muestra SU stock aunque la caja de compra la tenga otro.
    const deCatalogo = !p.itemIdReal && (p.esCatalogo === true || esUrlDeCatalogo(p.url))
    const cambio = ventaEntreLecturas({ ...(p.ultima ?? {}), esCatalogo: deCatalogo, vendedorEsperado: p.vendedor },
      { ...ultima, esCatalogo: deCatalogo, vendedorEsperado: p.vendedor })
    const repuso = cambio?.repuso === true && cambio.repuestasPiso >= REPOSICION_MIN
    const rotoDeVerdad = cambio?.motivo === 'cambio'
    // "+50" con Full es bodega real: se lee semanal y se espera la caída a "+25"
    const baja = sinInfo >= 4 && !p.esPropio && !p.esFull && !(p.reposicionesVistas > 0) && !repuso
    // un catálogo al que se le vio cambiar de vendedor dos veces no se va a poder
    // atribuir nunca. Ojo: solo cuentan los cambios PROBADOS (dos lecturas con
    // vendedor distinto), no las lecturas viejas que todavía no lo traen — si no,
    // se daría de baja a toda la lista por no haber guardado el dato antes.
    const rota = rotoDeVerdad && !p.esPropio && (p.cambiosDeVendedor ?? 0) + 1 >= 2
    await SeguimientoStock.updateOne({ _id: p._id }, { $set: { ultima, sinInfoSeguidas: sinInfo, fallosSeguidos: 0, ...(it.sellerId ? { sellerId: String(it.sellerId) } : {}), esCatalogo: deCatalogo,
      proximaLecturaEl: new Date(+ahora + horasHastaLaProxima(ultima) * HORA), ...(baja ? { activo: false, motivoBaja: 'siempre en "+50": no deja ver ventas' } : rota ? { activo: false, motivoBaja: 'la caja de compra rota entre vendedores: no se puede atribuir' } : {}) }, $inc: { lecturas: 1, ...(repuso ? { reposicionesVistas: 1 } : {}), ...(rotoDeVerdad ? { cambiosDeVendedor: 1 } : {}) } })
    if (baja || rota) bajas++
    leidas++
  }
  return { leidas, pedidas: pendientes.length, bajas, costoUsd, gasto: await gastoDelMes({ ahora }) }
}

// Pura. La serie de lecturas de una publicación → lo que vendió como mínimo.
// Una subida de 1-2 unidades puede ser una devolución o una orden anulada que
// devuelve stock (de "2" a "3"; o un vendedor parado justo en el borde de un
// rango: 26→25→26 se ve como "+25"→"+10"→"+25"). Eso NO es reponer.
const REPOSICION_MIN = 3

// LA FUERZA DE UN VENDEDOR. El importador, 17-sep: "si detecta que está bajando
// el stock y después que aumentó, es porque están enviando a Full: ese producto
// es fuerte". Una baja sola puede ser venta o el vendedor corrigiendo su stock;
// baja + reposición es plata vuelta a meter en ese producto: nadie repone lo que
// no se vende. Niveles: 'ciclo' (vendió y repuso, en ese orden) · 'repone' (subió
// sin baja visible: la venta ocurrió dentro de un rango) · 'vende' · 'quieto'.
export function resumenDeSerie(lecturas, { esCatalogo = false, vendedorEsperado = null } = {}) {
  const serie = (lecturas ?? []).filter((l) => l.ok !== false && Number.isFinite(l.stock)).sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
  let unidades = 0, reposiciones = 0, exactas = 0, tramos = 0, ajustes = 0, ciclos = 0, repuestas = 0, desdeLaUltima = 0, seAgoto = false, ultimaReposicionEl = null
  let cambiosDeVendedor = 0, sinAtribuir = 0, probables = 0, confirmados = 0
  for (let i = 1; i < serie.length; i++) {
    const v = ventaEntreLecturas({ ...serie[i - 1], esCatalogo, vendedorEsperado }, { ...serie[i], esCatalogo, vendedorEsperado })
    if (v?.otroVendedor) {
      // el stock leído puede ser de otro vendedor: el tramo no se compara, y lo
      // acumulado antes tampoco encadena con lo que venga después
      if (v.motivo === 'cambio') cambiosDeVendedor++
      else sinAtribuir++
      desdeLaUltima = 0; seAgoto = false
      continue
    }
    if (!v) continue
    tramos++
    if (v.atribucion === 'confirmada') confirmados++
    else if (v.atribucion === 'probable') probables++
    if (v.repuso) {
      if (v.repuestasPiso >= REPOSICION_MIN || desdeLaUltima >= REPOSICION_MIN) {
        reposiciones++; repuestas += v.repuestasPiso; ultimaReposicionEl = serie[i].fecha
        if (desdeLaUltima > 0 || v.desdeAgotado || seAgoto) ciclos++
      } else ajustes++
      desdeLaUltima = 0; seAgoto = false
    } else {
      unidades += v.unidades; desdeLaUltima += v.unidades
      if (!v.esPiso) exactas += v.unidades
      if (serie[i].stock === 0 && serie[i].topado !== true) seAgoto = true
    }
  }
  const dias = serie.length > 1 ? (+new Date(serie.at(-1).fecha) - +new Date(serie[0].fecha)) / DIA : 0
  const fuerza = ciclos ? 'ciclo' : reposiciones ? 'repone' : unidades > 0 ? 'vende' : tramos ? 'quieto' : null
  return { lecturas: serie.length, dias: Math.round(dias * 10) / 10, unidadesPiso: unidades, unidadesExactas: exactas, reposiciones, tramosMedidos: tramos,
    ajustes, ciclos, unidadesRepuestasPiso: repuestas, ultimaReposicionEl, fuerza, cambiosDeVendedor, sinAtribuir, esCatalogo,
    // 'confirmada' = las dos lecturas dijeron de quién era el stock. 'probable' =
    // solo una, y coincide con el vendedor que anotamos al agregar la publicación.
    // Lo probable se muestra, pero no cuenta como vendedor fuerte hasta que la
    // próxima lectura lo confirme.
    atribucion: confirmados ? 'confirmada' : probables ? 'probable' : esCatalogo ? 'sin atribuir' : 'supuesta',
    porSemana: dias >= 2 ? Math.round((unidades / dias) * 7 * 10) / 10 : null, stockAhora: serie.at(-1)?.stock ?? null, topadoAhora: serie.at(-1)?.topado ?? null }
}

// Lo que se muestra: por nicho, quién vende; y la calibración con lo propio.
export async function resumenSeguimiento({ ahora = new Date(), keyword = null } = {}) {
  const seguidos = await SeguimientoStock.find(keyword ? { keyword } : {}).lean()
  const lecturas = await LecturaStock.find({ sku: { $in: seguidos.map((s) => s.sku) }, fecha: { $gte: new Date(+ahora - 60 * DIA) } }).sort({ fecha: 1 }).lean()
  const porSku = new Map()
  for (const l of lecturas) porSku.set(l.sku, [...(porSku.get(l.sku) ?? []), { ...l, fuente: l.fuente }])
  // el listado ya dice si la publicación despacha desde Full (no cuesta nada):
  // ahí una reposición es un envío a la bodega de ML
  const full = new Map((await Producto.find({ sku: { $in: seguidos.map((s) => s.sku) } }).select('sku esFull').lean()).map((p) => [p.sku, p.esFull ?? null]))
  const filas = seguidos.map((s) => ({ esFull: s.esFull ?? full.get(s.sku) ?? null, logisticType: s.logisticType ?? null,
    itemIdReal: s.itemIdReal ?? null, sku: s.sku, url: s.url, titulo: s.titulo, imagen: s.imagen, vendedor: s.vendedor, keyword: s.keyword, esPropio: s.esPropio,
    activo: s.activo, motivoBaja: s.motivoBaja, proximaLecturaEl: s.proximaLecturaEl, agregadoEl: s.agregadoEl, itemIdPropio: s.itemIdPropio,
    // las lecturas tal como llegaron, para poder VER qué está obteniendo el sistema
    serie: (porSku.get(s.sku) ?? []).slice(-24).map((l) => ({ fecha: l.fecha, ok: l.ok !== false, stock: l.stock, topado: l.topado, precio: l.precio, fuente: l.fuente ?? null, sellerId: l.sellerId ?? null, vendedorLeido: l.vendedorLeido ?? null })),
    ...resumenDeSerie(porSku.get(s.sku), { esCatalogo: !s.itemIdReal && (s.esCatalogo === true || esUrlDeCatalogo(s.url)), vendedorEsperado: s.vendedor }) }))
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
  // el registro crudo de lo último que se leyó, con a quién pertenece
  const deQuien = new Map(seguidos.map((s) => [s.sku, s]))
  const ultimasLecturas = [...lecturas].reverse().slice(0, 40).map((l) => ({ fecha: l.fecha, ok: l.ok !== false, stock: l.stock, topado: l.topado, costoUsd: l.costoUsd,
    sku: l.sku, vendedor: deQuien.get(l.sku)?.vendedor ?? null, keyword: deQuien.get(l.sku)?.keyword ?? null, esPropio: deQuien.get(l.sku)?.esPropio ?? false, titulo: deQuien.get(l.sku)?.titulo ?? null }))
  return { topeUsdMes: TOPE_USD_MES, gasto: await gastoDelMes({ ahora }), seguidos: filas.filter((f) => f.activo).length, calibracion, ultimasLecturas,
    // de qué calidad es la lista: solo Full con publicación propia da un número
    // que se mueve con las ventas y se puede atribuir a un vendedor
    calidad: {
      medibles: filas.filter((f) => !f.esPropio && f.esFull && (f.itemIdReal || !f.esCatalogo)).length,
      catalogo: filas.filter((f) => !f.esPropio && f.esCatalogo && !f.itemIdReal).length,
      resueltos: filas.filter((f) => !f.esPropio && f.itemIdReal).length,
      sinFull: filas.filter((f) => !f.esPropio && !f.esFull && !f.esCatalogo).length,
      cambiosDeVendedor: filas.reduce((a, f) => a + (f.cambiosDeVendedor ?? 0), 0),
      sinAtribuir: filas.reduce((a, f) => a + (f.sinAtribuir ?? 0), 0),
      probables: filas.filter((f) => !f.esPropio && f.atribucion === 'probable').length,
      atribuidas: filas.reduce((a, f) => a + (f.serie ?? []).filter((l) => l.sellerId).length, 0),
    },
    catalogo: { seguidos: filas.filter((f) => !f.esPropio && f.esCatalogo).length, cambiosDeVendedor: filas.reduce((a, f) => a + (f.cambiosDeVendedor ?? 0), 0) },
    pendientesAhora: seguidos.filter((s) => s.activo && +new Date(s.proximaLecturaEl) <= +ahora).length,
    nichos: [...porNicho].map(([k, fs]) => ({ keyword: k, seguidos: fs.filter((f) => f.activo).length, vendiendo: fs.filter((f) => f.unidadesPiso > 0).length, fuertes: fs.filter((f) => (f.fuerza === 'ciclo' || f.fuerza === 'repone') && f.atribucion !== 'probable').length,
      probables: fs.filter((f) => (f.fuerza === 'ciclo' || f.fuerza === 'repone' || f.unidadesPiso > 0) && f.atribucion === 'probable').length,
      unidadesRepuestasPiso: fs.reduce((a, f) => a + (f.unidadesRepuestasPiso ?? 0), 0),
      unidadesPisoSemana: Math.round(fs.reduce((a, f) => a + (f.porSemana ?? 0), 0) * 10) / 10, reposiciones: fs.reduce((a, f) => a + f.reposiciones, 0),
      enCatalogo: fs.filter((f) => f.esCatalogo).length, medibles: fs.filter((f) => f.esFull && !f.esCatalogo).length, publicaciones: fs })),
    propios: filas.filter((f) => f.esPropio) }
}

// El trabajo programado: la lista se refresca una vez al día; las lecturas,
// en cada pasada.
export async function pasadaDeSeguimiento({ ahora = new Date() } = {}) {
  // La lista se refresca una vez al día, MIRANDO A LOS COMPETIDORES. La primera
  // versión miraba el último agregado de cualquier tipo: las publicaciones
  // propias entraron primero y la lista se dio por actualizada sin un solo
  // competidor adentro.
  const ultimo = await SeguimientoStock.findOne({ esPropio: false }).sort({ agregadoEl: -1 }).select('agregadoEl').lean()
  const lista = !ultimo || +ahora - +ultimo.agregadoEl > 20 * HORA ? await actualizarLista({ ahora }) : null
  // esto no cuesta nada (API oficial) y es lo que vuelve medible al catálogo:
  // se hace en cada pasada, no una vez al día
  const catalogos = await resolverCatalogos().catch((e) => ({ error: e.message }))
  return { lista, catalogos, ...(await leerPendientes({ ahora })) }
}
