import mongoose from 'mongoose'
import { unidadesDelTitulo } from '../metricas.js'

// ¿LO QUE EL SISTEMA RECOMENDÓ SE ESTÁ VENDIENDO?
//
// El importador (9-nov-2026): "¿el learning machine comprendió que ciertos
// productos que dio están vendiendo?". No lo comprendía: `fuentesRadar` mide
// qué señal termina en veredicto "entrar", pero nadie miraba si lo que se trajo
// después se vendió. Esta pieza cierra ese lazo, en sombra:
//
//  1. Toma el análisis vigente CUANDO SE DECIDIÓ la compra (no el de hoy, que
//     ya vio el resultado).
//  2. Compara en la misma unidad: el producto se ubica en su gama de precio del
//     nicho, y si el pack trae otra cantidad que la recomendada se dice, porque
//     ahí precio y costo no son comparables (medido el 9-nov: se recomendó un
//     pack y se publicó otro tamaño; un set chico y se trajo uno grande).
//  3. Le pone una venta esperada: lo que vende al día una publicación promedio
//     de esa gama (reseñas nuevas por día de la gama × ventas por reseña ÷
//     publicaciones). Es una referencia gruesa a propósito: lo que se aprende es
//     el FACTOR entre lo real y esa referencia para un vendedor que recién entra.
//  4. Mide lo real solo en días con stock y con la logística actual: la semana
//     del paso a Full y los quiebres no son "poca demanda".
//  5. Pone nota recién con muestra (días con stock); antes dice "madurando".

export const MIN_DIAS_CON_STOCK = 14
export const MIN_CASOS = 5
export const VENTAS_POR_RESENIA_BASE = 10 // cota de la calibración en auditoría; se reemplaza por la medida si existe
const SI = ['entrar', 'entrar_con_condiciones']
const GAMAS = ['economica', 'media', 'alta']

const finito = (x) => Number.isFinite(x)
const r2 = (x) => (finito(x) ? Math.round(x * 100) / 100 : null)
const fecha = (x) => { const d = new Date(x ?? NaN); return finito(+d) ? d : null }
const mediana = (xs) => {
  const o = xs.filter(finito).sort((a, b) => a - b)
  return o.length ? (o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2) : null
}

// Pura. Cuándo se decidió traerlo: lo más temprano entre la etapa de compra,
// la cotización y la primera publicación.
export function fechaDecision(nicho, propios) {
  const fechas = [fecha(nicho?.etapaCompraEl), fecha(nicho?.exwCotizadoEl), ...propios.map((p) => fecha(p.creadoEl))].filter(Boolean)
  return fechas.length ? new Date(Math.min(...fechas.map(Number))) : null
}

// Pura. El análisis que se tenía a la vista al decidir. Si el primero es
// posterior se usa igual, marcado: ya no es una predicción limpia.
export function analisisDeDecision(reportes, decididoEl) {
  const con = reportes.filter((r) => r.analisis?.veredicto).sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
  if (!con.length) return null
  const antes = decididoEl ? con.filter((r) => +new Date(r.fecha) <= +decididoEl).at(-1) : null
  const r = antes ?? con[0]
  return { fecha: r.fecha, posterior: !antes, veredicto: r.analisis.veredicto, confianza: r.analisis.confianza ?? null,
    score: r.scoreOportunidad ?? null, recomendacion: r.analisis.recomendacion ?? null }
}

function indiceGama(resumen, precio) {
  if (!resumen?.cortes || !resumen.gamas?.length || !finito(precio) || precio <= 0) return null
  return precio <= resumen.cortes.economicaHasta ? 0 : precio <= resumen.cortes.mediaHasta ? 1 : 2
}

// Pura. Venta esperada por día de UNA publicación típica de la gama: sin las
// 3 que más venden cuando el reporte lo trae (medido el 9-nov: en un nicho
// concentrado el promedio simple pedía a un recién llegado la venta de los
// líderes). Los reportes anteriores solo permiten el promedio.
export function esperadoDeGama(gama, ventasPorResenia = VENTAS_POR_RESENIA_BASE) {
  if (!gama || !finito(gama.ventaHoyDia) || !(gama.publicaciones > 0)) return null
  if (finito(gama.ventaHoyTop3Dia) && gama.publicaciones > 3) {
    return { ventaDia: r2(Math.max(0, gama.ventaHoyDia - gama.ventaHoyTop3Dia) * ventasPorResenia / (gama.publicaciones - 3)), referencia: 'sin-lideres' }
  }
  return { ventaDia: r2(gama.ventaHoyDia * ventasPorResenia / gama.publicaciones), referencia: 'promedio' }
}

