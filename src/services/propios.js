import { config } from '../config/env.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { Snapshot } from '../models/Snapshot.js'
import { ejecutarActorAsync, construirInputDetalle } from './apify.js'
import { indexarDetallesPorSku } from './normalizadorDetalle.js'
import { registrarGasto } from './gastos.js'
import { reviewsOficialesSeguro, meliGet } from './meli.js'

const MAX_MEDICIONES = 180 // ~6 meses de serie diaria

// Importa las publicaciones del vendedor conectado como productos propios.
// /users/:id/items/search entrega solo ids; el detalle /items/:id es tolerante
// (la sonda mostró 403 para items ajenos — con el propio debería abrir, pero si
// falla el propio igual nace con la URL de artículo construida y el scan diario
// completa título/imagen). OJO duplicados: el usuario puede seguir el MISMO
// producto por su página /up/ (sku MLCU…) — user_product_id del detalle es el
// puente y si ya está seguido, el item no se duplica.
export async function importarMisItems() {
  const me = await meliGet('/users/me')
  const ids = []
  for (let offset = 0; ; offset += 50) {
    const pagina = await meliGet(`/users/${me.id}/items/search?limit=50&offset=${offset}`)
    const resultados = pagina.results ?? []
    ids.push(...resultados)
    if (!resultados.length || ids.length >= (pagina.paging?.total ?? 0)) break
  }
  let importados = 0
  let yaSeguidos = 0
  for (const sku of ids) {
    if (await ProductoPropio.exists({ sku })) {
      yaSeguidos++
      continue
    }
    let det = null
    try {
      det = await meliGet(`/items/${sku}`)
    } catch (err) {
      console.warn(`[meli] detalle de ${sku} no disponible al importar: ${err.message}`)
    }
    const userProductId = det?.user_product_id ?? null
    if (userProductId && (await ProductoPropio.exists({ sku: userProductId }))) {
      yaSeguidos++
      continue
    }
    await ProductoPropio.create({
      sku,
      url: det?.permalink ?? `https://articulo.mercadolibre.cl/MLC-${sku.slice(3)}`,
      titulo: det?.title ?? undefined,
      imagen: det?.thumbnail ?? undefined,
    })
    importados++
  }
  return { total: ids.length, importados, yaSeguidos }
}

export function extraerSkuDeUrl(url) {
  const m = String(url ?? '').match(/MLCU?-?\d{6,}/)
  return m ? m[0].replace('-', '') : null
}

// Mide todos los productos propios activos en un solo batch del actor de detalle.
export async function escanearPropios() {
  const propios = await ProductoPropio.find({ estado: 'activo' })
  if (!propios.length) return { omitido: true, motivo: 'sin productos propios activos' }

  const fecha = new Date()
  const { items, costoUsd } = await ejecutarActorAsync(
    config.actorDetails,
    construirInputDetalle(config.actorDetails, propios.map((p) => p.url)),
    { pollMs: 10_000, timeoutMs: 10 * 60_000, conMeta: true },
  )
  await registrarGasto(null, costoUsd)

  const { porSku } = indexarDetallesPorSku(items, propios.map((p) => p.sku))
  let medidos = 0
  for (const propio of propios) {
    const det = porSku.get(propio.sku) ?? null
    let numReviews = det?.numReviews ?? null
    let rating = det?.rating ?? null
    if (numReviews === null) {
      // páginas /up/ propias (caso MLCU4383188844): el actor no ve las reseñas
      // de catálogo — la API oficial sí, y de paso respalda si el actor falló
      const r = await reviewsOficialesSeguro(propio.sku)
      if (r) {
        numReviews = r.numReviews
        if (rating === null) rating = r.rating
      }
    }
    if (!det && numReviews === null) continue
    medidos++
    if (det?.titulo) propio.titulo = det.titulo
    if (det?.imagen) propio.imagen = det.imagen
    propio.ultimoScanEl = fecha
    propio.mediciones.push({ fecha, precio: det?.precio ?? null, numReviews, rating })
    if (propio.mediciones.length > MAX_MEDICIONES) {
      propio.mediciones = propio.mediciones.slice(-MAX_MEDICIONES)
    }
    await propio.save()
  }
  return { propios: propios.length, medidos, costoUsd }
}

// Posición orgánica más reciente del producto en algún listado que el sistema
// ya trackea (aparece gratis cuando el producto rankea en un nicho del tablero).
export async function posicionesRecientes(skus) {
  if (!skus.length) return new Map()
  const filas = await Snapshot.aggregate([
    { $match: { sku: { $in: skus }, posicion: { $ne: null } } },
    { $sort: { fecha: -1 } },
    { $group: { _id: '$sku', posicion: { $first: '$posicion' }, keyword: { $first: '$keyword' }, fecha: { $first: '$fecha' } } },
  ])
  return new Map(filas.map((f) => [f._id, { posicion: f.posicion, keyword: f.keyword, fecha: f.fecha }]))
}
