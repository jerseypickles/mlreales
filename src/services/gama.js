import { Nicho } from '../models/Nicho.js'
import { obtenerProductosUltimoScan } from './metricas.js'

// LA GAMA DE CADA PRODUCTO PROPIO (21-oct-2026).
//
// El importador: "la manguera que estamos mostrando es diferente a las demás,
// calidad, material y todo eso, y es complicado para el sistema identificarlo
// porque piensa que todo es igual". Tenía razón: el sistema compara por
// búsqueda, y en "manguera extensible" (scan del 15-oct) caen 149 mangueras de
// $4.060 a $24.280. Las económicas (bajo $9.000, mediana $6.590) tienen 15 del
// top 20 y 5.053 reseñas; la gama alta ($12.000+, mediana $15.683), 4 y 84.
// Contra la mediana del nicho la manguera de $13.990 —cabezales de aluminio,
// pistola de 7 funciones— se veía el doble de cara y el auditor la comparaba
// con las de $5.700; contra su gama está bajo la mediana.
//
// Ningún título dice "aluminio" ni "metal": la calidad no se lee en el texto.
// El precio es la mejor señal que hay, y lo que el importador corrija a mano
// (sacar una publicación que no es comparable, sumar una que sí) manda.
export const FACTOR_DESDE = 0.7
export const FACTOR_HASTA = 1.6
// con menos de esto la gama no tiene con qué comparar y el auditor usa el nicho
const MIN_RIVALES_GAMA = 2

const redondear100 = (x) => Math.round(x / 100) * 100
const finito = (x) => Number.isFinite(x)

export function precioDePropio(propio) {
  const u = (propio?.mediciones ?? []).at(-1)
  return propio?.promoMl?.activa?.precio ?? u?.precioEfectivo ?? u?.precio ?? null
}

// Pura. El rango de precio de la gama: el que fijó el importador, o de 0,7× a
// 1,6× el precio propio (más arriba que abajo: la gama alta se reparte en un
// rango más ancho de precios que la económica).
export function rangoGama(precio, gama = null) {
  const auto = finito(precio) && precio > 0
  const desde = finito(gama?.desde) ? gama.desde : auto ? redondear100(precio * FACTOR_DESDE) : null
  const hasta = finito(gama?.hasta) ? gama.hasta : auto ? redondear100(precio * FACTOR_HASTA) : null
  if (desde == null || hasta == null) return null
  return { desde: Math.min(desde, hasta), hasta: Math.max(desde, hasta), manual: finito(gama?.desde) || finito(gama?.hasta) }
}

// Pura. Marca cada publicación del scan: en la gama por precio, agregada o
// sacada a mano, o fuera. Las publicaciones propias no son rivales.
export function marcarGama(productos, { precio, gama = null, propios = [] } = {}) {
  const rango = rangoGama(precio, gama)
  if (!rango) return { rango: null, productos: [] }
  const agregadas = new Set(gama?.agregadas ?? [])
  const sacadas = new Set(gama?.sacadas ?? [])
  const mias = new Set(propios.filter(Boolean))
  const marcados = (productos ?? [])
    .filter((p) => p?.sku && !mias.has(p.sku) && !(p.itemId && mias.has(p.itemId)))
    .map((p) => {
      const porPrecio = finito(p.precio) && p.precio >= rango.desde && p.precio <= rango.hasta
      const origenGama = sacadas.has(p.sku) ? 'sacada' : agregadas.has(p.sku) ? 'agregada' : porPrecio ? 'precio' : 'fuera'
      return { ...p, enGama: origenGama === 'precio' || origenGama === 'agregada', origenGama }
    })
  return { rango, productos: marcados }
}

const mediana = (xs) => {
  const v = xs.filter(finito).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2)
}
const suma = (xs) => xs.reduce((a, x) => a + (finito(x) ? x : 0), 0)
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)