// Pura. Unidades del pack propio: lo que declara el título o el número con que
// empieza ("60 Pañales…").
export function unidadesDePropio(titulo) {
  const declaradas = unidadesDelTitulo(titulo)
  if (declaradas) return declaradas
  const m = String(titulo ?? '').trim().match(/^(\d{1,4})\s+(?!cm|mm|mts?\b|m\b|w\b|v\b|ml|lts?\b|kg|gb)[a-záéíóúñ]/i)
  const n = m ? Number(m[1]) : null
  return n >= 2 && n <= 1000 ? n : null
}

// Pura. Unidades que pedía la recomendación: un número o un rango ("pack
// 100-120u", "kits de 24-68 piezas").
export function unidadesRecomendadas(rec) {
  for (const texto of [rec?.titular, rec?.segmento]) {
    const t = String(texto ?? '').toLowerCase()
    const rango = t.match(/(\d{1,4})\s*(?:-|–|a)\s*(\d{1,4})\s*(?:u\b|unidades|uds?\b|piezas|pzas?\b)/)
    if (rango && Number(rango[1]) < Number(rango[2])) return { desde: Number(rango[1]), hasta: Number(rango[2]) }
    const n = unidadesDelTitulo(t) ?? Number(t.match(/\bpacks?\s*(?:de\s*)?(\d{1,4})\b/)?.[1] ?? NaN)
    if (n >= 2) return { desde: n, hasta: n }
  }
  return null
}

// Pura. Días que sirven de un producto: con stock y con la logística que
// tiene hoy, sin el día del cambio.
export function diasUtiles(dias) {
  const orden = [...dias].sort((a, b) => a.dia.localeCompare(b.dia))
  const actual = orden.at(-1)?.logistica ?? null
  let desde = 0
  orden.forEach((d, i) => { if (d.cambioLogistica || (actual && d.logistica && d.logistica !== actual)) desde = i + 1 })
  return orden.slice(desde).filter((d) => finito(d.stockFraccion) && d.stockFraccion >= 0.5)
}

function lecturaRatio(ratio) {
  if (!finito(ratio)) return null
  return ratio >= 1 ? 'sobre-lo-esperado' : ratio >= 0.5 ? 'en-linea' : 'bajo-lo-esperado'
}

