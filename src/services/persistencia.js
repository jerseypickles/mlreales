import { Producto } from '../models/Producto.js'
import { Snapshot } from '../models/Snapshot.js'

// Upsert por SKU: re-ejecutar un scan no duplica productos, solo agrega snapshots.
export async function guardarScan({ items, fecha }) {
  if (!items?.length) return { productosNuevos: 0, productosActualizados: 0, snapshotsInsertados: 0 }

  const ops = items.map(({ producto }) => {
    const { sku, keywordOrigen, sellerId, ...resto } = producto
    const set = { ...resto, activo: true, ultimaVezVisto: fecha }
    if (sellerId) set.sellerId = sellerId // nivel 1 lo trae vacío: no pisar lo que llene el nivel 2
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
