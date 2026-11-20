import { Nicho } from '../../models/Nicho.js'
import { Reporte } from '../../models/Reporte.js'
import { palabrasSinSignos, mismaBusqueda } from '../busquedasReales.js'

// ¿QUÉ SEÑAL DESCUBRE BUENOS NICHOS?
//
// El importador (25-sep-2026): "el learning machine será a futuro el
// comandante". El primer paso es que el sistema sepa de dónde salió cada nicho
// del radar —ranking de ML, búsqueda que sube, producto que despega, tienda
// ganadora, autocompletado, temporada, categoría hermana, pasillo probado o
// intuición de la IA— y lo cruce con cómo le fue: veredicto del analista,
// puntaje, si llegó a cotizarse o comprarse. Con muestra suficiente, el
// resultado vuelve al radar para que pese más lo que rinde.
//
// CON HECHOS, NO CON OPINIONES (20-nov-2026). El rendimiento se medía con el veredicto del analista y el puntaje
// guardado: una opinión de la IA juzgando lo que propuso la IA. Y la fuente la declaraba el propio modelo, sin que
// nadie la comprobara. Medido ese día con la venta posterior de cada nicho: las fuentes que traen venta real (el
// ranking de más vendidos, las tiendas que reponen) no dejaron ningún nicho entre los que menos venden, y la que más
// nichos flojos dejó fue «temporada». Desde ahora la fuente la anota el código (`verificarFuente`) y el rendimiento
// se mide con lo que el nicho vendió después en Mercado Libre, nivelado por temporada como en la mesa.

export const MINIMO_POR_FUENTE = 10
// para hablar de la venta de una fuente bastan menos nichos: es un hecho medido, no un porcentaje de opiniones
export const MINIMO_CON_VENTA = 5
const NO_SON_DEL_RADAR = ['sin-registrar', 'a-mano', 'jugada']
const AVANZADO = ['cotizando', 'pedido', 'vendiendo']

// Pura. Los cortes de los tercios de la venta medida, entre TODOS los nichos con venta y no solo los del radar.
export function tercios(valores) {
  const v = (valores ?? []).filter(Number.isFinite).sort((a, b) => a - b)
  if (v.length < 6) return null
  return { bajo: v[Math.floor(v.length / 3)], alto: v[Math.floor((v.length * 2) / 3)] }
}

// Pura. nichos: {_id, origen, radarInfo, etapaCompra}; veredictos: Map(nichoId → {veredicto, score});
// ventas: Map(nichoId → venta medida en ML, nivelada por temporada); cortes: tercios() de esa venta.
// Lo que no vino del radar (abierto a mano, o una jugada derivada de otro nicho) va en su propia fila: sirve de
// comparación y nunca vuelve al radar.
export function rendimientoPorFuente(nichos, veredictos, { ventas = null, cortes = null } = {}) {
  const porFuente = new Map()
  for (const n of nichos) {
    const fuente = n.origen === 'manual' ? 'a-mano' : n.origen === 'jugada' ? 'jugada' : n.radarInfo?.fuente ?? 'sin-registrar'
    const f = porFuente.get(fuente) ?? { fuente, nichos: 0, conVeredicto: 0, entrar: 0, condiciones: 0, noEntrar: 0, puntajes: [], avanzados: 0, conVenta: 0, ventaAlta: 0, ventaBaja: 0 }
    f.nichos++
    const v = veredictos.get(String(n._id))
    if (v?.veredicto) {
      f.conVeredicto++
      if (v.veredicto === 'entrar') f.entrar++
      else if (v.veredicto === 'no_entrar') f.noEntrar++
      else f.condiciones++
      if (Number.isFinite(v.score)) f.puntajes.push(v.score)
    }
    if (AVANZADO.includes(n.etapaCompra)) f.avanzados++
    const venta = ventas?.get(String(n._id))
    if (cortes && Number.isFinite(venta)) {
      f.conVenta++
      if (venta >= cortes.alto) f.ventaAlta++
      else if (venta < cortes.bajo) f.ventaBaja++
    }
    porFuente.set(fuente, f)
  }
  return [...porFuente.values()].map(({ puntajes, ...f }) => ({ ...f,
    tasaEntrar: f.conVeredicto ? Math.round(f.entrar / f.conVeredicto * 100) : null,
    tasaNoEntrar: f.conVeredicto ? Math.round(f.noEntrar / f.conVeredicto * 100) : null,
    puntajeMedio: puntajes.length ? Math.round(puntajes.reduce((a, b) => a + b, 0) / puntajes.length) : null,
    conMuestra: f.conVeredicto >= MINIMO_POR_FUENTE,
    conMuestraVenta: f.conVenta >= MINIMO_CON_VENTA,
    // viene rindiendo mal: con muestra, dejó más nichos entre los que menos venden que entre los que más
    floja: f.conVenta >= MINIMO_CON_VENTA && f.ventaBaja > f.ventaAlta,
  })).sort((a, b) => b.nichos - a.nichos)
}