// Pura. nicho: {_id, keyword, etapaCompraEl, exwCotizadoEl, exwCotizadoUsd};
// propios: [{itemId, titulo, imagen, creadoEl, estadoMl, costoUnitarioClp}];
// reportes: los del nicho; diasPorItem: Map(itemId → renglones del libro diario);
// dejaPorItem: Map(itemId → lo que deja una venta antes de publicidad).
export function cruzarNicho({ nicho, propios, reportes, diasPorItem, dejaPorItem = new Map(), ventasPorResenia = VENTAS_POR_RESENIA_BASE }) {
  const resumen = [...reportes].filter((r) => r.metricas?.gamas?.gamas?.length).sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha)).at(-1)?.metricas.gamas ?? null

  const porGama = new Map()
  for (const p of propios) {
    const dias = diasPorItem.get(p.itemId) ?? []
    const conPrecio = [...dias].sort((a, b) => a.dia.localeCompare(b.dia)).filter((d) => finito(d.precio) && d.precio > 0)
    const precio = conPrecio.at(-1)?.precio ?? (finito(p.precio) ? p.precio : null)
    const i = indiceGama(resumen, precio)
    const clave = i == null ? 'sin-gama' : GAMAS[i]
    porGama.set(clave, [...(porGama.get(clave) ?? []), { ...p, precio, dias, utiles: diasUtiles(dias) }])
  }

  const grupos = []
  for (const [claveGama, ps] of porGama) {
    const gama = resumen?.gamas?.[GAMAS.indexOf(claveGama)] ?? null
    // la decisión es de cada grupo: en un mismo nicho conviven productos
    // antiguos y los que se trajeron después con otro análisis a la vista
    const decididoEl = fechaDecision(nicho, ps)
    const decision = analisisDeDecision(reportes, decididoEl)
    const rec = decision?.recomendacion ?? null
    const recPrecio = finito(rec?.precioVentaClp) ? rec.precioVentaClp : null
    const iRec = indiceGama(resumen, recPrecio)
    const unidadesRec = unidadesRecomendadas(rec)
    const diasConStock = new Set(ps.flatMap((p) => p.utiles.map((d) => d.dia)))
    const unidades = ps.reduce((s, p) => s + p.utiles.reduce((a, d) => a + (d.unidades ?? 0), 0), 0)
    const unidadesTotales = ps.reduce((s, p) => s + p.dias.reduce((a, d) => a + (d.unidades ?? 0), 0), 0)
    const visitas = ps.reduce((s, p) => s + p.utiles.reduce((a, d) => a + (d.visitas ?? 0), 0), 0)
    const ultimoDia = ps.flatMap((p) => p.dias.map((d) => d.dia)).sort().at(-1) ?? null
    const conStockHoy = ps.some((p) => p.utiles.some((d) => d.dia === ultimoDia))
    const realDia = diasConStock.size ? r2(unidades / diasConStock.size) : null
    const esperado = esperadoDeGama(gama, ventasPorResenia)
    const esperadoDia = esperado?.ventaDia ?? null
    const ratio = finito(realDia) && esperadoDia > 0 ? r2(realDia / esperadoDia) : null
    const precio = mediana(ps.map((p) => p.precio))
    const dejas = ps.map((p) => dejaPorItem.get(p.itemId)).filter(finito)
    const deja = dejas.length ? Math.round(mediana(dejas)) : null
    const sinCosto = ps.some((p) => !(p.costoUnitarioClp > 0))
    // varios tamaños en el grupo: manda el de la publicación que más vendió
    const unidadesPropias = [...ps].sort((a, b) => b.utiles.reduce((s, d) => s + (d.unidades ?? 0), 0) - a.utiles.reduce((s, d) => s + (d.unidades ?? 0), 0)).map((p) => unidadesDePropio(p.titulo)).find(Boolean) ?? null
    const mismaGama = iRec == null || claveGama === 'sin-gama' ? null : GAMAS[iRec] === claveGama
    const mismasUnidades = unidadesRec && unidadesPropias ? unidadesPropias >= unidadesRec.desde && unidadesPropias <= unidadesRec.hasta : null

    const falta = []
    if (!decision) falta.push('nicho sin análisis')
    else if (decision.posterior) falta.push('el primer análisis es posterior a la decisión')
    if (!gama) falta.push('nicho sin gamas de precio medidas')
    else if (esperadoDia == null) falta.push('gama sin venta medida')
    if (sinCosto) falta.push('sin costo cargado')
    if (diasConStock.size < MIN_DIAS_CON_STOCK) falta.push(`${diasConStock.size} de ${MIN_DIAS_CON_STOCK} días con stock`)
    if (!conStockHoy) falta.push('sin stock hoy')

    const medido = diasConStock.size >= MIN_DIAS_CON_STOCK && ratio != null && !!decision
    const vende = medido ? ratio >= 0.5 && (deja == null || deja > 0) : null
    const acierto = !medido || decision.posterior ? null : SI.includes(decision.veredicto) ? vende : decision.veredicto === 'no_entrar' ? !vende : null

    grupos.push({
      clave: `${nicho._id}:${claveGama}`, nichoId: String(nicho._id), keyword: nicho.keyword, gama: claveGama, gamaNombre: gama?.nombre ?? null,
      productos: [...ps].sort((a, b) => b.utiles.reduce((s, d) => s + (d.unidades ?? 0), 0) - a.utiles.reduce((s, d) => s + (d.unidades ?? 0), 0)).map((p) => ({ itemId: p.itemId, titulo: p.titulo, imagen: p.imagen ?? null, estadoMl: p.estadoMl ?? null, precio: p.precio })),
      decision: decision && { fecha: decision.fecha, decididoEl, posterior: decision.posterior, veredicto: decision.veredicto, confianza: decision.confianza, score: decision.score,
        titular: rec?.titular ?? null, segmento: rec?.segmento ?? null },
      comparacion: {
        precioRecomendado: recPrecio, precioReal: precio, gamaRecomendada: iRec == null ? null : GAMAS[iRec], mismaGama,
        unidadesRecomendadas: unidadesRec, unidadesPropias: unidadesPropias ?? null, mismasUnidades,
        precioUnidadRecomendado: recPrecio && unidadesRec ? Math.round(recPrecio / unidadesRec.desde) : null,
        precioUnidadReal: precio && unidadesPropias ? Math.round(precio / unidadesPropias) : null,
        exwMaximoUsd: rec?.exwMaximoUsd ?? null, exwCotizadoUsd: nicho.exwCotizadoUsd ?? null,
        comparable: mismaGama !== false && mismasUnidades !== false,
      },
      esperado: { ventaDia: esperadoDia, referencia: esperado?.referencia ?? null, ventasPorResenia, reseniasDiaGama: gama?.ventaHoyDia ?? null, publicacionesGama: gama?.publicaciones ?? null },
      real: { diasConStock: diasConStock.size, unidades, unidadesTotales, ventaDia: realDia, visitas, conversionPct: visitas ? r2(unidades / visitas * 100) : null,
        conStockHoy, ultimoDia, dejaPorVenta: deja, dejo: deja != null ? deja * unidades : null,
        serie: [...diasConStock].sort().slice(-28).map((dia) => ({ dia, unidades: ps.reduce((s, p) => s + (p.utiles.find((d) => d.dia === dia)?.unidades ?? 0), 0) })) },
      ratio, lectura: lecturaRatio(ratio), estado: medido ? 'medido' : 'madurando', progresoPct: Math.min(100, Math.round(diasConStock.size / MIN_DIAS_CON_STOCK * 100)),
      acierto, falta,
    })
  }
  return grupos
}

