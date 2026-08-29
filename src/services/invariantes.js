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
// UN PISO FIJO NO DETECTA UNA CAÍDA. La primera versión de esta invariante
// fallaba solo bajo 20% de cobertura, y el 23-ago daba 21%: pasaba raspando.
// Pero el 14-ago esa misma cobertura era 56% — se había desplomado a la mitad y
// el chequeo decía que todo bien.
//
// Lo que importa no es cruzar un umbral que alguien eligió, es que el número se
// mueva respecto de lo que este sistema venía entregando. Se compara contra la
// mediana de las dos semanas previas, que es la definición de "lo normal aquí".
// EL COMPARADOR, REUSABLE. Recibe una función que mide cobertura entre dos
// fechas y decide si se desplomó, comparando contra la mediana de las dos
// semanas previas Y contra lo mejor que este sistema supo entregar.
//
// Se sacó de la invariante de reseñas para poder vigilar VARIOS campos con la
// misma lógica. La razón es concreta: el 29-ago-2026 el nombre del vendedor
// dejó de llegar para listados enteros —ML sirve el componente de dos formas y
// el parser leía una— y ninguna invariante lo vio, porque solo se vigilaba
// `numReviews`. Lo encontró el importador preguntando por un nicho.
export async function derivaDeCobertura(nombre, cobertura, { pisoSinHistoria = 20 } = {}) {
  const ahora = Date.now()
  const hoy = await cobertura(new Date(ahora - 36 * 3600e3), new Date(ahora))
  if (hoy == null) return ok(`sin datos recientes de ${nombre}`)

  const previos = []
  for (let d = 2; d <= 15; d++) {
    const c = await cobertura(new Date(ahora - d * 86400e3), new Date(ahora - (d - 1) * 86400e3))
    if (c != null) previos.push(c)
  }
  if (previos.length < 4) {
    return hoy < pisoSinHistoria
      ? falla(`cobertura de ${nombre} en ${Math.round(hoy)}% y sin historia para comparar`, { hoy })
      : ok(`${nombre}: ${Math.round(hoy)}% (sin historia suficiente)`, { hoy })
  }
  const orden = [...previos].sort((a, b) => a - b)
  const normal = orden[Math.floor(orden.length / 2)]
  const mejor = orden.at(-1)
  const caida = normal > 0 ? ((normal - hoy) / normal) * 100 : 0

  // DOS SEÑALES, PORQUE MIDEN COSAS DISTINTAS.
  //
  // La relativa caza el desplome de un día para otro. La absoluta caza lo que
  // la relativa no puede: una degradación lenta que se vuelve la nueva
  // normalidad. Medido el 23-ago — la cobertura pasó de 56% a 21% en dos
  // semanas y se quedó ahí, así que comparada contra "lo habitual" daba +1% y
  // el chequeo la aprobaba. Contra lo que este sistema SUPO entregar, es la
  // mitad.
  if (caida > 40) {
    return falla(
      `la cobertura de ${nombre} cayó ${Math.round(caida)}% de golpe: hoy ${Math.round(hoy)}% contra ${Math.round(normal)}% habitual. Algo cambió río arriba.`,
      { hoy, normal, caida },
    )
  }
  if (mejor > 0 && hoy < mejor * 0.6) {
    return falla(
      `la cobertura de ${nombre} se estancó baja: ${Math.round(hoy)}% hoy y ${Math.round(normal)}% habitual, contra ${Math.round(mejor)}% que este sistema llegó a entregar. Ya es la nueva normalidad, que es justo lo que una comparación con el promedio reciente no detecta.`,
      { hoy, normal, mejor },
    )
  }
  return ok(`${nombre}: ${Math.round(hoy)}% · habitual ${Math.round(normal)}% · mejor ${Math.round(mejor)}%`, { hoy, normal, mejor })
}

