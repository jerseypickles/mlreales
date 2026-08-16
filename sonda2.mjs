import mongoose from 'mongoose'
await mongoose.connect(process.env.MONGO_URI)
const { sugerirNichos } = await import('./src/services/sugeridor.js')
const { volumenMensual } = await import('./src/services/volumenBusqueda.js')
const r = await sugerirNichos({ tendencias: [] })
const s = r?.sugerencias ?? []
const vol = await volumenMensual(s.map((x) => x.keyword)).catch(() => new Map())
const fs = s.map((x) => ({ ...x, v: vol.get(x.keyword) ?? null }))
fs.sort((a, b) => (b.v?.busquedasMes ?? 0) - (a.v?.busquedasMes ?? 0))
console.log(`\n${'keyword'.padEnd(26)}${'búsq/mes'.padStart(10)}${'ratio'.padStart(7)}${'medido'.padStart(14)}`)
for (const x of fs) {
  const v = x.v
  console.log(`${x.keyword.padEnd(26)}${String(v?.busquedasMes ?? '—').padStart(10)}${String(v?.ratioPico ?? '—').padStart(7)}${String(v?.clasificacion ?? 'sin dato').padStart(14)}`)
  console.log(`   ${(x.razon ?? '').slice(0, 155)}`)
}
const planos = fs.filter((x) => ['todo-el-año', 'alza-suave'].includes(x.v?.clasificacion)).length
console.log(`\nplanos: ${planos}/${fs.length} · superan el piso de 200: ${fs.filter((x) => (x.v?.busquedasMes ?? 0) >= 200).length}/${fs.length}`)
await mongoose.disconnect()