// Pura. Lo que aprende la máquina del conjunto: cuántos veredictos acertó y
// cuánto vende de verdad un producto recién entrado contra la referencia.
export function resumenCruce(grupos) {
  const medidos = grupos.filter((g) => g.estado === 'medido')
  const conNota = medidos.filter((g) => g.acierto != null)
  const aciertos = conNota.filter((g) => g.acierto).length
  const factor = mediana(medidos.map((g) => g.ratio))
  const porVeredicto = {}
  for (const g of grupos) {
    const v = g.decision?.veredicto ?? 'sin-analisis'
    const x = porVeredicto[v] ??= { grupos: 0, medidos: 0, unidades: 0, ratios: [] }
    x.grupos++; x.unidades += g.real.unidades
    if (g.estado === 'medido') { x.medidos++; x.ratios.push(g.ratio) }
  }
  for (const x of Object.values(porVeredicto)) { x.ratioMediano = r2(mediana(x.ratios)); delete x.ratios }
  return {
    grupos: grupos.length, medidos: medidos.length, madurando: grupos.length - medidos.length,
    conNota: conNota.length, aciertos, tasaAcierto: conNota.length ? Math.round(aciertos / conNota.length * 100) : null,
    factorEntrante: r2(factor), estado: medidos.length >= MIN_CASOS ? 'con-muestra' : medidos.length ? 'pocos-casos' : 'sin-casos',
    minimoCasos: MIN_CASOS, minimoDias: MIN_DIAS_CON_STOCK, porVeredicto,
  }
}

const schema = new mongoose.Schema({
  dia: { type: String, required: true }, // AAAA-MM-DD
  clave: { type: String, required: true }, // nichoId:gama
  keyword: String,
  veredicto: String,
  estado: String,
  diasConStock: Number,
  unidades: Number,
  ventaDia: Number,
  esperadoDia: Number,
  ratio: Number,
  acierto: { type: Boolean, default: null },
}, { versionKey: false })
schema.index({ clave: 1, dia: 1 }, { unique: true })
export const CruceRecomendacion = mongoose.models.CruceRecomendacion ?? mongoose.model('CruceRecomendacion', schema)