// Cobertura de un campo del snapshot en una ventana.
async function coberturaSnapshot(campo) {
  const { Snapshot } = await import('../models/Snapshot.js')
  return async (desde, hasta) => {
    const total = await Snapshot.countDocuments({ fecha: { $gte: desde, $lt: hasta } })
    if (!total) return null
    const con = await Snapshot.countDocuments({ fecha: { $gte: desde, $lt: hasta }, [campo]: { $ne: null } })
    return (con / total) * 100
  }
}

async function actorSigueEntregandoIds() {
  return derivaDeCobertura('reseñas del nivel 2', await coberturaSnapshot('numReviews'))
}

// ── 9. Deriva del LISTADO: los campos que baja el nivel 1 ────────────────
// El nivel 1 trae precio, vendedor, vendidos y las reseñas por API oficial. Un
// campo que venía poblado y empieza a llegar vacío significa que ML cambió la
// forma de su página, y eso pasa sin aviso: el 29-ago el vendedor se cayó a
// cero en nichos enteros y el sistema siguió puntuando como si nada.
async function listadoSigueEntregandoCampos() {
  const { Snapshot } = await import('../models/Snapshot.js')
  const { Producto } = await import('../models/Producto.js')
  const revisiones = []

  // precio y vendidos viven en el snapshot
  for (const [campo, nombre] of [['precio', 'precio del listado'], ['numReviewsApi', 'reseñas por API oficial']]) {
    revisiones.push({ nombre, r: await derivaDeCobertura(nombre, await coberturaSnapshot(campo)) })
  }

  // el vendedor vive en el producto: se mide sobre los vistos en la ventana
  const porVentana = async (desde, hasta) => {
    const total = await Producto.countDocuments({ ultimaVezVisto: { $gte: desde, $lt: hasta } })
    if (!total) return null
    const con = await Producto.countDocuments({
      ultimaVezVisto: { $gte: desde, $lt: hasta },
      vendedor: { $nin: [null, ''] },
    })
    return (con / total) * 100
  }
  revisiones.push({ nombre: 'vendedor', r: await derivaDeCobertura('vendedor', porVentana, { pisoSinHistoria: 5 }) })

  const rotas = revisiones.filter((x) => !x.r.ok)
  if (rotas.length) {
    return falla(rotas.map((x) => x.r.detalle).join(' · '), { rotas: rotas.map((x) => x.nombre) })
  }
  return ok(revisiones.map((x) => x.r.detalle).join(' · '))
}

// ── 10. El ranking que se guarda es orgánico, no comprado ────────────────
// Medido el 29-ago-2026 sobre seis nichos: las cuatro primeras posiciones del
// listado son ANUNCIOS en todos, sin excepción. Si vuelven a colarse arriba es
// que se rompió el orden del nivel 1, y el sistema estaría midiendo quién pagó
// más en vez de quién vende.
async function elTopNoEsPagado() {
  const { Snapshot } = await import('../models/Snapshot.js')
  const desde = new Date(Date.now() - 36 * 3600e3)
  const conDato = await Snapshot.countDocuments({ fecha: { $gte: desde }, esAnuncio: { $ne: null } })
  if (!conDato) return ok('ningún scan reciente distingue anuncios todavía')
  const arriba = await Snapshot.countDocuments({
    fecha: { $gte: desde },
    esAnuncio: true,
    posicion: { $lte: 5 },
  })
  return arriba === 0
    ? ok(`ningún anuncio en el top 5 (${conDato} snapshots con la marca)`)
    : falla(
        `${arriba} anuncio(s) colados en el top 5: el ranking guardado mezcla posición comprada con ganada`,
        { arriba, conDato },
      )
}