// LA FUENTE LA ANOTA EL CÓDIGO. Las fuentes que son un dato (un ranking, una tienda, una búsqueda) se pueden
// comprobar: la idea tiene que calzar con algo que de verdad venía en ese bloque del contexto. Van en este orden,
// de la evidencia más fuerte a la más débil; la primera que calza es la fuente.
export const FUENTES_CON_DATO = ['ranking-ml', 'tienda-ganadora', 'producto-que-despega', 'tendencia-sostenida', 'busqueda-que-sube', 'autocompletado']

const citaA = (evidencia, texto) => {
  const e = palabrasSinSignos(evidencia), t = [...palabrasSinSignos(texto)]
  return t.length >= 2 && t.filter((p) => e.has(p)).length / t.length >= 0.6
}

// Pura. idea: {keyword, fuente (la que declaró el modelo), evidencia}; bloques: { fuente → [textos que se le
// mostraron al modelo] }. Devuelve la fuente que queda anotada, si se pudo comprobar, con qué, y lo declarado.
export function verificarFuente(idea, bloques = {}) {
  const declarada = idea?.fuente ?? null
  for (const fuente of FUENTES_CON_DATO) {
    const dato = (bloques[fuente] ?? []).find((t) => mismaBusqueda(idea?.keyword, t))
    if (dato) return { fuente, verificada: true, evidencia: String(dato).slice(0, 160), declarada }
  }
  if (FUENTES_CON_DATO.includes(declarada)) {
    // la keyword no calza palabra por palabra (un sinónimo, otra forma de decirlo): vale si la evidencia que
    // escribió el modelo cita de verdad algo de ese bloque; si no, es una idea suya
    const dato = (bloques[declarada] ?? []).find((t) => citaA(idea?.evidencia, t))
    if (dato) return { fuente: declarada, verificada: true, evidencia: String(dato).slice(0, 160), declarada }
    return { fuente: 'intuicion', verificada: false, evidencia: idea?.evidencia || null, declarada }
  }
  // temporada, categoría hermana, pasillo probado o intuición: no hay un dato contra el cual comprobarlas
  return { fuente: declarada ?? 'intuicion', verificada: false, evidencia: idea?.evidencia || null, declarada }
}

// La venta medida de cada nicho en Mercado Libre, llevada al nivel de un mes promedio (igual que la mesa).
export async function ventaNiveladaPorNicho({ ahora = new Date() } = {}) {
  const { resenasPorNicho, factorTemporada } = await import('../demandaMlVsGoogle.js')
  const { MIN_SCANS_VENTA } = await import('./puntajeSombra.js')
  const { CurvaEstacional } = await import('../../models/CurvaEstacional.js')
  const resenas = await resenasPorNicho({ ahora })
  const nichos = await Nicho.find({ _id: { $in: [...resenas.keys()] } }).select('keyword').lean()
  const curvas = new Map((await CurvaEstacional.find({ keyword: { $in: nichos.map((n) => n.keyword) }, 'curva.11': { $exists: true } }).select('keyword curva').lean()).map((c) => [c.keyword, c.curva]))
  const ventas = new Map()
  for (const n of nichos) {
    const r = resenas.get(String(n._id))
    if (!r || r.scans < MIN_SCANS_VENTA || !Number.isFinite(r.mediana)) continue
    const factor = factorTemporada(curvas.get(n.keyword), r.meses)
    ventas.set(String(n._id), r.mediana / Math.min(2, Math.max(0.5, factor ?? 1)))
  }
  return ventas
}

export async function fuentesDelRadar() {
  const nichos = await Nicho.find({}).select('origen radarInfo.fuente radarInfo.descubiertoEl etapaCompra estado').lean()
  const ultimos = await Reporte.aggregate([
    { $match: { nichoId: { $in: nichos.map((n) => n._id) }, 'analisis.veredicto': { $exists: true } } },
    { $sort: { fecha: -1 } },
    { $group: { _id: '$nichoId', veredicto: { $first: '$analisis.veredicto' }, score: { $first: '$scoreOportunidad' } } },
  ])
  const veredictos = new Map(ultimos.map((r) => [String(r._id), r]))
  const ventas = await ventaNiveladaPorNicho().catch(() => new Map())
  const cortes = tercios([...ventas.values()])
  return { desde: '2026-09-25', nichosConVenta: ventas.size, fuentes: rendimientoPorFuente(nichos, veredictos, { ventas, cortes }) }
}

// Las líneas que lee el radar: lo que después vendieron los nichos de cada fuente. Solo fuentes con muestra, y
// nunca «sin registrar» (los nichos anteriores al 25-sep no dicen de dónde salieron) ni lo que se abrió a mano.
export async function historialParaRadar() {
  const { fuentes } = await fuentesDelRadar()
  return fuentes.filter((f) => f.conMuestraVenta && !NO_SON_DEL_RADAR.includes(f.fuente))
    .map((f) => `- ${f.fuente}: de ${f.conVenta} nichos con venta medida, ${f.ventaAlta} quedaron entre los que más venden en Mercado Libre y ${f.ventaBaja} entre los que menos`)
}

// Las fuentes que vienen rindiendo mal: sus ideas van al final de la fila cuando se reparte el cupo del día.
export async function fuentesFlojas() {
  const { fuentes } = await fuentesDelRadar()
  return new Set(fuentes.filter((f) => f.floja && !NO_SON_DEL_RADAR.includes(f.fuente)).map((f) => f.fuente))
}
