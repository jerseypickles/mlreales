import mongoose from 'mongoose'
await mongoose.connect(process.env.MONGO_URI)
const { sugerirNichos } = await import('./src/services/sugeridor.js')
const r = await sugerirNichos({ max: 10 }).catch((e) => ({ error: e.message }))
if (r.error) { console.log('error:', r.error); process.exit(0) }
const lista = r.sugerencias ?? r ?? []
console.log(`${lista.length} sugerencias\n`)
for (const x of lista) {
  const mueble = /mesa|repisa|escritorio|zapatero|silla|banco|mueble|estante/i.test(x.keyword)
  console.log(`${mueble ? '🪑' : '  '} ${String(x.keyword).padEnd(26)} ${x.estacionalidad?.tipo ?? '-'}`)
  console.log(`     ${String(x.razon ?? '').slice(0, 165)}`)
}
await mongoose.disconnect()