// `conEconomia: false` deja fuera el plan de campañas, que consulta a ML: es
// para correr la pieza desde un script sin tocar el token del servidor.
export async function recomendadoVsVendido({ ahora = new Date(), guardar = false, conEconomia = true } = {}) {
  const [{ ProductoPropio }, { Nicho }, { Reporte }, { DiaProductoMl }] = await Promise.all([
    import('../../models/ProductoPropio.js'), import('../../models/Nicho.js'), import('../../models/Reporte.js'), import('../../models/DiaProductoMl.js'),
  ])
  const propios = (await ProductoPropio.find({ nichoId: { $ne: null }, estadoMl: { $ne: 'closed' } })
    .select('sku itemIdMl titulo imagen creadoEl estadoMl costoUnitarioClp nichoId precio').lean())
    .map((p) => ({ ...p, itemId: p.itemIdMl ?? p.sku }))
  const nichoIds = [...new Set(propios.map((p) => String(p.nichoId)))]
  const [nichos, reportes, dias] = await Promise.all([
    Nicho.find({ _id: { $in: nichoIds } }).select('keyword etapaCompraEl exwCotizadoEl exwCotizadoUsd').lean(),
    Reporte.find({ nichoId: { $in: nichoIds } }).select('nichoId fecha scoreOportunidad analisis.veredicto analisis.confianza analisis.recomendacion metricas.gamas.cortes metricas.gamas.gamas.clave metricas.gamas.gamas.nombre metricas.gamas.gamas.publicaciones metricas.gamas.gamas.ventaHoyDia metricas.gamas.gamas.ventaHoyTop3Dia').lean(),
    DiaProductoMl.find({ itemId: { $in: propios.map((p) => p.itemId) } }).select('itemId dia unidades visitas precio logistica cambioLogistica stockFraccion').lean(),
  ])
  const diasPorItem = new Map()
  for (const d of dias) diasPorItem.set(d.itemId, [...(diasPorItem.get(d.itemId) ?? []), d])

  // Lo que deja una venta sale del plan de campañas (comisión y envío medidos);
  // y las ventas por reseña, de la calibración. Si alguno falla, la pieza sigue.
  const dejaPorItem = new Map()
  if (conEconomia) try {
    const { planesDeCampana } = await import('./planCampanas.js')
    for (const p of (await planesDeCampana({ ahora })).productos ?? []) if (finito(p.economia?.deja) && p.economia.costo != null) dejaPorItem.set(p.itemId, p.economia.deja)
  } catch (err) { console.warn('[ml] recomendado vs vendido sin economía:', err.message) }
  let ventasPorResenia = VENTAS_POR_RESENIA_BASE
  try {
    const { calibracionResenias } = await import('./calibracionResenias.js')
    const medido = (await calibracionResenias({ ahora })).propiosAgrupado?.ventasPorResenia
    if (medido > 0) ventasPorResenia = medido
  } catch (err) { console.warn('[ml] recomendado vs vendido sin calibración:', err.message) }

  const grupos = nichos.flatMap((nicho) => cruzarNicho({
    nicho, propios: propios.filter((p) => String(p.nichoId) === String(nicho._id)),
    reportes: reportes.filter((r) => String(r.nichoId) === String(nicho._id)), diasPorItem, dejaPorItem, ventasPorResenia,
  })).sort((a, b) => b.real.unidades - a.real.unidades)

  const dia = ahora.toISOString().slice(0, 10)
  if (guardar && grupos.length) {
    await CruceRecomendacion.bulkWrite(grupos.map((g) => ({ updateOne: { filter: { clave: g.clave, dia }, upsert: true,
      update: { $set: { keyword: g.keyword, veredicto: g.decision?.veredicto ?? null, estado: g.estado, diasConStock: g.real.diasConStock, unidades: g.real.unidades,
        ventaDia: g.real.ventaDia, esperadoDia: g.esperado.ventaDia, ratio: g.ratio, acierto: g.acierto } } } })))
  }
  const historia = await CruceRecomendacion.find({ clave: { $in: grupos.map((g) => g.clave) } }).select('-_id clave dia ratio diasConStock').sort({ dia: 1 }).lean()
  for (const g of grupos) g.historia = historia.filter((h) => h.clave === g.clave).slice(-60).map(({ clave, ...h }) => h)
  return { modo: 'sombra', usaParaDecidir: false, calculadoEl: ahora, resumen: resumenCruce(grupos), grupos }
}
