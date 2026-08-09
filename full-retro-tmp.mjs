import mongoose from 'mongoose'
await mongoose.connect(process.env.MONGO_URI)
const db = mongoose.connection.db
const cuenta = await db.collection('melicuentas').findOne({})
const token = cuenta.accessToken

// productos de catálogo que aparecen en los últimos scans de nichos activos
const nichos = await db.collection('nichos').find({ estado: 'activo' }).project({ keyword: 1 }).toArray()
const keywords = nichos.map((n) => n.keyword)
const prods = await db.collection('productos')
  .find({ keywordOrigen: { $in: keywords }, tipoListing: 'catalogo' })
  .project({ sku: 1, esFull: 1, keywordOrigen: 1 })
  .toArray()
console.log(`${prods.length} productos de catálogo en ${keywords.length} nichos activos`)

let ok = 0, corregidos = 0, fallos = 0
for (const p of prods) {
  try {
    const r = await fetch(`https://api.mercadolibre.com/products/${p.sku}/items?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) { fallos++; continue }
    const d = await r.json()
    const tipo = d?.results?.[0]?.shipping?.logistic_type ?? null
    if (!tipo) { fallos++; continue }
    const esFull = tipo === 'fulfillment'
    ok++
    if (p.esFull !== esFull) corregidos++
    await db.collection('productos').updateOne({ sku: p.sku }, { $set: { esFull, logisticaMl: tipo } })
  } catch { fallos++ }
}
console.log(`medidos: ${ok} | esFull CORREGIDO en: ${corregidos} | sin dato: ${fallos}`)
await mongoose.disconnect()