// Pura. La gama contra el nicho entero: cuántas son, a qué precio y cuánto de
// lo que se vende se llevan. Las reseñas acumuladas son la historia; las
// reseñas nuevas por día, lo que se vende hoy (con menos de 5 lecturas no se
// afirma). Las sacadas a mano no cuentan en ningún lado: no son de este mercado.
export function lecturaGama(marcados, { precio } = {}) {
  const delNicho = marcados.filter((p) => p.origenGama !== 'sacada')
  const gama = delNicho.filter((p) => p.enGama)
  const precios = gama.map((p) => p.precio).filter(finito)
  const reseniasGama = suma(gama.map((p) => p.numReviews))
  const reseniasNicho = suma(delNicho.map((p) => p.numReviews))
  const conVentaHoy = delNicho.filter((p) => finito(p.resenasNuevasDia))
  const hoyNicho = suma(conVentaHoy.map((p) => p.resenasNuevasDia))
  return {
    publicaciones: gama.length,
    delNicho: delNicho.length,
    medianaPrecio: mediana(precios),
    medianaPrecioNicho: mediana(delNicho.map((p) => p.precio)),
    // qué parte de la gama cobra menos que tú: 0 = eres el más barato de tu gama
    masBaratasQueTuPct: finito(precio) && precios.length ? pct(precios.filter((x) => x < precio).length, precios.length) : null,
    enTop20: gama.filter((p) => finito(p.posicion) && p.posicion <= 20).length,
    resenias: reseniasGama,
    reseniasNicho,
    reseniasPct: pct(reseniasGama, reseniasNicho),
    ventaHoyPct: conVentaHoy.length >= 5 && hoyNicho > 0 ? pct(suma(gama.map((p) => p.resenasNuevasDia)), hoyNicho) : null,
    conVendidos100: gama.filter((p) => (p.vendidos ?? 0) >= 100).length,
  }
}

// Pura. Los rivales del auditor salen de la gama si ahí hay con qué comparar;
// si no, del nicho entero menos lo que el importador sacó, y se dice.
export function rivalesDeGama(marcados, elegir, { excluirSkus = [] } = {}) {
  const deGama = elegir(marcados.filter((p) => p.enGama), { excluirSkus })
  if (deGama.length >= MIN_RIVALES_GAMA) return { ganadores: deGama, de: 'gama' }
  return { ganadores: elegir(marcados.filter((p) => p.origenGama !== 'sacada'), { excluirSkus }), de: 'nicho' }
}

// Pura. Lo que guarda el importador: rango propio y publicaciones sumadas o
// sacadas a mano. `cambio`: { desde, hasta, automatico, agregar, sacar, restaurar }.
export function aplicarCambioGama(gama, cambio = {}) {
  const g = { desde: gama?.desde ?? null, hasta: gama?.hasta ?? null, agregadas: [...(gama?.agregadas ?? [])], sacadas: [...(gama?.sacadas ?? [])] }
  if (cambio.automatico) { g.desde = null; g.hasta = null }
  if (finito(cambio.desde) && cambio.desde > 0) g.desde = Math.round(cambio.desde)
  if (finito(cambio.hasta) && cambio.hasta > 0) g.hasta = Math.round(cambio.hasta)
  const quitar = (lista, sku) => lista.filter((s) => s !== sku)
  for (const [clave, sku] of [['agregar', cambio.agregar], ['sacar', cambio.sacar], ['restaurar', cambio.restaurar]]) {
    if (typeof sku !== 'string' || !sku) continue
    g.agregadas = quitar(g.agregadas, sku)
    g.sacadas = quitar(g.sacadas, sku)
    if (clave === 'agregar') g.agregadas.push(sku)
    if (clave === 'sacar') g.sacadas.push(sku)
  }
  return { ...g, actualizadoEl: new Date() }
}

