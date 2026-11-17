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
// Es la primera versión, sobre la cuenta entera: la revisión diaria usa
// saltosMismaCanasta (más abajo); esta queda para comparar.
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

// Pura. ¿El producto estaba a la venta ese día? Con el stock medido, medio día
// o más; sin esa medición (historia antigua), que haya tenido visitas o ventas.
const conStock = (f) => (f.stockFraccion != null ? f.stockFraccion >= 0.5 : (f.visitas ?? 0) > 0 || (f.ventas ?? 0) > 0)

// Pura. LOS SALTOS, COMPARANDO IGUAL CON IGUAL.
//
// `saltos` mira la cuenta entera contra su propia mediana. Medido el
// 17-nov-2026 sobre toda la historia: de los días que marcó, la mayoría no
// eran eventos del mercado sino cambios de la propia cuenta. Tres días seguidos
// quedaron como "salto sin explicar" y el dueño no había hecho nada: varios
// productos volvieron a tener stock en Full y sus anuncios se reactivaron
// solos. Antes había pasado lo mismo al subir el gasto en publicidad, al
// publicar productos nuevos y en el lanzamiento. En todos esos casos subieron
// las visitas, no lo que se vende por visita, y el aprendizaje de publicidad
// perdió justo los días en que el gasto cambió.
//
// Un evento del mercado es otra cosa: lo que YA estaba a la venta vende mucho
// más por cada visita (en el CyberDay la conversión se duplicó con las mismas
// impresiones). Entonces:
//   1. misma canasta: cada día se compara solo con los productos que tenían
//      stock ese día y también en casi toda su base;
//   2. saltan las ventas (≥3× y +5, como siempre) contra lo normal de las tres
//      semanas anteriores o de la última semana, lo que sea más alto: cuando la
//      cuenta viene creciendo, un buen día no es un salto;
//   3. y además sube la conversión (ventas por visita) al menos 1,5×. Más
//      visitas con la misma venta por visita es tráfico, no evento.
// Las visitas solas ya no marcan nada. `filas`: [{ itemId, dia, ventas,
// visitas, stockFraccion }].
export const SALTO = { ventana: 21, reciente: 7, minimoBase: 10, parteConStock: 0.7, factorVentas: 3, masVentas: 5, factorConversion: 1.5, visitasBase: 100 }
export function saltosMismaCanasta(filas, diasEvento = new Set(), o = {}) {
  const c = { ...SALTO, ...o }
  const porDia = new Map()
  for (const f of filas ?? []) {
    if (!porDia.has(f.dia)) porDia.set(f.dia, new Map())
    porDia.get(f.dia).set(f.itemId, f)
  }
  const dias = [...porDia.keys()].sort()
  const marcados = []
  for (let i = 0; i < dias.length; i++) {
    const dia = dias[i]
    if (diasEvento.has(dia)) continue
    const base = dias.slice(Math.max(0, i - c.ventana), i).filter((b) => !diasEvento.has(b))
    if (base.length < c.minimoBase) continue
    const estaba = (id, d) => { const x = porDia.get(d).get(id); return !!x && conStock(x) }
    const canasta = [...porDia.get(dia).values()].filter((f) => conStock(f) && base.filter((b) => estaba(f.itemId, b)).length >= c.parteConStock * base.length).map((f) => f.itemId)
    if (!canasta.length) continue
    const total = (d) => canasta.reduce((a, id) => { const x = porDia.get(d).get(id); return { ventas: a.ventas + (x?.ventas ?? 0), visitas: a.visitas + (x?.visitas ?? 0) } }, { ventas: 0, visitas: 0 })
    const hoy = total(dia), antes = base.map(total)
    const normal = Math.max(mediana(antes.map((x) => x.ventas)) ?? 0, mediana(antes.slice(-c.reciente).map((x) => x.ventas)) ?? 0)
    if (hoy.ventas < Math.max(c.factorVentas * normal, normal + c.masVentas)) continue
    const visitasBase = antes.reduce((a, x) => a + x.visitas, 0), ventasBase = antes.reduce((a, x) => a + x.ventas, 0)
    // sin visitas suficientes en la base no se puede decir si cambió la conversión
    if (visitasBase < c.visitasBase || !(hoy.visitas > 0)) continue
    const conversion = hoy.ventas / hoy.visitas, conversionBase = ventasBase / visitasBase
    if (conversion < c.factorConversion * conversionBase) continue
    marcados.push({ dia, ventas: hoy.ventas, visitas: hoy.visitas, medianaVentas: normal, conversionPct: Math.round(conversion * 1000) / 10, conversionBasePct: Math.round(conversionBase * 1000) / 10, productos: canasta.length })
  }
  const grupos = []
  for (const m of marcados) {
    const ult = grupos.at(-1)
    if (ult && Date.parse(`${m.dia}T12:00:00Z`) - Date.parse(`${ult.at(-1).dia}T12:00:00Z`) <= DIA) ult.push(m)
    else grupos.push([m])
  }
  return grupos.map((g) => ({ desde: g[0].dia, hasta: g.at(-1).dia, dias: g }))
}

