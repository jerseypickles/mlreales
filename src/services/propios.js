import { config } from '../config/env.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { Snapshot } from '../models/Snapshot.js'
import { ejecutarActorAsync, construirInputDetalle } from './apify.js'
import { indexarDetallesPorSku } from './normalizadorDetalle.js'
import { registrarGasto } from './gastos.js'
import { reviewsOficialesSeguro, itemOficialSeguro, visitasSeguro, precioParaGanarSeguro, meliGet } from './meli.js'
import { promocionesDeItem } from './promociones.js'
import { sincronizarOrdenes } from './ventasMl.js'

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
    if (userProductId) {
      const existente = await ProductoPropio.findOne({ sku: userProductId })
      if (existente) {
        // mismo producto ya seguido por su página /up/: guardar el item id le
        // abre la puerta oficial (precio/stock/vendidos/visitas van por MLC…)
        if (existente.itemIdMl !== sku) {
          existente.itemIdMl = sku
          await existente.save()
        }
        yaSeguidos++
        continue
      }
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

// Mide todos los productos propios activos. Con cuenta ML conectada, la API
// oficial va primero: precio/stock/vendidos reales/visitas/estado, gratis y
// exactos para lo propio. El actor solo entra por los que la API no cubre con
// precio (sin cuenta, o página /up/ sin item id vinculado por el importador).
export async function escanearPropios({ soloOficial = false } = {}) {
  const propios = await ProductoPropio.find({ estado: 'activo' })
  if (!propios.length) return { omitido: true, motivo: 'sin productos propios activos' }

  const fecha = new Date()

  const oficialPorSku = new Map()
  for (const propio of propios) {
    const item = await itemOficialSeguro(propio.itemIdMl ?? propio.sku)
    if (item) oficialPorSku.set(propio.sku, item)
  }

  const sinOficial = propios.filter((p) => !Number.isFinite(oficialPorSku.get(p.sku)?.price))
  let porSku = new Map()
  let costoUsd = 0
  if (sinOficial.length && soloOficial) {
    console.log(
      `[scan-propios] presupuesto agotado: ${sinOficial.length} propio(s) sin precio oficial quedan sin actor esta pasada`,
    )
  }
  if (sinOficial.length && !soloOficial) {
    const r = await ejecutarActorAsync(
      config.actorDetails,
      construirInputDetalle(config.actorDetails, sinOficial.map((p) => p.url)),
      { pollMs: 10_000, timeoutMs: 10 * 60_000, conMeta: true },
    )
    costoUsd = r.costoUsd
    await registrarGasto(null, costoUsd)
    porSku = indexarDetallesPorSku(r.items, sinOficial.map((p) => p.sku)).porSku
  }

  let medidos = 0
  for (const propio of propios) {
    const oficial = oficialPorSku.get(propio.sku) ?? null
    const det = porSku.get(propio.sku) ?? null
    let numReviews = det?.numReviews ?? null
    let rating = det?.rating ?? null
    if (numReviews === null) {
      // reseñas de catálogo (páginas /up/): la API oficial las ve, el actor no
      const r = await reviewsOficialesSeguro(propio.sku)
      if (r) {
        numReviews = r.numReviews
        if (rating === null) rating = r.rating
      }
    }
    const precio = (Number.isFinite(oficial?.price) ? oficial.price : null) ?? det?.precio ?? null
    const stock = Number.isFinite(oficial?.available_quantity) ? oficial.available_quantity : null
    const vendidos = Number.isFinite(oficial?.sold_quantity) ? oficial.sold_quantity : null
    const visitas = oficial ? await visitasSeguro(propio.itemIdMl ?? propio.sku) : null
    // promoción vigente: el precio efectivo manda sobre el de lista
    const promo = oficial ? await promocionesDeItem(propio.itemIdMl ?? propio.sku) : null
    if (promo) propio.promoMl = { ...promo, fecha }
    const precioEfectivo = promo?.activa?.precio ?? precio
    // un cambio del precio EFECTIVO (subida, o fin de campaña) es una
    // intervención medible: la lupa lee su efecto en visitas y ventas
    const efectivoPrevio = (propio.mediciones ?? []).at(-1)?.precioEfectivo
    if (Number.isFinite(efectivoPrevio) && Number.isFinite(precioEfectivo) && efectivoPrevio !== precioEfectivo) {
      propio.historialPrecios.push({
        fecha,
        anterior: efectivoPrevio,
        nuevo: precioEfectivo,
        motivo: promo?.activa ? `promo ${promo.activa.nombre}` : 'precio de lista',
      })
      if (propio.historialPrecios.length > 20) propio.historialPrecios = propio.historialPrecios.slice(-20)
      console.log(`[scan-propios] ${propio.sku} precio efectivo ${efectivoPrevio} → ${precioEfectivo}`)
    }
    // caja de compra: solo tiene sentido en items que compiten en un catálogo
    if (oficial?.catalog_product_id) {
      const ptw = await precioParaGanarSeguro(propio.itemIdMl ?? propio.sku)
      if (ptw) propio.buyBox = { ...ptw, fecha }
    }
    if (!oficial && !det && numReviews === null) continue
    medidos++
    const tituloNuevo = oficial?.title ?? det?.titulo
    if (tituloNuevo) {
      // el usuario edita títulos a mano en Seller Central (ML no deja por API):
      // registrar el cambio permite medir su impacto y gatilla la re-auditoría
      if (propio.titulo && propio.titulo !== tituloNuevo) {
        propio.historialTitulos.push({ fecha, anterior: propio.titulo, nuevo: tituloNuevo })
        if (propio.historialTitulos.length > 20) propio.historialTitulos = propio.historialTitulos.slice(-20)
        console.log(`[scan-propios] ${propio.sku} cambió de título: "${propio.titulo}" → "${tituloNuevo}"`)
      }
      propio.titulo = tituloNuevo
    }
    const imagen = oficial?.pictures?.[0]?.secure_url ?? oficial?.thumbnail ?? det?.imagen
    if (imagen) propio.imagen = imagen
    if (oficial?.status) propio.estadoMl = oficial.status
    if (oficial?.category_id) propio.categoriaMl = oficial.category_id
    if (oficial?.shipping) {
      // logística de la publicación: colecta/Flex/Full. El cambio (ej: ML activa
      // el stock de bodega y pasa a fulfillment) es una intervención medible
      const logistica = oficial.shipping.logistic_type ?? null
      if (propio.envioMl?.logistica && logistica && propio.envioMl.logistica !== logistica) {
        propio.historialLogistica.push({ fecha, anterior: propio.envioMl.logistica, nuevo: logistica })
        if (propio.historialLogistica.length > 10) propio.historialLogistica = propio.historialLogistica.slice(-10)
        console.log(`[scan-propios] ${propio.sku} cambió logística: ${propio.envioMl.logistica} → ${logistica}`)
      }
      propio.envioMl = {
        logistica,
        flex: (oficial.tags ?? []).includes('self_service_in') || logistica === 'self_service',
        envioGratis: oficial.shipping.free_shipping === true,
        fecha,
      }
    }
    propio.ultimoScanEl = fecha
    propio.mediciones.push({ fecha, precio, precioEfectivo, numReviews, rating, stock, vendidos, visitas })
    if (propio.mediciones.length > MAX_MEDICIONES) {
      propio.mediciones = propio.mediciones.slice(-MAX_MEDICIONES)
    }
    await propio.save()
  }

  // lo que ML cobra de verdad por cada venta (comisión + envío + Product Ads).
  // Va solo en la pasada COMPLETA, no en el ciclo de 45 min: el endpoint de
  // facturación acepta 5 requests por minuto y sus montos se mueven por
  // período, no por hora.
  let cargos = null
  if (!soloOficial) {
    try {
      const { sincronizarCargosMl } = await import('./cargosMl.js')
      cargos = await sincronizarCargosMl()
    } catch (err) {
      console.warn(`[scan-propios] cargos de ML no sincronizados: ${err.message}`)
    }
  }

  // ventas reales de la cuenta (orders): mismas pasadas diarias que el scan
  let ordenes = null
  try {
    ordenes = await sincronizarOrdenes()
  } catch (err) {
    console.warn(`[scan-propios] sincronizar órdenes falló: ${err.message}`)
  }

  return {
    propios: propios.length,
    medidos,
    costoUsd,
    ordenesNuevas: ordenes?.nuevas ?? null,
    cargosMl: cargos?.guardados ?? null,
  }
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