// LAS GAMAS DE UN NICHO, PARA DECIDIR QUÉ TRAER (21-oct-2026). La otra mitad
// del pedido: "para el sistema es complicado cuando se trata de calidad del
// producto: cuando ve lo mismo se va a ir por lo más barato". La mesa medía el
// nicho con una sola mediana, y la idea de "entrar por calidad" quedaba en el
// texto del analista. Ahora el nicho se parte en tres gamas de precio con el
// mismo número de publicaciones (tercios) y de cada una se mide cuánto vende:
// reseñas acumuladas (la historia), reseñas nuevas por día (lo de hoy), rating
// y quiénes la lideran. Son tercios de precio porque los títulos no dicen la
// calidad.
export const GAMAS = [
  { clave: 'economica', nombre: 'Económica' },
  { clave: 'media', nombre: 'Media' },
  { clave: 'alta', nombre: 'Alta' },
]
const MIN_PUBLICACIONES_GAMAS = 15

// Pura. productos: los del último scan (obtenerProductosUltimoScan).
export function gamasDelNicho(productos, { lideres = 2 } = {}) {
  const conPrecio = (productos ?? []).filter((p) => finito(p.precio) && p.precio > 0 && !p.fueraDelNicho)
  if (conPrecio.length < MIN_PUBLICACIONES_GAMAS) return null
  const precios = conPrecio.map((p) => p.precio).sort((a, b) => a - b)
  const corte = (q) => precios[Math.floor((precios.length - 1) * q)]
  const cortes = { economicaHasta: corte(1 / 3), mediaHasta: corte(2 / 3) }
  const indice = (precio) => (precio <= cortes.economicaHasta ? 0 : precio <= cortes.mediaHasta ? 1 : 2)
  const reseniasNicho = suma(conPrecio.map((p) => p.numReviews))
  const conVentaHoy = conPrecio.filter((p) => finito(p.resenasNuevasDia))
  const hoyNicho = suma(conVentaHoy.map((p) => p.resenasNuevasDia))
  const hayHoy = conVentaHoy.length >= 5 && hoyNicho > 0
  const gamas = GAMAS.map((g, i) => {
    const xs = conPrecio.filter((p) => indice(p.precio) === i)
    const resenias = suma(xs.map((p) => p.numReviews))
    const hoy = suma(xs.map((p) => p.resenasNuevasDia))
    const conRating = xs.filter((p) => finito(p.rating) && (p.numReviews ?? 0) >= 5)
    return {
      ...g,
      desde: i === 0 ? precios[0] : i === 1 ? cortes.economicaHasta : cortes.mediaHasta,
      // la gama alta no tiene tope: su máximo suele ser un accesorio o un kit
      hasta: i === 0 ? cortes.economicaHasta : i === 1 ? cortes.mediaHasta : null,
      publicaciones: xs.length,
      medianaPrecio: mediana(xs.map((p) => p.precio)),
      resenias,
      reseniasPct: pct(resenias, reseniasNicho),
      ventaHoyDia: Math.round(hoy * 10) / 10,
      ventaHoyPct: hayHoy ? pct(hoy, hoyNicho) : null,
      ratingPromedio: conRating.length ? Math.round((suma(conRating.map((p) => p.rating)) / conRating.length) * 100) / 100 : null,
      enTop20: xs.filter((p) => finito(p.posicion) && p.posicion <= 20).length,
      conVendidos100: xs.filter((p) => (p.vendidos ?? 0) >= 100).length,
      lideres: [...xs]
        .sort((a, b) => (b.numReviews ?? 0) - (a.numReviews ?? 0) || (b.vendidos ?? 0) - (a.vendidos ?? 0))
        .slice(0, lideres)
        .map((p) => ({ sku: p.sku, titulo: p.titulo, precio: p.precio, numReviews: p.numReviews ?? null, rating: p.rating ?? null,
          vendidos: p.vendidos ?? null, resenasNuevasDia: p.resenasNuevasDia ?? null, imagen: p.imagen ?? null, url: p.url ?? null })),
    }
  })
  return { publicaciones: conPrecio.length, cortes, conVentaHoy: conVentaHoy.length, gamas }
}

