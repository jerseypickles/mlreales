import mongoose from 'mongoose'
await mongoose.connect(process.env.MONGO_URI)
const { comisionMlExacta } = await import('./src/services/comisionesMl.js')
const { costoEnvioFull, DIMENSIONES_POR_DEFECTO, dimensionesDeItem } = await import('./src/services/envioFull.js')
const { ProductoPropio } = await import('./src/models/ProductoPropio.js')
const CAC = 1343
const ps = await ProductoPropio.find({ estado: 'activo' }).lean()
const contrib = async (p, precio) => {
  const dim = dimensionesDeItem(p?.oficial) ?? DIMENSIONES_POR_DEFECTO
  const c = await comisionMlExacta({ precioClp: precio, categoriaId: p?.categoriaMl })
  const com = Math.round((c.pct/100)*precio + (c.cargoFijoClp ?? 0))
  const e = await costoEnvioFull({ precioClp: precio, dimensiones: dim })
  return precio - com - Math.round(e?.clp ?? 799)
}
console.log(`PISO DE DESCUENTO (CAC medido $${CAC} por venta)\n`)
console.log('  producto                    hoy    piso ML   piso con ads   descuento máx')
for (const p of ps) {
  const u = (p.mediciones ?? []).at(-1) ?? {}
  const hoy = u.precio
  if (!Number.isFinite(hoy)) continue
  // búsqueda del precio donde contribución = 0 y donde = CAC
  let pisoML = null, pisoAds = null
  for (let precio = 800; precio <= hoy; precio += 10) {
    const c = await contrib(p, precio)
    if (pisoML === null && c >= 0) pisoML = precio
    if (pisoAds === null && c >= CAC) { pisoAds = precio; break }
  }
  const pct = pisoAds ? Math.round((1 - pisoAds / hoy) * 100) : null
  console.log(`  ${String(p.titulo).slice(0,26).padEnd(26)} $${String(hoy).padStart(5)}  $${String(pisoML ?? '-').padStart(6)}   $${String(pisoAds ?? '-').padStart(6)}        ${pct !== null ? pct + '%' : '—'}`)
}
await mongoose.disconnect()
