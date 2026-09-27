import { Nicho } from '../models/Nicho.js'
import { CurvaEstacional } from '../models/CurvaEstacional.js'
import { Reporte } from '../models/Reporte.js'
import { Snapshot } from '../models/Snapshot.js'
import { Producto } from '../models/Producto.js'
import { pedirJSON } from './llm.js'
import { volumenMensual } from './volumenBusqueda.js'
import { tituloTraeFrase, fraseQueExcluye } from './filtroNicho.js'

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

export const TIPOS_MEJORA = { medicion: 'nombre chileno', competencia: 'competencia mezclada' }
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
export async function pasadaMedicion({ ahora = new Date(), max = MAX_POR_PASADA } = {}) {
  const nichos = await Nicho.find({ estado: 'activo' }).select('keyword nivelBusqueda mejoras').lean()
  const curvas = new Map((await CurvaEstacional.find({ keyword: { $in: nichos.map((n) => n.keyword) } }).select('keyword busquedasMes keywordMedida').lean()).map((c) => [c.keyword, c]))
  const reportes = new Map((await Reporte.aggregate([
    { $match: { nichoId: { $in: nichos.map((n) => n._id) } } }, { $sort: { fecha: -1 } },
    { $group: { _id: '$nichoId', vendidos: { $first: '$metricas.vendidosHistoricos.pisoUnidades' }, titulos: { $first: '$topProductos.titulo' } } },
  ])).map((r) => [String(r._id), r]))
  const candidatos = []
  for (const n of nichos) {
    // con la competencia mezclada pendiente, los vendidos del top no son del
    // producto: primero se limpia, después se juzga la medición
    if ((n.mejoras ?? []).some((x) => x.tipo === 'competencia' && x.estado === 'pendiente')) continue
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

// La pasada diaria: primero la competencia (ensucia todo lo demás), después
// la medición de Google.
export async function pasadaVigia(opciones = {}) {
  const competencia = await pasadaCompetencia(opciones).catch((err) => ({ error: err.message }))
  const medicion = await pasadaMedicion(opciones)
  return { competencia, medicion }
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

// ─── COMPETENCIA MEZCLADA ────────────────────────────────────────────────────
// La búsqueda de ML trae productos que solo comparten una palabra: "carpa
// camping" venía con 30 lonas de repuesto para toldo en su top 60 (27-sep).
// La IA agrupa los títulos del scan y dice qué grupos NO son el producto; la
// frase de cada grupo se verifica contra los títulos antes de sugerirla —
// no puede tocar ni un título que la IA misma llamó "del nicho", ni la
// keyword. Lo decide el importador; aplicado, el reporte se recalcula sin ellos.

const MAX_COMPETENCIA_POR_PASADA = 12
const MIN_PRODUCTOS_GRUPO = 3

const SCHEMA_COMPETENCIA = {
  type: 'object', additionalProperties: false, required: ['grupos'],
  properties: { grupos: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['nombre', 'esDelNicho', 'frase', 'indices'],
    properties: {
      nombre: { type: 'string', description: 'Qué producto es, en pocas palabras' },
      esDelNicho: { type: 'boolean', description: 'true si es el producto que busca la keyword (cualquier variante, tamaño, marca o precio)' },
      frase: { type: 'string', description: 'Para grupos que NO son del nicho: 1 a 3 palabras que aparecen en los títulos de ESE grupo y en ningún título del nicho. Vacío si es del nicho' },
      indices: { type: 'array', items: { type: 'integer' } },
    } } } },
}

const SYSTEM_COMPETENCIA = `Te doy la keyword de un nicho de Mercado Libre Chile y los títulos de su búsqueda, numerados. La búsqueda mezcla productos que solo comparten una palabra. Agrupa TODOS los títulos por qué producto son. Un grupo es del nicho si es el producto que busca la keyword, en cualquier variante (tamaño, capacidad, marca, precio, accesorios incluidos). NO es del nicho si es otro producto: un repuesto, un accesorio suelto, otro artículo que comparte nombre. Ante la duda, del nicho. Para cada grupo que no es del nicho da una frase corta (1 a 3 palabras) que esté en sus títulos y en NINGUNO de los títulos del nicho: esa frase va a filtrar productos automáticamente, así que sé conservador.`

// Pura. Verifica los grupos de la IA contra los títulos y deja solo los que
// una frase separa limpio y pesan en el nicho.
export function verificarGrupos(keyword, productos, grupos) {
  const total = productos.length
  const vendidosTotal = productos.reduce((a, p) => a + (p.vendidos ?? 0), 0)
  const delNicho = new Set(grupos.filter((g) => g.esDelNicho).flatMap((g) => g.indices))
  const salida = []
  for (const g of grupos.filter((x) => !x.esDelNicho && x.frase?.trim())) {
    const frase = g.frase.trim().toLowerCase()
    if (tituloTraeFrase(keyword, frase)) continue // "carpa" sacaría el nicho entero
    const toca = productos.map((p, i) => (tituloTraeFrase(p.titulo, frase) ? i : -1)).filter((i) => i >= 0)
    if (toca.some((i) => delNicho.has(i))) continue // pisa un producto del nicho
    const propios = g.indices.filter((i) => productos[i])
    if (!propios.length || propios.filter((i) => toca.includes(i)).length / propios.length < 0.6) continue // la frase no describe al grupo
    if (toca.length < MIN_PRODUCTOS_GRUPO) continue
    const vendidos = toca.reduce((a, i) => a + (productos[i].vendidos ?? 0), 0)
    const pctProductos = Math.round((toca.length / total) * 100)
    const pctVendidos = vendidosTotal > 0 ? Math.round((vendidos / vendidosTotal) * 100) : null
    if (pctProductos < 8 && (pctVendidos ?? 0) < 10) continue
    salida.push({ nombre: g.nombre, frase, productos: toca.length, pctProductos, pctVendidos,
      ejemplos: toca.slice(0, 3).map((i) => productos[i].titulo) })
  }
  // dos grupos con la misma frase son uno
  return [...new Map(salida.map((x) => [x.frase, x])).values()].sort((a, b) => (b.pctVendidos ?? 0) - (a.pctVendidos ?? 0) || b.productos - a.productos)
}

async function productosDelScan(nicho) {
  const ultimo = await Snapshot.findOne({ keyword: nicho.keyword }).sort({ fecha: -1 }).select('fecha').lean()
  if (!ultimo) return null
  const snaps = await Snapshot.find({ keyword: nicho.keyword, fecha: ultimo.fecha }).sort({ posicion: 1 }).limit(80).select('sku vendidos').lean()
  const titulos = new Map((await Producto.find({ sku: { $in: snaps.map((s) => s.sku) } }).select('sku titulo').lean()).map((p) => [p.sku, p.titulo]))
  return snaps.map((s) => ({ titulo: titulos.get(s.sku), vendidos: s.vendidos ?? 0 }))
    .filter((p) => p.titulo && !fraseQueExcluye(p.titulo, nicho.competenciaExcluida))
}

export async function pasadaCompetencia({ ahora = new Date(), max = MAX_COMPETENCIA_POR_PASADA } = {}) {
  const nichos = await Nicho.find({ estado: 'activo', ultimoScanEl: { $ne: null } }).select('keyword mejoras competenciaExcluida').sort({ ultimoScanEl: -1 }).lean()
  const tocan = nichos.filter((n) => {
    const m = (n.mejoras ?? []).find((x) => x.tipo === 'competencia')
    return !m || (m.estado !== 'pendiente' && +ahora - +new Date(m.decididoEl ?? m.detectadoEl) >= REINTENTO_DIAS * 86400e3)
  }).slice(0, max)
  let sugeridas = 0
  for (const n of tocan) {
    try {
      const productos = await productosDelScan(n)
      if (!productos || productos.length < 10) continue
      const { datos } = await pedirJSON({ system: SYSTEM_COMPETENCIA, maxTokens: 6000, schema: SCHEMA_COMPETENCIA,
        user: JSON.stringify({ keyword: n.keyword, titulos: productos.map((p, i) => `${i}. ${p.titulo}`) }) })
      const grupos = verificarGrupos(n.keyword, productos, datos?.grupos ?? [])
      const mejora = { tipo: 'competencia', estado: grupos.length ? 'pendiente' : 'limpio', detectadoEl: ahora,
        motivo: grupos.length ? `La búsqueda de ML mezcla otros productos con «${n.keyword}»: se están midiendo como si fueran del nicho` : null,
        grupos, revisados: productos.length }
      await Nicho.updateOne({ _id: n._id }, { $pull: { mejoras: { tipo: 'competencia' } } })
      await Nicho.updateOne({ _id: n._id }, { $push: { mejoras: mejora } })
      if (grupos.length) sugeridas++
    } catch (err) {
      console.warn(`[vigia] competencia de "${n.keyword}": ${err.message}`)
    }
  }
  console.log(`[vigia] competencia: ${tocan.length} nichos revisados · ${sugeridas} con productos ajenos sugeridos`)
  return { revisados: tocan.length, sugeridas }
}

// Agrega o quita frases excluidas y recalcula el último reporte, para que
// score, mediana y top cambien en el momento y no en el próximo scan.
export async function ajustarExclusiones(nichoId, { agregar = [], quitar = [] } = {}) {
  const limpiar = (xs) => xs.map((x) => String(x ?? '').trim().toLowerCase()).filter((x) => x.length >= 2 && x.length <= 60)
  const nicho = await Nicho.findById(nichoId)
  if (!nicho) return { error: 'nicho no encontrado' }
  const fuera = new Set(limpiar(quitar))
  const frases = [...new Set([...(nicho.competenciaExcluida ?? []), ...limpiar(agregar)])].filter((f) => !fuera.has(f))
  for (const f of frases) if (tituloTraeFrase(nicho.keyword, f)) return { error: `«${f}» sacaría el nicho entero: está en la keyword` }
  nicho.competenciaExcluida = frases.length ? frases : undefined
  await nicho.save()
  const { generarReporteNicho } = await import('./metricas.js')
  const r = await generarReporteNicho(nicho)
  if (r) {
    await Reporte.updateOne({ nichoId: nicho._id, fecha: r.fechaScan }, { $set: { metricas: r.metricas, topProductos: r.topProductos,
      topSellers: r.topSellers, scoreOportunidad: r.metricas.scoreOportunidad } })
  }
  return { ok: true, frases, excluidos: r?.metricas?.competencia?.excluidos?.productos ?? 0, score: r?.metricas?.scoreOportunidad ?? null }
}

export async function aplicarMejoraCompetencia(nichoId, frases) {
  const nicho = await Nicho.findById(nichoId).lean()
  const m = (nicho?.mejoras ?? []).find((x) => x.tipo === 'competencia' && x.estado === 'pendiente')
  const validas = (frases ?? []).filter((f) => m?.grupos?.some((g) => g.frase === f))
  if (!validas.length) return { error: 'esa sugerencia no está pendiente' }
  const r = await ajustarExclusiones(nichoId, { agregar: validas })
  if (r.error) return r
  await Nicho.updateOne({ _id: nichoId, 'mejoras.tipo': 'competencia' }, { $set: { 'mejoras.$.estado': 'aplicada', 'mejoras.$.elegidas': validas, 'mejoras.$.decididoEl': new Date() } })
  // la sospecha de medición se juzgó con los vendidos sucios: se vuelve a mirar
  await Nicho.updateOne({ _id: nichoId }, { $pull: { mejoras: { tipo: 'medicion', estado: { $in: ['pendiente', 'sin-alternativa'] } } } })
  return r
}