// Pura. En qué gama cae un precio (el objetivo de la cotización o el del
// análisis) y lo que vende esa gama. Sirve también con las gamas guardadas.
export function gamaDelPrecio(resumen, precio) {
  if (!resumen?.gamas?.length || !resumen.cortes || !finito(precio) || precio <= 0) return null
  const i = precio <= resumen.cortes.economicaHasta ? 0 : precio <= resumen.cortes.mediaHasta ? 1 : 2
  const g = resumen.gamas[i]
  return { clave: g.clave, nombre: g.nombre, precio, desde: g.desde, hasta: g.hasta, publicaciones: g.publicaciones,
    medianaPrecio: g.medianaPrecio, reseniasPct: g.reseniasPct, ventaHoyPct: g.ventaHoyPct, ratingPromedio: g.ratingPromedio }
}

// Pura. Lo que lee el analista: sin fotos ni links, que solo gastan tokens.
export function gamasParaAnalista(resumen) {
  if (!resumen) return undefined
  return {
    nota: 'tercios de precio con el mismo número de publicaciones; ventaHoyPct = parte de las reseñas nuevas por día del nicho',
    cortes: resumen.cortes,
    gamas: resumen.gamas.map(({ lideres, ...g }) => ({ ...g, lideres: lideres.map(({ imagen, url, sku, ...l }) => l) })),
  }
}

// el último scan de un nicho cambia una vez al día: 10 minutos de caché bastan
// para que abrir varias tarjetas del mismo nicho no repita las agregaciones
const cacheScan = new Map()
const TTL_SCAN_MS = 10 * 60e3
async function vistaDelNicho(nicho, { fresca = false } = {}) {
  const k = String(nicho._id)
  const hit = cacheScan.get(k)
  if (!fresca && hit && Date.now() - hit.en < TTL_SCAN_MS) return hit.vista
  const vista = await obtenerProductosUltimoScan(nicho)
  cacheScan.set(k, { en: Date.now(), vista })
  return vista
}

// Las gamas de un nicho para su panel. `fresca`: recién escaneado (el worker
// de métricas), sin usar lo guardado en caché.
export async function gamasDeNicho(nicho, { fresca = false } = {}) {
  const vista = await vistaDelNicho(nicho, { fresca })
  if (!vista?.productos?.length) return { estado: 'sin-scan', keyword: nicho.keyword }
  const resumen = gamasDelNicho(vista.productos)
  if (!resumen) return { estado: 'pocas-publicaciones', keyword: nicho.keyword, fechaScan: vista.fechaScan }
  return { estado: 'ok', keyword: nicho.keyword, fechaScan: vista.fechaScan, resumen,
    preciosNicho: vista.productos.filter((p) => !p.fueraDelNicho).map((p) => p.precio).filter((x) => finito(x) && x > 0) }
}

export async function gamaDePropio(propio) {
  if (!propio?.nichoId) return { estado: 'sin-nicho' }
  const nicho = await Nicho.findById(propio.nichoId).select('keyword competenciaExcluida').lean()
  if (!nicho) return { estado: 'sin-nicho' }
  const vista = await vistaDelNicho(nicho)
  if (!vista?.productos?.length) return { estado: 'sin-scan', keyword: nicho.keyword }
  const precio = precioDePropio(propio)
  const { rango, productos } = marcarGama(vista.productos, { precio, gama: propio.gama, propios: [propio.sku, propio.itemIdMl] })
  if (!rango) return { estado: 'sin-precio', keyword: nicho.keyword }
  return { estado: 'ok', keyword: nicho.keyword, fechaScan: vista.fechaScan, precio, rango, productos, lectura: lecturaGama(productos, { precio }) }
}
