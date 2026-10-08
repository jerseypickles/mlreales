import { EventoComercial } from '../models/EventoComercial.js'
import { diaChile } from './inventarioFull.js'

// EVENTOS COMERCIALES: CALENDARIO, EFECTO Y SALTOS SIN EXPLICAR (8-oct-2026).
// Pedido del importador tras el CyberDay de octubre, que el sistema no vio:
//   1. calendario con fechas exactas, marcado en todas las piezas que aprenden
//   2. el efecto de cada evento (ventas, visitas, impresiones, CTR, CPC)
//   3. detectar solo un salto que no tiene evento y preguntar qué fue
// Las fechas no se inventan: lo que no se sabe se agrega cuando se anuncia.

const DIA = 86400e3
// el primero, con fechas sacadas de los datos (visitas y ventas del 5 al 7)
const SEMILLA = [
  { clave: 'cyberday-2026-10', nombre: 'CyberDay octubre 2026', desde: '2026-10-05', hasta: '2026-10-07', estado: 'inferido', origen: 'inferido',
    nota: 'Fechas inferidas de tus datos (visitas 89 y 111, ventas 9 y 12 el 6 y 7 de octubre): confírmalas o corrígelas.' },
]

export const rangoDias = (desde, hasta) => {
  const out = []
  for (let t = Date.parse(`${desde}T12:00:00Z`); t <= Date.parse(`${hasta}T12:00:00Z`); t += DIA) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

export async function asegurarSemilla() {
  for (const e of SEMILLA) await EventoComercial.updateOne({ clave: e.clave }, { $setOnInsert: { ...e, actualizadoEl: new Date() } }, { upsert: true })
}

// Los días que NO son normales: eventos confirmados, inferidos y saltos por
// revisar (mientras no se explique, un salto tampoco es un día normal).
export async function diasDeEvento() {
  await asegurarSemilla().catch(() => null)
  const evs = await EventoComercial.find({ estado: { $ne: 'descartado' } }).select('desde hasta').lean()
  return new Set(evs.flatMap((e) => rangoDias(e.desde, e.hasta)))
}

const mediana = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2 }

// Pura. Los días que saltan contra la mediana de las 3 semanas anteriores
// (sin contar días de evento): ventas ≥3× y +5, o visitas ≥1,6× y +30. Se
// agrupan los días seguidos. `serie`: [{ dia, ventas, visitas }] en orden.
export function saltos(serie, diasEvento = new Set()) {
  const marcados = []
  for (let i = 0; i < serie.length; i++) {
    const d = serie[i]
    if (diasEvento.has(d.dia)) continue
    const base = serie.slice(Math.max(0, i - 21), i).filter((x) => !diasEvento.has(x.dia))
    if (base.length < 10) continue
    const mv = mediana(base.map((x) => x.ventas)), mvis = mediana(base.map((x) => x.visitas))
    const saltaVentas = d.ventas >= Math.max(3 * (mv ?? 0), (mv ?? 0) + 5)
    const saltanVisitas = mvis != null && d.visitas >= Math.max(1.6 * mvis, mvis + 30)
    if (saltaVentas || saltanVisitas) marcados.push({ dia: d.dia, ventas: d.ventas, visitas: d.visitas, medianaVentas: mv, medianaVisitas: mvis })
  }
  const grupos = []
  for (const m of marcados) {
    const ult = grupos.at(-1)
    if (ult && Date.parse(`${m.dia}T12:00:00Z`) - Date.parse(`${ult.at(-1).dia}T12:00:00Z`) <= DIA) ult.push(m)
    else grupos.push([m])
  }
  return grupos.map((g) => ({ desde: g[0].dia, hasta: g.at(-1).dia, dias: g }))
}

