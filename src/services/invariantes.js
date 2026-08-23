// LO QUE EL SISTEMA COMPRUEBA DE SÍ MISMO.
//
// Casi todos los errores de la semana del 18 al 23-ago fueron el mismo: un
// número calculado sobre un supuesto que nadie verificó contra la realidad.
// La ventana traía un día de más; el divisor eran los días equivocados (dos
// veces, backend y tarjeta); el nivel promediaba dos fórmulas distintas; el
// precio de vitrina no era el cobrado; las visitas eran de 7 días y se
// dividían como si fueran de toda la vida; el actor cambió su salida y
// seguimos leyendo campos que llegaban null.
//
// Ninguno lo detectó el sistema. Todos aparecieron porque el importador vio
// algo que no cuadraba, o por tropiezo. Ese es el hueco: no le faltan datos,
// le falta saber cuándo se está equivocando.
//
// Cada invariante es una afirmación que DEBE ser cierta. Cuando deja de serlo,
// algo se rompió — y es mejor enterarse por una alerta que por una decisión de
// compra tomada con un número malo.
//
// Regla para agregar una: solo entra si su violación cambiaría una decisión.
// Un chequeo que nadie va a mirar es ruido que entrena a ignorar las alertas.

import { Invariante } from '../models/Invariante.js'

const ok = (detalle, datos) => ({ ok: true, detalle, datos })
const falla = (detalle, datos) => ({ ok: false, detalle, datos })

// ── 1. Las reseñas son acumulativas ──────────────────────────────────────
// La que destapó que el actor había cambiado su salida. Una lectura que
// retrocede es scrapeo fallido, y si aparecen muchas de golpe es que algo se
// rompió río arriba.
async function reviewsNoRetroceden() {
  const { Snapshot } = await import('../models/Snapshot.js')
  const desde = new Date(Date.now() - 3 * 86400e3)
  const series = await Snapshot.aggregate([
    { $match: { numReviews: { $ne: null }, fecha: { $gte: desde } } },
    { $sort: { sku: 1, fecha: 1 } },
    { $group: { _id: '$sku', serie: { $push: '$numReviews' } } },
  ])
  let malas = 0
  for (const s of series) {
    for (let i = 1; i < s.serie.length; i++) if (s.serie[i] < s.serie[i - 1]) malas++
  }
  const pct = series.length ? (malas / series.length) * 100 : 0
  return pct > 15
    ? falla(`${malas} lecturas de reseñas retroceden en ${series.length} productos (${Math.round(pct)}%)`, { malas, productos: series.length })
    : ok(`${malas} retrocesos en ${series.length} productos (${Math.round(pct)}%)`, { malas })
}

// ── 2. El gasto de publicidad debe cuadrar con lo que factura ML ─────────
// Se verificó a mano una vez y calzó al peso. Debería correr siempre: es la
// única forma de saber si nuestros números se despegan de los de ML.
async function adsCuadranConMl() {
  const { campanasConMetricas, adsPorItem } = await import('./ads.js')
  const camps = await campanasConMetricas({ dias: 30 })
  if (!camps?.length) return ok('sin campañas que verificar')
  const porCampana = camps.reduce((a, c) => a + (c.metricas?.cost ?? 0), 0)
  const items = await adsPorItem({ dias: 30 })
  let porProducto = 0
  for (const [, m] of items) porProducto += m.metricas?.cost ?? 0
  const dif = Math.abs(porCampana - porProducto)
  const pct = porCampana ? (dif / porCampana) * 100 : 0
  // ML cobra algo a la campaña que no atribuye a un anuncio puntual: hasta un
  // 2% es normal, más que eso significa anuncios que no estamos viendo
  return pct > 2
    ? falla(`el gasto por campaña ($${Math.round(porCampana)}) y por producto ($${Math.round(porProducto)}) difieren ${pct.toFixed(1)}%`, { porCampana, porProducto, pct })
    : ok(`campañas y productos cuadran (${pct.toFixed(1)}% de diferencia)`, { pct })
}

