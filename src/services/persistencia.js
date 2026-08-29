import { Producto } from '../models/Producto.js'
import { Snapshot } from '../models/Snapshot.js'
import { Seller } from '../models/Seller.js'

// Upsert por SKU: re-ejecutar un scan no duplica productos, solo agrega snapshots.
export async function guardarScan({ items, fecha }) {
  if (!items?.length) return { productosNuevos: 0, productosActualizados: 0, snapshotsInsertados: 0 }

  const ops = items.map(({ producto }) => {
    const { sku, keywordOrigen, sellerId, imagen, esFull, envioRapido, catalogId, itemId, ...resto } =
      producto
    const set = { ...resto, activo: true, ultimaVezVisto: fecha }
    if (sellerId) set.sellerId = sellerId // nivel 1 lo trae vacío: no pisar lo que llene el nivel 2
    if (imagen) set.imagen = imagen // no pisar una imagen existente con null
    // el ícono {full_icon} del listado se pierde seguido: cuando el nivel 1 no
    // sabe (null), NO pisar el Full exacto que dejó la API oficial en el scan
    // anterior (caso 6-ago: 29 items con logistic_type fulfillment quedaron
    // en null porque el siguiente nivel 1 los sobrescribió)
    if (esFull != null) set.esFull = esFull
    if (envioRapido != null) set.envioRapido = envioRapido
    // los ids de ML solo los trae el nivel 1 por Zyte. Un scan por Apify los
    // manda en null, y dejarlos entrar borraría lo que ya se sabe — el mismo
    // error que la imagen y el sellerId, que están arriba por lo mismo.
    if (catalogId) set.catalogId = catalogId
    if (itemId) set.itemId = itemId
    return {
      updateOne: {
        filter: { sku },
        update: {
          $set: set,
          $setOnInsert: { sku, keywordOrigen, primeraVezVisto: fecha },
        },
        upsert: true,
      },
    }
  })

  const resultado = await Producto.bulkWrite(ops, { ordered: false })
  const snapshots = await Snapshot.insertMany(
    items.map((item) => item.snapshot),
    { ordered: false },
  )

  return {
    productosNuevos: resultado.upsertedCount ?? 0,
    productosActualizados: resultado.modifiedCount ?? 0,
    snapshotsInsertados: snapshots.length,
  }
}

// Aplica los resultados del nivel 2 sobre productos, sellers y los snapshots del scan.
export async function aplicarDetalleScan({ porSku, fecha }) {
  if (!porSku?.size) return { productosActualizados: 0, snapshotsActualizados: 0, sellersActualizados: 0, reviewsAplicadas: 0 }

  const opsProducto = []
  const opsSnapshot = []
  const sellersPorId = new Map()
  // "medido" = con conteo de reseñas: es lo único que el score exige y lo que
  // el reintento revisa (yaMedidos). Un det con match pero sin ratingCount
  // (páginas de catálogo) aporta precio/seller pero NO cuenta como medición.
  let reviewsAplicadas = 0

  for (const [sku, det] of porSku) {
    // null = el actor no expone ese dato: conservar lo que dijo el nivel 1 / scan previo
    const setProd = {}
    if (det.esFull != null) setProd.esFull = det.esFull
    if (det.origenCrossBorder != null) setProd.origenCrossBorder = det.origenCrossBorder
    if (det.categoriaML) setProd.categoriaML = det.categoriaML
    if (det.categoriaRuta) setProd.categoriaRuta = det.categoriaRuta
    if (det.preguntas?.length) setProd.preguntas = det.preguntas
    if (det.seller?.reputacion) setProd.reputacionSeller = det.seller.reputacion
    if (det.seller?.powerSeller) setProd.powerSeller = det.seller.powerSeller
    if (det.imagen) setProd.imagen = det.imagen
    if (det.seller) {
      setProd.sellerId = det.seller.sellerId
      setProd.esTiendaOficial = det.seller.esTiendaOficial
      if (det.seller.nombre) setProd.vendedor = det.seller.nombre
    }
    // los dets del rescate de reviews traen solo reseñas: un $set vacío revienta el bulkWrite
    if (Object.keys(setProd).length) {
      opsProducto.push({ updateOne: { filter: { sku }, update: { $set: setProd } } })
    }

    const setSnap = {}
    if (det.numReviews !== null) {
      setSnap.numReviews = det.numReviews
      reviewsAplicadas++
    }
    if (det.rating !== null) setSnap.rating = det.rating
    if (det.precio !== null) setSnap.precio = det.precio
    if (det.preguntasIds?.length) setSnap.preguntasIds = det.preguntasIds
    if (Object.keys(setSnap).length) {
      opsSnapshot.push({ updateOne: { filter: { sku, fecha }, update: { $set: setSnap } } })
    }

    if (det.seller) {
      const previo = sellersPorId.get(det.seller.sellerId) ?? { ...det.seller, skus: [] }
      previo.skus.push(sku)
      sellersPorId.set(det.seller.sellerId, previo)
    }
  }

  const opsSeller = [...sellersPorId.values()].map((s) => ({
    updateOne: {
      filter: { sellerId: s.sellerId },
      update: {
        $set: {
          nombre: s.nombre,
          esTiendaOficial: s.esTiendaOficial,
          officialStoreId: s.officialStoreId,
          reputacion: s.reputacion,
          powerSeller: s.powerSeller,
          ultimaActualizacion: fecha,
        },
        $addToSet: { productosTrackeados: { $each: s.skus } },
      },
      upsert: true,
    },
  }))

  const resProd = opsProducto.length ? await Producto.bulkWrite(opsProducto, { ordered: false }) : null
  const resSnap = opsSnapshot.length ? await Snapshot.bulkWrite(opsSnapshot, { ordered: false }) : null
  if (opsSeller.length) await Seller.bulkWrite(opsSeller, { ordered: false })

  return {
    productosActualizados: resProd?.modifiedCount ?? 0,
    snapshotsActualizados: resSnap?.modifiedCount ?? 0,
    sellersActualizados: opsSeller.length,
    reviewsAplicadas,
  }
}
