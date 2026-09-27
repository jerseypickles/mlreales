import { Nicho } from '../models/Nicho.js'
import { CurvaEstacional } from '../models/CurvaEstacional.js'
import { Reporte } from '../models/Reporte.js'
import { pedirJSON } from './llm.js'
import { volumenMensual } from './volumenBusqueda.js'

// EL VIGÍA DE MEJORAS: el sistema está pendiente y avisa, el importador decide.
//
// Pedido del importador (27-sep-2026): "es mejor que el learning machine lo
// sepa y le ponga un ícono de mejora en Oportunidades, porque necesito que esté
// pendiente de estas cosas". El primer tipo de mejora es el NOMBRE CHILENO: un
// nicho que en Google casi nadie busca pero que en Mercado Libre vende mucho
// está mal medido, casi siempre porque en Chile se dice de otra forma
// ("aspiradora escoba" 210/mes contra "aspiradora vertical" 12.100). La
// corrección mecánica (preposiciones) ya se aplica sola; un sinónimo no, porque
// puede ser otro producto o una familia más amplia: se sugiere con su volumen
// medido y se aprueba con un botón. Lo aprobado y lo descartado quedan como
// aprendizaje: el radar deja de proponer la palabra mala y el vigía no insiste.

export const TIPOS_MEJORA = { medicion: 'nombre chileno' }
const MAX_POR_PASADA = 8
const REINTENTO_DIAS = 30

// Pura. ¿La medición de Google contradice lo que muestra Mercado Libre?
export function sospechaDeMedicion({ busquedasMes, vendidosTop, nivelMl }) {
  if (!Number.isFinite(busquedasMes)) return null
  if (busquedasMes >= 2000) return null
  if (Number.isFinite(vendidosTop) && vendidosTop >= 5000 && vendidosTop / Math.max(busquedasMes, 1) >= 10) {
    return `Google mide ${busquedasMes.toLocaleString('es-CL')} búsquedas al mes, pero el top de Mercado Libre vendió al menos ${vendidosTop.toLocaleString('es-CL')}: la gente probablemente lo busca con otro nombre`
  }
  if (nivelMl === 'alto' && busquedasMes < 500) {
    return `En Mercado Libre la búsqueda es de nivel alto, pero Google mide solo ${busquedasMes.toLocaleString('es-CL')} al mes`
  }
  return null
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['candidatas'],
  properties: { candidatas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['keyword', 'relacion', 'nota'],
    properties: {
      keyword: { type: 'string', description: 'Cómo lo escribiría un comprador chileno en Google, en minúsculas, sin tildes obligatorias' },
      relacion: { type: 'string', enum: ['mismo-producto', 'familia-mas-amplia'], description: 'mismo-producto si describe EXACTAMENTE lo mismo; familia-mas-amplia si incluye otros productos' },
      nota: { type: 'string', description: 'Por qué, en una frase corta' },
    } } } },
}

const SYSTEM = `Eres experto en cómo se llaman los productos en Chile. Te doy la keyword de un nicho de Mercado Libre Chile y algunos títulos de publicaciones reales del nicho. Propón de 3 a 6 formas en que un comprador CHILENO escribiría ESE MISMO producto en Google (chilenismos, el nombre común en Chile, el orden natural de las palabras). Marca honestamente si cada una es el mismo producto o una familia más amplia (ej: "botella de agua" es más amplia que "botella deportiva"). No propongas marcas ni la misma keyword con otra preposición.`

async function candidatasChilenas(keyword, titulos) {
  const { datos } = await pedirJSON({ system: SYSTEM, user: JSON.stringify({ keyword, titulosDelNicho: titulos.slice(0, 12) }), schema: SCHEMA, maxTokens: 3000 })
  return (datos?.candidatas ?? []).filter((c) => c.keyword && c.keyword.trim().toLowerCase() !== keyword.toLowerCase()).slice(0, 6)
}