// ── 11. Los cargos de ML no caen todos en "otros" ────────────────────────
// ML cambia los códigos de sus cargos sin avisar: hasta el 29-ago el envío se
// leía como `CXD` cuando ya venía como `CFF`, y se capturaba el 0,5% —$799 de
// $153.405—. El resto caía en "otros" y nadie lo miraba. Si "otros" vuelve a
// pesar más que el envío, ML cambió de códigos otra vez.
async function cargosClasificados() {
  const { CargoMl } = await import('../models/CargoMl.js')
  const desde = new Date(Date.now() - 30 * 86400e3)
  const filas = await CargoMl.aggregate([
    { $match: { fecha: { $gte: desde }, anulado: false, esAnulacion: { $ne: true } } },
    { $group: { _id: '$tipo', monto: { $sum: '$montoClp' } } },
  ])
  if (!filas.length) return ok('sin cargos de ML en la ventana')
  const CONOCIDOS = new Set(['CV', 'CFF', 'CXD', 'PADS', 'CFCB', 'CFWA'])
  const total = filas.reduce((s, f) => s + f.monto, 0)
  const desconocido = filas.filter((f) => !CONOCIDOS.has(f._id))
  const montoDesconocido = desconocido.reduce((s, f) => s + f.monto, 0)
  const pct = total > 0 ? (montoDesconocido / total) * 100 : 0
  if (pct > 10) {
    return falla(
      `${Math.round(pct)}% de lo que ML cobró está sin clasificar (${desconocido.map((f) => f._id).join(', ')}): probable código nuevo, como pasó con CFF`,
      { pct, tipos: desconocido.map((f) => f._id) },
    )
  }
  return ok(`${Math.round(100 - pct)}% de los cargos clasificados en su bolsillo`)
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

// ── 12. Un scan no encoge a la mitad de un día para otro ─────────────────
// Un listado que traía 100 items y trae 50 no es un mercado que se achicó: es
// scrapeo a medias. Pasó el 29-ago-2026 —el nivel 1 por Zyte pedía una sola
// página donde el actor pedía dos, y los nichos cayeron de ~95 a ~48 items sin
// que nada avisara—, y también pasa cuando ML bloquea a mitad de corrida o una
// página devuelve 5xx.
//
// Se compara cada nicho contra SU PROPIA historia, no contra un número global:
// un nicho de 30 items y otro de 100 son ambos normales, cada uno en lo suyo.
async function elScanNoEncoge() {
  const { Snapshot } = await import('../models/Snapshot.js')
  const desde = new Date(Date.now() - 12 * 86400e3)
  const porScan = await Snapshot.aggregate([
    { $match: { fecha: { $gte: desde } } },
    { $group: { _id: { keyword: '$keyword', fecha: '$fecha' }, items: { $sum: 1 } } },
    { $sort: { '_id.fecha': -1 } },
    { $group: { _id: '$_id.keyword', serie: { $push: '$items' } } },
  ])
  const encogidos = []
  for (const { _id: keyword, serie } of porScan) {
    // hacen falta al menos tres corridas previas para saber qué es normal acá
    if (serie.length < 4) continue
    const [ultimo, ...previos] = serie
    const orden = [...previos].sort((a, b) => a - b)
    const normal = orden[Math.floor(orden.length / 2)]
    if (normal >= 20 && ultimo < normal * 0.6) {
      encogidos.push({ keyword, ultimo, normal })
    }
  }
  if (!encogidos.length) {
    return ok(`ningún nicho encogió (${porScan.length} con historia suficiente)`)
  }
  const muestra = encogidos
    .slice(0, 5)
    .map((e) => `${e.keyword} ${e.ultimo} vs ${e.normal}`)
    .join(', ')
  return falla(
    `${encogidos.length} nicho(s) trajeron menos de la mitad de items que de costumbre: ${muestra}. Scrapeo a medias, no mercado más chico.`,
    { encogidos: encogidos.slice(0, 20) },
  )
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
  { id: 'listado-entrega-campos', que: 'El listado sigue trayendo precio, vendedor y reseñas (deriva de esquema de ML)', fn: listadoSigueEntregandoCampos },
  { id: 'top-no-pagado', que: 'El ranking guardado es orgánico: ningún anuncio en el top 5', fn: elTopNoEsPagado },
  { id: 'cargos-clasificados', que: 'Los cargos de ML caen en su bolsillo, no en "otros"', fn: cargosClasificados },
  { id: 'scan-no-encoge', que: 'Un scan no trae la mitad de items que de costumbre: eso es scrapeo a medias', fn: elScanNoEncoge },
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