// Pura. ¿Estos saltos son un NIVEL NUEVO de la cuenta y no un evento?
//
// Un evento comercial dura unos pocos días; cuando la cuenta salta casi todos
// los días de la semana, lo que cambió es la cuenta. Medido el 11-nov-2026: los
// productos nuevos entraron a Full y partieron sus campañas, las visitas se
// duplicaron para quedarse, y el detector marcó como "salto sin explicar" cinco
// de los siete días siguientes. Como un salto por revisar tampoco es un día
// normal, la base de comparación nunca se ponía al día y el plan de campañas,
// el efecto de la publicidad y el costo por venta quedaron juzgando la semana
// del lanzamiento con dos días: justo los días con ventas eran los descartados.
//
// `diasMarcados`: los días de saltos detectados (por revisar o ya reconocidos
// como nivel nuevo). Con `minimo` de los últimos `dias` marcados, es nivel.
// Un evento con nombre en el calendario no pasa por acá: sus días no se marcan
// como salto.
export const RACHA_NIVEL = { dias: 7, minimo: 5 }
export function esNivelNuevo(diasMarcados, hasta, { dias = RACHA_NIVEL.dias, minimo = RACHA_NIVEL.minimo } = {}) {
  const fin = Date.parse(`${hasta}T12:00:00Z`)
  if (!Number.isFinite(fin)) return false
  let marcados = 0
  for (let i = 0; i < dias; i++) if (diasMarcados.has(new Date(fin - i * DIA).toISOString().slice(0, 10))) marcados++
  return marcados >= minimo
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

// Lo mismo, producto por producto: para comparar igual con igual (saltosMismaCanasta).
async function filasPorProducto({ ahora, dias = 60 }) {
  const { DiaProductoMl } = await import('../models/DiaProductoMl.js')
  const desde = diaChile(+ahora - dias * DIA), hoy = diaChile(ahora)
  const libro = await DiaProductoMl.find({ dia: { $gte: desde, $lt: hoy } }).select('itemId dia unidades visitas stockFraccion').lean()
  return libro.map((l) => ({ itemId: l.itemId, dia: l.dia, ventas: l.unidades ?? 0, visitas: l.visitas ?? 0, stockFraccion: l.stockFraccion ?? null }))
}

// Una vez al día: mide el efecto de cada evento y anota los saltos sin explicar.
export async function revisarEventos({ ahora = new Date() } = {}) {
  await asegurarSemilla()
  const serie = await serieDeLaCuenta({ ahora })
  let diasEv = await diasDeEvento()
  const nuevos = []
  for (const s of saltosMismaCanasta(await filasPorProducto({ ahora }), diasEv)) {
    const clave = `salto-${s.desde}`
    const r = await EventoComercial.updateOne({ clave }, { $setOnInsert: { clave, nombre: 'Salto sin explicar', desde: s.desde, hasta: s.hasta, estado: 'por-revisar', origen: 'detectado',
      nota: `Lo que ya estaba a la venta vendió mucho más de lo normal por cada visita (${s.dias.map((d) => `${d.dia}: ${d.ventas} ventas con ${d.visitas} visitas, ${d.conversionPct} de cada 100 visitas compraron contra ${d.conversionBasePct} lo normal`).join(' · ')}). ¿Qué fue? Si fue un evento, ponle nombre; si no, descártalo.`, actualizadoEl: ahora } }, { upsert: true })
    if (r.upsertedCount) nuevos.push(s)
  }
  // un salto que ocupa casi toda la semana es el nivel nuevo de la cuenta: sus
  // días vuelven a ser normales (ver esNivelNuevo). Los ya reconocidos cuentan
  // para la racha, así el día siguiente del mismo nivel no vuelve a quedar fuera.
  const ultimoDia = serie.at(-1)?.dia
  const detectados = await EventoComercial.find({ origen: 'detectado', $or: [{ estado: 'por-revisar' }, { nivelNuevo: true }] }).select('clave desde hasta estado').lean()
  let nivelNuevo = 0
  if (ultimoDia && esNivelNuevo(new Set(detectados.flatMap((e) => rangoDias(e.desde, e.hasta))), ultimoDia)) {
    const desdeRacha = new Date(Date.parse(`${ultimoDia}T12:00:00Z`) - (RACHA_NIVEL.dias - 1) * DIA).toISOString().slice(0, 10)
    for (const e of detectados.filter((x) => x.estado === 'por-revisar' && x.hasta >= desdeRacha)) {
      await EventoComercial.updateOne({ clave: e.clave }, { $set: { estado: 'descartado', nivelNuevo: true, actualizadoEl: ahora,
        nota: 'No fue un evento: la cuenta saltó casi todos los días de esa semana, así que es su nivel nuevo (productos o campañas nuevas). Sus días volvieron a contar como normales.' } })
      nivelNuevo++
    }
  }
  diasEv = await diasDeEvento()
  for (const e of await EventoComercial.find({ estado: { $ne: 'descartado' } }).lean()) {
    const efecto = efectoDe(e, serie, new Set([...diasEv].filter((d) => d < e.desde || d > e.hasta)))
    if (efecto) await EventoComercial.updateOne({ _id: e._id }, { $set: { efecto, actualizadoEl: ahora } })
  }
  return { nuevos: nuevos.length, nivelNuevo, eventos: await EventoComercial.countDocuments({ estado: { $ne: 'descartado' } }) }
}