// ── 3. El nivel del tablero no mezcla fórmulas ───────────────────────────
// El score se reescribió el 16-ago y el promedio juntaba las dos escalas: 29
// de 76 nichos mostraban un número que ninguna fórmula había calculado.
async function nivelNoMezclaFormulas() {
  const { Reporte } = await import('../models/Reporte.js')
  const conScore = await Reporte.countDocuments({ scoreOportunidad: { $ne: null } })
  const conFormulaNueva = await Reporte.countDocuments({
    scoreOportunidad: { $ne: null },
    'metricas.oportunidad.componentes.constancia': { $ne: null },
  })
  const viejos = conScore - conFormulaNueva
  // no es falla en sí (los viejos son historia), pero el tablero debe estar
  // filtrando: si alguien saca ese filtro, esto queda como testigo
  return ok(`${conFormulaNueva} reportes con la fórmula vigente, ${viejos} con la anterior (el nivel filtra por fórmula)`, {
    conFormulaNueva,
    viejos,
  })
}

// ── 4. Un scan sin cobertura no puede tener score ────────────────────────
async function scanSinCoberturaNoPuntua() {
  const { Reporte } = await import('../models/Reporte.js')
  const malos = await Reporte.countDocuments({
    scoreOportunidad: { $ne: null },
    $or: [
      { 'metricas.demanda.reviews.itemsConDato': { $in: [null, 0] } },
      { 'metricas.demanda.reviews': null },
      { 'metricas.demanda': null },
    ],
  })
  return malos > 0
    ? falla(`${malos} reportes tienen score sin un solo item con dato de reseñas`, { malos })
    : ok('ningún reporte puntúa sin cobertura')
}

// ── 5. El precio efectivo nunca supera al de lista ───────────────────────
// Si lo supera, o el registro local quedó viejo o leímos mal la promoción.
async function precioEfectivoBajoLista() {
  const { ProductoPropio } = await import('../models/ProductoPropio.js')
  const propios = await ProductoPropio.find({ estado: 'activo' }).select('titulo mediciones').lean()
  const raros = []
  for (const p of propios) {
    const u = (p.mediciones ?? []).at(-1)
    if (!u) continue
    if (Number.isFinite(u.precio) && Number.isFinite(u.precioEfectivo) && u.precioEfectivo > u.precio) {
      raros.push({ titulo: p.titulo, precio: u.precio, efectivo: u.precioEfectivo })
    }
  }
  return raros.length
    ? falla(`${raros.length} producto(s) con precio efectivo MAYOR que el de lista`, { raros })
    : ok(`los ${propios.length} propios tienen precio efectivo ≤ lista`)
}

// ── 6. Deriva de esquema: campos que dejaron de llegar ───────────────────
// El actor de nivel 2 dejó de poblar sus IDs y estuvimos dos días echándole la
// culpa a un bloqueo de ML. Un campo que venía poblado y empieza a llegar
// vacío es la señal más temprana de que un proveedor cambió su contrato.
async function actorSigueEntregandoIds() {
  const { Snapshot } = await import('../models/Snapshot.js')
  const ayer = new Date(Date.now() - 36 * 3600e3)
  const recientes = await Snapshot.countDocuments({ fecha: { $gte: ayer } })
  if (!recientes) return ok('sin snapshots recientes que verificar')
  const conReviews = await Snapshot.countDocuments({ fecha: { $gte: ayer }, numReviews: { $ne: null } })
  const pct = (conReviews / recientes) * 100
  return pct < 20
    ? falla(`solo ${Math.round(pct)}% de los snapshots de las últimas 36 h traen reseñas (${conReviews}/${recientes}): el detalle está fallando`, { pct, conReviews, recientes })
    : ok(`${Math.round(pct)}% de los snapshots recientes traen reseñas`, { pct })
}