// Una pasada: nichos activos con sospecha, sin mejora de medición vigente ni
// descartada hace poco. Una llamada a la IA por nicho y una a Google en lote.
export async function pasadaVigia({ ahora = new Date(), max = MAX_POR_PASADA } = {}) {
  const nichos = await Nicho.find({ estado: 'activo' }).select('keyword nivelBusqueda mejoras').lean()
  const curvas = new Map((await CurvaEstacional.find({ keyword: { $in: nichos.map((n) => n.keyword) } }).select('keyword busquedasMes keywordMedida').lean()).map((c) => [c.keyword, c]))
  const reportes = new Map((await Reporte.aggregate([
    { $match: { nichoId: { $in: nichos.map((n) => n._id) } } }, { $sort: { fecha: -1 } },
    { $group: { _id: '$nichoId', vendidos: { $first: '$metricas.vendidosHistoricos.pisoUnidades' }, titulos: { $first: '$topProductos.titulo' } } },
  ])).map((r) => [String(r._id), r]))
  const candidatos = []
  for (const n of nichos) {
    const m = (n.mejoras ?? []).find((x) => x.tipo === 'medicion')
    if (m && (m.estado === 'pendiente' || +ahora - +new Date(m.decididoEl ?? m.detectadoEl) < REINTENTO_DIAS * 86400e3)) continue
    const c = curvas.get(n.keyword), r = reportes.get(String(n._id))
    const motivo = sospechaDeMedicion({ busquedasMes: c?.busquedasMes, vendidosTop: r?.vendidos, nivelMl: n.nivelBusqueda?.nivel })
    if (motivo) candidatos.push({ n, c, r, motivo })
  }
  const elegidos = candidatos.slice(0, max)
  const propuestas = []
  for (const x of elegidos) {
    const cands = await candidatasChilenas(x.c?.keywordMedida ?? x.n.keyword, (x.r?.titulos ?? []).filter(Boolean)).catch(() => [])
    propuestas.push({ ...x, cands })
  }
  const vols = await volumenMensual([...new Set(propuestas.flatMap((p) => p.cands.map((c) => c.keyword)))]).catch(() => new Map())
  let sugeridas = 0
  for (const p of propuestas) {
    const base = p.c?.busquedasMes ?? 0
    const medidas = p.cands.map((c) => ({ ...c, volumen: vols.get(c.keyword)?.busquedasMes ?? null }))
      .filter((c) => Number.isFinite(c.volumen) && c.volumen >= Math.max(2 * base, 500))
      .sort((a, b) => Number(b.relacion === 'mismo-producto') - Number(a.relacion === 'mismo-producto') || b.volumen - a.volumen)
    const mejora = { tipo: 'medicion', estado: medidas.length ? 'pendiente' : 'sin-alternativa', detectadoEl: ahora, motivo: p.motivo,
      medidaActual: { keyword: p.c?.keywordMedida ?? p.n.keyword, volumen: base }, candidatas: medidas }
    await Nicho.updateOne({ _id: p.n._id }, { $pull: { mejoras: { tipo: 'medicion' } } })
    await Nicho.updateOne({ _id: p.n._id }, { $push: { mejoras: mejora } })
    if (medidas.length) sugeridas++
  }
  const resultado = { sospechosos: candidatos.length, revisados: elegidos.length, sugeridas }
  console.log(`[vigia] ${resultado.sospechosos} nichos con medición sospechosa · ${resultado.revisados} revisados · ${resultado.sugeridas} con nombre chileno sugerido`)
  return resultado
}

// Aprobar: la curva del nicho pasa a medirse con la keyword elegida, y la
// diferencia queda como lección para el radar.
export async function aplicarMejoraMedicion(nichoId, keyword) {
  const nicho = await Nicho.findById(nichoId).lean()
  const m = (nicho?.mejoras ?? []).find((x) => x.tipo === 'medicion' && x.estado === 'pendiente')
  const elegida = m?.candidatas?.find((c) => c.keyword === keyword)
  if (!elegida) return { error: 'esa sugerencia no está pendiente' }
  const d = (await volumenMensual([keyword])).get(keyword)
  if (!d || !Array.isArray(d.curva) || d.curva.length !== 12) return { error: 'Google no devolvió la curva de esa keyword' }
  const { keyword: _k, _id, ...dato } = d
  await CurvaEstacional.updateOne({ keyword: nicho.keyword }, { $set: { ...dato, keyword: nicho.keyword, keywordMedida: keyword,
    correccionFactor: m.medidaActual?.volumen > 0 ? Math.round(d.busquedasMes / m.medidaActual.volumen * 10) / 10 : null } }, { upsert: true })
  await Nicho.updateOne({ _id: nichoId, 'mejoras.tipo': 'medicion' }, { $set: { 'mejoras.$.estado': 'aplicada', 'mejoras.$.elegida': keyword, 'mejoras.$.decididoEl': new Date() } })
  const { registrarTerminoChileno } = await import('./aprendizajes.js')
  await registrarTerminoChileno({ propuesto: m.medidaActual?.keyword ?? nicho.keyword, real: keyword, volumenPropuesto: m.medidaActual?.volumen ?? 0, volumenReal: d.busquedasMes }).catch(() => null)
  return { ok: true, keyword, busquedasMes: d.busquedasMes }
}

export async function descartarMejora(nichoId, tipo) {
  const r = await Nicho.updateOne({ _id: nichoId, 'mejoras.tipo': tipo }, { $set: { 'mejoras.$.estado': 'descartada', 'mejoras.$.decididoEl': new Date() } })
  return { ok: r.modifiedCount > 0 }
}