// Pura. El efecto de un evento contra las 2 semanas anteriores normales.
// `serie`: [{ dia, ventas, visitas, impresiones, clicks, gasto }].
export function efectoDe(evento, serie, diasEvento = new Set()) {
  const dentro = serie.filter((d) => d.dia >= evento.desde && d.dia <= evento.hasta)
  const antes = serie.filter((d) => d.dia < evento.desde && !diasEvento.has(d.dia)).slice(-14)
  if (!dentro.length || antes.length < 7) return null
  const prom = (xs, k) => xs.reduce((a, d) => a + (d[k] ?? 0), 0) / xs.length
  const suma = (xs, k) => xs.reduce((a, d) => a + (d[k] ?? 0), 0)
  const r = (a, b) => (b > 0 ? Math.round((a / b) * 10) / 10 : null)
  const ctr = (xs) => (suma(xs, 'impresiones') ? suma(xs, 'clicks') / suma(xs, 'impresiones') : null)
  const cpc = (xs) => (suma(xs, 'clicks') ? suma(xs, 'gasto') / suma(xs, 'clicks') : null)
  const conv = (xs) => (suma(xs, 'visitas') ? suma(xs, 'ventas') / suma(xs, 'visitas') : null)
  return {
    dias: dentro.length, diasBase: antes.length,
    ventasDia: Math.round(prom(dentro, 'ventas') * 10) / 10, ventasDiaBase: Math.round(prom(antes, 'ventas') * 10) / 10, factorVentas: r(prom(dentro, 'ventas'), prom(antes, 'ventas')),
    visitasDia: Math.round(prom(dentro, 'visitas')), visitasDiaBase: Math.round(prom(antes, 'visitas')), factorVisitas: r(prom(dentro, 'visitas'), prom(antes, 'visitas')),
    factorImpresiones: r(prom(dentro, 'impresiones'), prom(antes, 'impresiones')),
    factorCtr: ctr(dentro) != null && ctr(antes) ? r(ctr(dentro), ctr(antes)) : null,
    factorCpc: cpc(dentro) != null && cpc(antes) ? r(cpc(dentro), cpc(antes)) : null,
    factorConversion: conv(dentro) != null && conv(antes) ? r(conv(dentro), conv(antes)) : null,
  }
}

// La cuenta día a día: ventas y visitas del libro, impresiones y clics de los anuncios.
async function serieDeLaCuenta({ ahora, dias = 60 }) {
  const { DiaProductoMl } = await import('../models/DiaProductoMl.js')
  const { AdsDiaMl } = await import('../models/AdsDiaMl.js')
  const desde = diaChile(+ahora - dias * DIA)
  const libro = await DiaProductoMl.aggregate([{ $match: { dia: { $gte: desde } } }, { $group: { _id: '$dia', ventas: { $sum: '$unidades' }, visitas: { $sum: '$visitas' } } }])
  const ads = new Map((await AdsDiaMl.find({ itemId: '*', dia: { $gte: desde } }).select('dia prints clicks costo').lean()).map((a) => [a.dia, a]))
  const hoy = diaChile(ahora)
  return libro.filter((d) => d._id < hoy).sort((a, b) => a._id.localeCompare(b._id))
    .map((d) => ({ dia: d._id, ventas: d.ventas, visitas: d.visitas, impresiones: ads.get(d._id)?.prints ?? 0, clicks: ads.get(d._id)?.clicks ?? 0, gasto: ads.get(d._id)?.costo ?? 0 }))
}

// Una vez al día: mide el efecto de cada evento y anota los saltos sin explicar.
export async function revisarEventos({ ahora = new Date() } = {}) {
  await asegurarSemilla()
  const serie = await serieDeLaCuenta({ ahora })
  let diasEv = await diasDeEvento()
  const nuevos = []
  for (const s of saltos(serie, diasEv)) {
    const clave = `salto-${s.desde}`
    const r = await EventoComercial.updateOne({ clave }, { $setOnInsert: { clave, nombre: 'Salto sin explicar', desde: s.desde, hasta: s.hasta, estado: 'por-revisar', origen: 'detectado',
      nota: `Ventas o visitas muy sobre lo normal (${s.dias.map((d) => `${d.dia}: ${d.ventas} ventas, ${d.visitas} visitas`).join(' · ')}). ¿Qué fue? Si fue un evento, ponle nombre; si no, descártalo.`, actualizadoEl: ahora } }, { upsert: true })
    if (r.upsertedCount) nuevos.push(s)
  }
  diasEv = await diasDeEvento()
  for (const e of await EventoComercial.find({ estado: { $ne: 'descartado' } }).lean()) {
    const efecto = efectoDe(e, serie, new Set([...diasEv].filter((d) => d < e.desde || d > e.hasta)))
    if (efecto) await EventoComercial.updateOne({ _id: e._id }, { $set: { efecto, actualizadoEl: ahora } })
  }
  return { nuevos: nuevos.length, eventos: await EventoComercial.countDocuments({ estado: { $ne: 'descartado' } }) }
}