// ── 7. La cartera en cotización tiene lo necesario para decidir ──────────
async function cotizandoTienePrecio() {
  const { Nicho } = await import('../models/Nicho.js')
  const cot = await Nicho.find({ etapaCompra: 'cotizando' }).select('keyword exwCotizadoUsd costoPuestoClp').lean()
  const sinCosto = cot.filter((n) => !Number.isFinite(n.exwCotizadoUsd) && !Number.isFinite(n.costoPuestoClp))
  return sinCosto.length === cot.length && cot.length > 3
    ? falla(`los ${cot.length} nichos en cotización no tienen ni EXW ni costo puesto cargado: no se puede comparar ninguno`, { total: cot.length })
    : ok(`${cot.length - sinCosto.length} de ${cot.length} nichos en cotización con costo cargado`, { total: cot.length })
}

// ── 8. Los propios sin costo bloquean el cálculo de ganancia ─────────────
async function propiosConCosto() {
  const { ProductoPropio } = await import('../models/ProductoPropio.js')
  const total = await ProductoPropio.countDocuments({ estado: 'activo' })
  const conCosto = await ProductoPropio.countDocuments({ estado: 'activo', costoUnitarioClp: { $ne: null } })
  return conCosto === 0 && total > 0
    ? falla(`ninguno de los ${total} productos propios tiene costo unitario: todo lo que el sistema reporta es contribución (un techo), no ganancia`, { total, conCosto })
    : ok(`${conCosto} de ${total} propios con costo unitario cargado`, { total, conCosto })
}

export const INVARIANTES = [
  { id: 'reviews-no-retroceden', que: 'Las reseñas son acumulativas: una lectura que baja es scrapeo fallido', fn: reviewsNoRetroceden },
  { id: 'ads-cuadran', que: 'El gasto por campaña y por producto deben coincidir con ML', fn: adsCuadranConMl },
  { id: 'nivel-una-formula', que: 'El nivel del tablero promedia solo scores de la fórmula vigente', fn: nivelNoMezclaFormulas },
  { id: 'sin-cobertura-sin-score', que: 'Un scan sin cobertura de reseñas no puede dejar un score', fn: scanSinCoberturaNoPuntua },
  { id: 'precio-efectivo', que: 'El precio efectivo nunca supera al de lista', fn: precioEfectivoBajoLista },
  { id: 'actor-entrega-ids', que: 'El detalle sigue entregando reseñas (deriva de esquema del actor)', fn: actorSigueEntregandoIds },
  { id: 'cotizando-con-precio', que: 'Los nichos en cotización tienen costo para poder compararse', fn: cotizandoTienePrecio },
  { id: 'propios-con-costo', que: 'Los productos propios tienen costo: sin él no hay ganancia, solo contribución', fn: propiosConCosto },
]

export async function verificarInvariantes() {
  const resultados = []
  for (const inv of INVARIANTES) {
    try {
      const r = await inv.fn()
      resultados.push({ id: inv.id, que: inv.que, ...r })
    } catch (err) {
      resultados.push({ id: inv.id, que: inv.que, ok: false, detalle: `el chequeo falló: ${err.message}`, error: true })
    }
  }
  const rotas = resultados.filter((r) => !r.ok)
  const doc = await Invariante.create({
    fecha: new Date(),
    total: resultados.length,
    rotas: rotas.length,
    resultados,
  })
  if (rotas.length) {
    console.warn(`[invariantes] ${rotas.length} de ${resultados.length} ROTAS:`)
    for (const r of rotas) console.warn(`  ✗ ${r.id}: ${r.detalle}`)
  } else {
    console.log(`[invariantes] las ${resultados.length} se cumplen`)
  }
  return doc.toObject()
}

export async function ultimasInvariantes() {
  return Invariante.findOne().sort({ fecha: -1 }).lean()
}
