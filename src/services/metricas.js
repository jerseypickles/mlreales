import { Producto } from '../models/Producto.js'
import { Snapshot } from '../models/Snapshot.js'
import { scoring } from '../config/scoring.js'

export function percentil(valoresOrdenados, p) {
  const n = valoresOrdenados.length
  if (!n) return null
  if (n === 1) return valoresOrdenados[0]
  const idx = (p / 100) * (n - 1)
  const abajo = Math.floor(idx)
  const arriba = Math.ceil(idx)
  if (abajo === arriba) return valoresOrdenados[abajo]
  return valoresOrdenados[abajo] + (valoresOrdenados[arriba] - valoresOrdenados[abajo]) * (idx - abajo)
}

function redondear(n, decimales = 1) {
  if (!Number.isFinite(n)) return null
  const factor = 10 ** decimales
  return Math.round(n * factor) / factor
}

// Banda de precio con más items. Ancho de bin por Freedman-Diaconis (robusto a
// outliers, frecuentes en listados de ML donde conviven accesorios y producto principal).
function bandaDominante(preciosOrdenados) {
  const n = preciosOrdenados.length
  if (!n) return null
  const min = preciosOrdenados[0]
  const max = preciosOrdenados[n - 1]
  if (min === max) return { desde: min, hasta: max, cantidad: n, pctItems: 100 }

  const iqr = percentil(preciosOrdenados, 75) - percentil(preciosOrdenados, 25)
  const anchoIdeal = iqr > 0 ? (2 * iqr) / Math.cbrt(n) : (max - min) / Math.min(8, n)
  const numBins = Math.min(30, Math.max(1, Math.ceil((max - min) / anchoIdeal)))
  const ancho = (max - min) / numBins

  const cuentas = new Array(numBins).fill(0)
  for (const precio of preciosOrdenados) {
    cuentas[Math.min(numBins - 1, Math.floor((precio - min) / ancho))]++
  }
  let mejor = 0
  for (let i = 1; i < numBins; i++) if (cuentas[i] > cuentas[mejor]) mejor = i

  return {
    desde: Math.round(min + mejor * ancho),
    hasta: Math.round(min + (mejor + 1) * ancho),
    cantidad: cuentas[mejor],
    pctItems: redondear((cuentas[mejor] / n) * 100),
  }
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

// Serie de un campo numérico con delta entre el scan actual y el anterior.
// depurar (solo reseñas): filtra los artefactos de los agregados de catálogo
// — saltos de nivel imposibles y conteos duplicados entre listings hermanos —
// que de otro modo se multiplican por el factor 25 (ver scoring.depuracionDelta).
function extraerSenal(snapshots, snapshotsPrevios, campo, { depurar = false } = {}) {
  const valores = snapshots.map((s) => s[campo]).filter(Number.isFinite)
  if (!valores.length) return null

  const orden = [...valores].sort((a, b) => a - b)
  // EL TOTAL TAMBIÉN VENÍA SUCIO. El delta se depura desde julio, pero el
  // acumulado se sumaba crudo — y ahí vive el mismo artefacto: los items de
  // CATÁLOGO muestran el agregado de todos los vendedores del producto, y dos
  // listings hermanos repiten el conteo idéntico. Medido en "lampara para
  // uñas": 94% de las 6.528 reseñas vienen de items de catálogo, y las dos
  // primeras filas eran el MISMO 1.293 contado dos veces.
  //
  // Importa porque el score usa este total (volumenVentasEstimado): iba
  // inflado por duplicados en todos los nichos con catálogo.
  let total = 0
  let duplicadosEnTotal = 0
  const vistos = new Set()
  for (const v of valores) {
    if (depurar && v >= scoring.depuracionDelta.dedupeMinConteo) {
      if (vistos.has(v)) {
        duplicadosEnTotal++
        continue
      }
      vistos.add(v)
    }
    total += v
  }

  const senal = {
    itemsConDato: valores.length,
    total,
    ...(duplicadosEnTotal ? { totalBruto: valores.reduce((a, b) => a + b, 0), duplicadosEnTotal } : {}),
    mediana: redondear(percentil(orden, 50), 0),
    delta: null, // requiere >= 2 scans con el dato
    periodoDias: null,
    porDia: null,
    itemsComparables: null,
  }

  if (snapshotsPrevios?.length) {
    const previosPorSku = new Map(
      snapshotsPrevios.filter((s) => Number.isFinite(s[campo])).map((s) => [s.sku, s]),
    )
    const pares = []
    let fechaPrevia = null
    for (const snap of snapshots) {
      const previo = previosPorSku.get(snap.sku)
      if (!previo || !Number.isFinite(snap[campo])) continue
      pares.push({ antes: previo[campo], ahora: snap[campo] })
      fechaPrevia = previo.fecha
    }
    if (pares.length && fechaPrevia) {
      const dias = Math.max(
        (new Date(snapshots[0].fecha) - new Date(fechaPrevia)) / 86_400_000,
        1 / 24, // piso de 1 hora para no dividir por ~0 en re-scans seguidos
      )
      const dep = depurar ? scoring.depuracionDelta : null
      const vistos = new Set()
      let delta = 0
      let deltaBruto = 0
      let saltosFiltrados = 0
      let duplicadosCatalogo = 0
      for (const { antes, ahora } of pares) {
        const d = Math.max(0, ahora - antes)
        deltaBruto += d
        if (dep && d > 0 && antes >= dep.dedupeMinConteo) {
          const clave = `${antes}→${ahora}`
          if (vistos.has(clave)) {
            duplicadosCatalogo++
            continue
          }
          vistos.add(clave)
        }
        if (dep && d > Math.max(dep.pisoPorDia, dep.maxPctDia * antes) * dias) {
          saltosFiltrados++
          continue
        }
        delta += d
      }
      senal.delta = delta
      senal.periodoDias = redondear(dias, 2)
      senal.itemsComparables = pares.length
      // una tasa por día exige una ventana de al menos un día: contra un scan de
      // hace una hora, delta 0 no es "no vende" (el piso serían ~600 ventas/día)
      // y delta 1 tampoco es "vende 600" — en ambos casos la ventana no resuelve
      if (dias >= scoring.depuracionDelta.ventanaMinTasaDias) {
        senal.porDia = redondear(delta / dias, 1)
      } else {
        senal.porDia = null
        senal.ventanaInsuficiente = true
      }
      if (saltosFiltrados || duplicadosCatalogo) {
        senal.deltaBruto = deltaBruto
        senal.saltosFiltrados = saltosFiltrados
        senal.duplicadosCatalogo = duplicadosCatalogo
      }
    }
  }

  return senal
}

// Segundo proxy de demanda: preguntas NUEVAS de compradores entre dos scans.
// Los ids de pregunta son únicos globales → el set deduplica solo los listings
// hermanos que comparten catálogo; la lista visible es acotada, así que el
// resultado es un PISO ("al menos N preguntas nuevas"), inmune a los saltos
// de agregado que ensucian las reseñas. Sirve de contraste: reseñas volando
// con cero preguntas nuevas = sospecha.
function extraerSenalPreguntas(snapshots, snapshotsPrevios) {
  const conIds = snapshots.filter((s) => Array.isArray(s.preguntasIds) && s.preguntasIds.length)
  if (!conIds.length || !snapshotsPrevios?.length) return null
  const previosPorSku = new Map(
    snapshotsPrevios.filter((s) => Array.isArray(s.preguntasIds)).map((s) => [s.sku, s]),
  )
  const nuevas = new Set()
  let comparables = 0
  let fechaPrevia = null
  for (const snap of conIds) {
    const previo = previosPorSku.get(snap.sku)
    if (!previo) continue
    comparables++
    fechaPrevia = previo.fecha
    const idsPrevios = new Set(previo.preguntasIds)
    for (const id of snap.preguntasIds) if (!idsPrevios.has(id)) nuevas.add(id)
  }
  if (!comparables || !fechaPrevia) return null
  const dias = Math.max((new Date(snapshots[0].fecha) - new Date(fechaPrevia)) / 86_400_000, 1 / 24)
  const resuelve = dias >= scoring.depuracionDelta.ventanaMinTasaDias
  return {
    nuevas: nuevas.size,
    periodoDias: redondear(dias, 2),
    porDia: resuelve ? redondear(nuevas.size / dias, 1) : null,
    itemsComparables: comparables,
    ...(resuelve ? {} : { ventanaInsuficiente: true }),
  }
}

// Demanda del nicho. ML no expone vendidos exactos (buckets congelados), así que la
// señal continua es el conteo de reseñas (exacto, se mueve a diario): delta de
// EL BADGE "+N VENDIDOS" QUE ML PUBLICA EN EL LISTADO.
//
// Estuvo descartado en el normalizador desde el inicio ("Fase 2") aunque el
// actor de nivel 1 ya lo traía. Sondeado el 14-ago en 5 nichos: cobertura de
// 65% a 100% (pastillas de freno 48/48, toallitas 47/48, hidrolavadora 44/48,
// brochas 39/48, árbol de navidad 31/48) — bastante mejor que las reseñas, que
// dependen del detalle de nivel 2 y en "lampara para uñas" llegaron a 30 de 96.
//
// PERO SON BALDES. En 66 items sondeados aparecen 7 valores distintos y nada
// más: 25, 50, 100, 500, 1.000, 5.000, 10.000. Cero valores no redondos. Es el
// badge público, acumulado de toda la vida del listing, no una tasa.
//
// De ahí las dos reglas:
//   1. NO se le saca delta ni por-día. Cruzar de balde no es una venta, es un
//      umbral — un listing puede pasar de "+100" a "+500" en un día o en un año.
//   2. NO alimenta el score. Sirve para lo que sí resuelve: comparar el TAMAÑO
//      histórico entre nichos, donde la diferencia es de órdenes de magnitud
//      (toallitas 543.700 contra pastillas de freno 3.150) y el redondeo grueso
//      no alcanza a confundir nada.
//
// Y como cada balde dice "+N", la suma es un PISO medido, no una estimación:
// el top vendió al menos eso.
//
// LA COBERTURA ES EL DATO, NO EL MARGEN DE ERROR. El balde más chico que
// existe es 25 y NUNCA aparece uno menor (209 items sondeados, cero por
// debajo): ML solo muestra el badge cuando la publicación cruzó esas 25
// unidades. Entonces pctCobertura no es "cuánto alcancé a medir" sino
// CUÁNTO DEL TOP HA VENDIDO ALGUNA VEZ 25 UNIDADES.
//
// Comprobado sobre los 47 nichos de la mesa: la cobertura correlaciona 0,75
// con el piso (log) y ordena una escalera que un hueco de scraping no podría
// producir — cobertura <40% ⇒ balde máximo mediano 1.000; cobertura >90% ⇒
// balde máximo mediano 10.000. Un top con 28% de cobertura no está mal
// medido: tiene 72% de publicaciones que nunca vendieron 25 unidades.
function senalVendidos(snapshots) {
  const valores = snapshots.map((s) => s.vendidos).filter(Number.isFinite)
  if (!valores.length) return null
  const orden = [...valores].sort((a, b) => a - b)
  return {
    pisoUnidades: valores.reduce((a, b) => a + b, 0),
    itemsConDato: valores.length,
    itemsDelScan: snapshots.length,
    pctCobertura: redondear((valores.length / snapshots.length) * 100, 0),
    medianaPorItem: redondear(percentil(orden, 50), 0),
    maximoPorItem: orden.at(-1),
    // A DIFERENCIA DE LAS RESEÑAS, ACÁ NO SE DEDUPLICA POR VALOR REPETIDO.
    // Allá dos filas con 1.293 son el mismo agregado de catálogo contado dos
    // veces. Acá dos filas con "+50" son dos vendedores distintos que cayeron
    // en el mismo balde grueso — borrarlas sería borrar competencia real.
    // (En pastillas de freno los 48 items caben en 3 baldes; deduplicar
    // dejaría 3 filas de 48.)
  }
}

// PROFUNDIDAD DE STOCK DEL TOP — cuánto le queda a la competencia.
//
// ML pone "últimas N unidades" en el listado cuando al vendedor le quedan 5 o
// menos (medido en 240 items: los valores van de 1 a 5 y nunca más). Igual que
// con el badge de vendidos, la AUSENCIA es información: significa "más de 5",
// no "sin dato". Así que pctEnUltimas se lee limpio como "qué parte del top
// está por agotarse".
//
// Lo que destapó al medirlo: pastillas de freno tenía 32 de 48 publicaciones
// en últimas unidades y 97 unidades visibles en toda su primera plana, contra
// 2 de 48 en toallitas húmedas. No es un nicho chico — es uno desabastecido, y
// eso para un importador es lo contrario de un problema.
//
// unidadesVisibles suma SOLO los que muestran el badge. No es el stock del
// nicho ni un piso de él: de los que no lo muestran no sabemos nada salvo que
// tienen más de 5. Jamás presentarlo como "el nicho tiene N unidades".
function profundidadStock(snapshots) {
  const conBadge = snapshots.filter((s) => Number.isFinite(s.unidadesRestantes))
  if (!snapshots.length) return null
  return {
    itemsPorAgotarse: conBadge.length,
    itemsDelScan: snapshots.length,
    pctEnUltimas: redondear((conBadge.length / snapshots.length) * 100, 0),
    unidadesVisibles: conBadge.reduce((a, s) => a + s.unidadesRestantes, 0),
    // sello propio de ML sobre el listado; "MÁS VENDIDO" es el que interesa
    masVendidos: snapshots.filter((s) => s.selloMl === 'MÁS VENDIDO').length,
  }
}

// reseñas nuevas en la ventana: lo único que se cuenta de verdad.
export function calcularDemanda(
  snapshots,
  snapshotsPrevios = null,
  { minItems = scoring.umbrales.minItemsDemanda } = {},
) {
  const reviews = extraerSenal(snapshots, snapshotsPrevios, 'numReviews', { depurar: true })
  if (!reviews) return null

  // representatividad: si la señal sale de una muestra ínfima (detalle aplicado
  // a medias por bloqueo de ML), diría "demanda 0" con cara seria — sin score
  // el pipeline espera el reintento en vez de vender un número falso
  if (reviews.itemsConDato < minItems) return null

  return {
    // La base es SIEMPRE reseñas. `vendidos` existe desde el 14-ago pero es un
    // balde acumulado: no se le puede sacar delta ni tasa (ver senalVendidos).
    base: 'reviews',
    reviews,
    preguntas: extraerSenalPreguntas(snapshots, snapshotsPrevios),
    // NO HAY VENTAS ACÁ, Y NO LAS VA A HABER.
    //
    // Hasta el 13-ago esto publicaba `ventasEstimadasPorDia` = delta de reseñas
    // × 25 y `volumenVentasEstimado` = acumuladas × 25. Las dos son invento: el
    // factor nunca se calibró (la medición propia daba 18 con muestra de 3), el
    // acumulado está dominado por agregados de catálogo, y el conteo cubre una
    // fracción del listado — en "lampara para uñas", 30 de 96 items.
    //
    // Decisión del importador: las ventas de ML no se pueden medir desde
    // afuera y no se va a inventar un factor para fingir que sí. Lo que queda
    // es lo CONTADO: reseñas nuevas en la ventana, con su canasta y su
    // cobertura. La demanda del nicho se juzga con búsqueda real (Google) y
    // respaldo de Full (vendedores que inmovilizaron stock).
    resenasNuevasPorDia: reviews?.porDia ?? null,
    // CUÁNTO DEL LISTADO SE MIDIÓ. El conteo de reseñas solo llega en el
    // detalle de nivel 2, que corre sobre una fracción por presupuesto: en
    // "lampara para uñas" fueron 30 de 96 items. Sin este número, "6.528
    // reseñas" se lee como si describiera el nicho entero.
    coberturaReviews: reviews
      ? {
          itemsConDato: reviews.itemsConDato,
          itemsDelScan: snapshots.length,
          pct: redondear((reviews.itemsConDato / snapshots.length) * 100, 0),
        }
      : null,
    // resolución de la ventana: con esta cantidad de días, el delta más chico
    // que se puede ver es 1 reseña. Un 0 medido significa "no apareció ninguna
    // reseña nueva en la canasta", jamás "nadie compra".
    resolucionResenasDia:
      reviews?.periodoDias ? redondear(1 / reviews.periodoDias, 2) : null,
  }
}

// Score 0-100 según config/scoring.js. Devuelve null si aún no hay datos de demanda.
// `nivelBusqueda` descuenta confianza cuando la keyword medida no es la que la
// gente escribe: el listado analizado no es el que ve el comprador.
export function calcularScoreOportunidad({
  demanda,
  competencia,
  calidad,
  nivelBusqueda = null,
  busquedasMes = null,
}) {
  // LA DEMANDA SE MIDE, NO SE INVENTA.
  //
  // Hasta el 13-ago este componente era `reseñas acumuladas × 25`: un factor sin
  // calibrar, sobre un acumulado dominado por agregados de catálogo, contado en
  // una fracción del listado. Tres capas de invento apiladas.
  //
  // Ahora son dos mediciones directas: cuánta gente BUSCA eso en Chile (Google
  // Ads, absoluto y comparable entre nichos) y cuántos vendedores distintos
  // pusieron stock en FULL — que es capital ajeno inmovilizado, la evidencia
  // más dura de que el producto rota. Ninguna se multiplica por nada.
  if (!Number.isFinite(busquedasMes)) return null
  const { pesos, umbrales, escalas } = scoring

  const porBusqueda = clamp(escalas.demandaFactorLog * Math.log10(1 + busquedasMes), 0, 100)
  // el respaldo de Full sube la demanda hasta un tope: 20 vendedores con stock
  // inmovilizado dicen más que 2, pero no infinitamente más
  const conFull = competencia.sellersConFull ?? null
  const respaldo = Number.isFinite(conFull) ? clamp(conFull / escalas.sellersFullPlenos, 0, 1) : 0
  const componenteDemanda = clamp(porBusqueda * (1 + escalas.pesoRespaldoFull * respaldo), 0, 100)
  const componenteCompetencia = clamp(100 - (competencia.concentracionTop3Pct ?? 100), 0, 100)
  // misma filosofía que minItemsDemanda: con pocos productos calificados el
  // promedio no prueba nada (dos ratings 5.0 de 3 reseñas marcan "calidad 0"
  // falso) — mejor neutro que extremo con evidencia fina
  const rating = calidad.ratingPromedio
  const ratingsSuficientes = (calidad.itemsConRating ?? 0) >= (umbrales.minItemsCalidad ?? 0)
  const componenteCalidad =
    Number.isFinite(rating) && ratingsSuficientes
      ? clamp(
          ((umbrales.ratingDiferenciacion - rating) / (umbrales.ratingDiferenciacion - umbrales.ratingPiso)) * 100,
          0,
          100,
        )
      : 50 // sin ratings (o muy pocos): neutro
  const componenteFull = clamp(100 - (competencia.pctFull ?? 0), 0, 100)

  const bruto = Math.round(
    pesos.demanda * componenteDemanda +
      pesos.competencia * componenteCompetencia +
      pesos.calidad * componenteCalidad +
      pesos.full * componenteFull,
  )

  // un nicho que nadie busca puede sacar 82 y sentarse arriba de la lista: el
  // listado que midió no lo abre ningún comprador
  const confianza = scoring.confianzaBusqueda[nivelBusqueda?.nivel] ?? 1

  return {
    score: Math.round(bruto * confianza),
    // el bruto y el factor viajan solo cuando hubo descuento, para poder
    // auditar por qué este nicho bajó sin tener que re-medir nada
    ...(confianza < 1
      ? { scoreBruto: bruto, confianzaBusqueda: confianza, nivelBusqueda: nivelBusqueda?.nivel ?? null }
      : {}),
    componentes: {
      demanda: Math.round(componenteDemanda),
      competencia: Math.round(componenteCompetencia),
      calidad: Math.round(componenteCalidad),
      full: Math.round(componenteFull),
    },
  }
}

// Scorecard: precio + competencia + calidad sobre el top-N por posición;
// demanda y score si el nivel 2 ya aportó `vendidos`.
export function calcularMetricas({
  snapshots,
  productosPorSku,
  // volumen de búsqueda real del nicho: es el componente de demanda del score
  // desde que se eliminó el factor inventado (ver calcularScoreOportunidad)
  busquedasMes = null,
  totalResultados = null,
  topN = 50,
  snapshotsPrevios = null,
  nivelBusqueda = null,
}) {
  const top = [...snapshots]
    .sort((a, b) => (a.posicion ?? Infinity) - (b.posicion ?? Infinity))
    .slice(0, topN)
  const n = top.length

  const precios = top
    .map((s) => s.precio)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const descuentos = top.map((s) => s.descuentoPct).filter((d) => Number.isFinite(d) && d > 0)
  const ratings = top.map((s) => s.rating).filter(Number.isFinite)

  const cuentaPorVendedor = new Map()
  const infoVendedor = new Map() // reputación/power seller del nivel 2, primera vista
  let oficiales = 0
  let full = 0
  // VENDEDORES distintos con stock en Full: capital ajeno inmovilizado, que es
  // la evidencia más dura de que el producto rota. Cuenta gente, no listings.
  const vendedoresConFull = new Set()
  let conDatoFull = 0
  let rapido = 0
  let conVendedor = 0
  for (const snap of top) {
    const prod = productosPorSku.get(snap.sku)
    if (!prod) continue
    if (prod.esTiendaOficial) oficiales++
    // esFull null = el listado no mostró el flag: no cuenta ni a favor ni en
    // contra (mismo criterio que reviews null: sin medir ≠ cero)
    if (prod.esFull != null) {
      conDatoFull++
      if (prod.esFull) {
        full++
        if (prod.vendedor) vendedoresConFull.add(prod.vendedor)
      }
    }
    if (prod.envioRapido) rapido++
    if (prod.vendedor) {
      conVendedor++
      cuentaPorVendedor.set(prod.vendedor, (cuentaPorVendedor.get(prod.vendedor) ?? 0) + 1)
      if (!infoVendedor.has(prod.vendedor) && (prod.reputacionSeller || prod.powerSeller)) {
        infoVendedor.set(prod.vendedor, {
          reputacion: prod.reputacionSeller ?? null,
          powerSeller: prod.powerSeller ?? null,
        })
      }
    }
  }
  const vendedoresOrdenados = [...cuentaPorVendedor.entries()].sort((a, b) => b[1] - a[1])
  const itemsTop3 = vendedoresOrdenados.slice(0, 3).reduce((acum, [, cuenta]) => acum + cuenta, 0)

  const pct = (parte, total = n) => (total > 0 ? redondear((parte / total) * 100) : null)

  // COMPOSICIÓN DEL TOP por categoría real de ML: una keyword casi nunca trae
  // una sola familia — "partidor bateria" mezcla partidores con cargadores y
  // motores de partida, "saca puntos negros" mezcla pinzas con máquinas. Si el
  // top está mezclado, la mediana, el %Full y la demanda describen a Frankenstein
  // y no al producto que el importador quiere traer.
  const porCategoria = new Map()
  for (const snap of top) {
    const prod = productosPorSku.get(snap.sku)
    const ruta = prod?.categoriaRuta ?? null
    if (!ruta) continue
    const hoja = ruta.split(' > ').at(-1)
    const acc = porCategoria.get(hoja) ?? { items: 0, precios: [], ruta }
    acc.items++
    if (Number.isFinite(snap.precio)) acc.precios.push(snap.precio)
    porCategoria.set(hoja, acc)
  }
  const conCategoria = [...porCategoria.values()].reduce((s, c) => s + c.items, 0)
  const composicion = [...porCategoria.entries()]
    .map(([nombre, c]) => ({
      categoria: nombre,
      ruta: c.ruta,
      items: c.items,
      pctItems: conCategoria ? redondear((c.items / conCategoria) * 100) : null,
      medianaPrecio: c.precios.length ? redondear(percentil([...c.precios].sort((a, b) => a - b), 50), 0) : null,
    }))
    .sort((a, b) => b.items - a.items)
  const dominante = composicion[0] ?? null

  const competencia = {
    sellersUnicos: cuentaPorVendedor.size,
    // composición real del top y aviso de mezcla: si la familia dominante no
    // llega al 60%, las métricas globales del nicho hay que leerlas con pinzas
    composicionCategorias: composicion.length ? composicion.slice(0, 5) : undefined,
    categoriaDominantePct: dominante?.pctItems ?? null,
    topMezclado: dominante ? dominante.pctItems < 60 : null,
    pctTiendaOficial: pct(oficiales),
    concentracionTop3Pct: conVendedor > 0 ? redondear((itemsTop3 / conVendedor) * 100) : null,
    pctFull: conDatoFull > 0 ? pct(full, conDatoFull) : null,
    itemsConDatoFull: conDatoFull,
    sellersConFull: vendedoresConFull.size,
    // COMPETENCIA QUE IMPORTA DIRECTO. Antes solo lo sabía el nivel 2 sobre una
    // fracción del listado; desde el 15-ago el nivel 1 lo trae para el 100%.
    // Para un importador cambia la lectura del nicho: donde ya hay chinos
    // despachando directo, la ventaja de costo puesto se evapora.
    pctCrossBorder: pct(top.filter((s) => productosPorSku.get(s.sku)?.origenCrossBorder).length),
    origenesCrossBorder: (() => {
      const c = new Map()
      for (const s of top) {
        const o = productosPorSku.get(s.sku)?.origenEnvio
        if (o) c.set(o, (c.get(o) ?? 0) + 1)
      }
      return c.size ? Object.fromEntries([...c].sort((a, b) => b[1] - a[1])) : undefined
    })(),
    pctEnvioRapido: pct(rapido),
    topSellers: vendedoresOrdenados
      .slice(0, 5)
      .map(([vendedor, items]) => ({ vendedor, items, pctItems: pct(items), ...(infoVendedor.get(vendedor) ?? {}) })),
  }

  const calidad = {
    ratingPromedio: ratings.length
      ? redondear(ratings.reduce((a, b) => a + b, 0) / ratings.length, 2)
      : null,
    pctConRating: pct(ratings.length),
    itemsConRating: ratings.length,
  }

  const demanda = calcularDemanda(top, snapshotsPrevios)
  const oportunidad = calcularScoreOportunidad({ demanda, competencia, calidad, nivelBusqueda, busquedasMes })

  return {
    universo: {
      productosAnalizados: n,
      totalResultadosBusqueda: totalResultados?.total ?? null,
      totalEsMinimo: totalResultados?.esMinimo ?? null,
    },
    precio: {
      mediana: redondear(percentil(precios, 50), 2),
      p25: redondear(percentil(precios, 25), 2),
      p75: redondear(percentil(precios, 75), 2),
      min: precios[0] ?? null,
      max: precios.at(-1) ?? null,
      bandaDominante: bandaDominante(precios),
      descuentoPromedioPct: descuentos.length
        ? redondear(descuentos.reduce((a, b) => a + b, 0) / descuentos.length)
        : null,
      pctConDescuento: pct(descuentos.length),
    },
    competencia,
    calidad,
    // fuera de `demanda` a propósito: no es una tasa y no depende del nivel 2,
    // así que sobrevive aunque la demanda quede en null por poca cobertura
    vendidosHistoricos: senalVendidos(top),
    // cuánto le queda a la competencia: la otra cara del vendidosHistoricos
    profundidadStock: profundidadStock(top),
    demanda, // null mientras el detalle no traiga conteo de reseñas suficiente
    oportunidad, // { score, componentes } | null
    scoreOportunidad: oportunidad?.score ?? null,
  }
}

// Vista producto+snapshot del último scan (tabla del dashboard y análisis IA).
export async function obtenerProductosUltimoScan(nicho) {
  const ultimo = await Snapshot.findOne({ keyword: nicho.keyword }).sort({ fecha: -1 }).lean()
  if (!ultimo) return null

  const snapshots = await Snapshot.find({ keyword: nicho.keyword, fecha: ultimo.fecha })
    .sort({ posicion: 1 })
    .lean()
  const productos = await Producto.find({ sku: { $in: snapshots.map((s) => s.sku) } }).lean()
  const porSku = new Map(productos.map((p) => [p.sku, p]))

  // el nivel 2 puede fallar parcialmente (bloqueos de ML): para reviews/rating usar
  // el último valor conocido — son acumulativos, el dato anterior sigue siendo válido
  const sinReviews = snapshots.filter((s) => !Number.isFinite(s.numReviews)).map((s) => s.sku)
  const previos = sinReviews.length
    ? await Snapshot.aggregate([
        { $match: { sku: { $in: sinReviews }, numReviews: { $ne: null } } },
        { $sort: { fecha: -1 } },
        { $group: { _id: '$sku', numReviews: { $first: '$numReviews' }, rating: { $first: '$rating' } } },
      ])
    : []
  const reviewsPrevias = new Map(previos.map((p) => [p._id, p]))
  for (const snap of snapshots) {
    if (!Number.isFinite(snap.numReviews) && reviewsPrevias.has(snap.sku)) {
      const previo = reviewsPrevias.get(snap.sku)
      snap.numReviews = previo.numReviews
      if (!Number.isFinite(snap.rating)) snap.rating = previo.rating
    }
  }

  // velocidad POR PRODUCTO: delta de reseñas entre las dos últimas mediciones
  // reales separadas ≥12h, normalizado a ventas/día. Ordenar por reseñas
  // acumuladas dice quién ganó históricamente; esto dice quién vende AHORA.
  const historial = await Snapshot.aggregate([
    { $match: { sku: { $in: snapshots.map((s) => s.sku) }, numReviews: { $ne: null } } },
    { $sort: { fecha: -1 } },
    { $group: { _id: '$sku', mediciones: { $push: { fecha: '$fecha', numReviews: '$numReviews' } } } },
  ])
  const velocidadPorSku = new Map()
  const dep = scoring.depuracionDelta
  for (const h of historial) {
    const [ultima, ...resto] = h.mediciones
    // misma ventana mínima que el delta del nicho (resolución); si la serie es
    // nueva, cae a ≥12h para no quedarse ciego
    const previa =
      resto.find((m) => ultima.fecha - m.fecha >= dep.ventanaMinDias * 86_400_000) ??
      resto.find((m) => ultima.fecha - m.fecha >= 12 * 3600e3)
    if (!previa) continue
    const dias = (ultima.fecha - previa.fecha) / 86400e3
    const delta = Math.max(0, ultima.numReviews - previa.numReviews)
    // mismo filtro que el delta del nicho: un agregado de catálogo que saltó de
    // nivel no es velocidad de venta — mejor "sin medir" que un número absurdo
    const salto = delta > Math.max(dep.pisoPorDia, dep.maxPctDia * previa.numReviews) * dias
    velocidadPorSku.set(h._id, {
      // SIN FACTOR. Hasta el 14-ago esto era `× 25` — el mismo invento que se
      // sacó del score y del reporte, pero acá seguía vivo y se le entregaba
      // al analista como "ventasDia" de cada producto del top50.
      resenasNuevasDia: salto ? null : redondear(delta / dias, 2),
      reviewsDelta: delta,
      ventanaDias: Math.round(dias * 10) / 10,
      saltoCatalogo: salto || undefined,
    })
  }

  return {
    fechaScan: ultimo.fecha,
    productos: snapshots.map((s) => {
      const p = porSku.get(s.sku) ?? {}
      return {
        sku: s.sku,
        posicion: s.posicion,
        titulo: p.titulo ?? null,
        url: p.url ?? null,
        imagen: p.imagen ?? null,
        precio: s.precio,
        precioAnterior: s.precioAnterior,
        descuentoPct: s.descuentoPct,
        rating: s.rating,
        numReviews: s.numReviews,
        // badge público acumulado de ML, en baldes (25/50/100/500/...): dice
        // trayectoria del listing, NO ritmo. Ver senalVendidos().
        vendidos: s.vendidos ?? null,
        resenasNuevasDia: velocidadPorSku.get(s.sku)?.resenasNuevasDia ?? null,
        reviewsDelta: velocidadPorSku.get(s.sku)?.reviewsDelta ?? null,
        ventanaDias: velocidadPorSku.get(s.sku)?.ventanaDias ?? null,
        saltoCatalogo: velocidadPorSku.get(s.sku)?.saltoCatalogo ?? null,
        cuotas: s.cuotas,
        vendedor: p.vendedor ?? null,
        sellerId: p.sellerId ?? null,
        reputacionSeller: p.reputacionSeller ?? null,
        powerSeller: p.powerSeller ?? null,
        categoriaRuta: p.categoriaRuta ?? null,
        preguntas: p.preguntas ?? null,
        esTiendaOficial: p.esTiendaOficial ?? false,
        esFull: p.esFull ?? null,
        envioRapido: p.envioRapido ?? false,
        origenCrossBorder: p.origenCrossBorder ?? false,
        tipoListing: p.tipoListing ?? null,
        primeraVezVisto: p.primeraVezVisto ?? null,
      }
    }),
  }
}

// Unidades por pack declaradas en el título ("pack de 12", "x60", "60 unidades").
// null si no declara. Evita falsos positivos de dimensiones (60x40cm), medidas
// (60cm/ml/gb), potencias (60w) y promos (2x1).
export function unidadesDelTitulo(titulo) {
  const t = String(titulo ?? '').toLowerCase()
  const candidatos = []

  let m = t.match(/\bpack\s*(?:de\s*)?x?\s*(\d{1,4})\b/)
  if (m) candidatos.push(Number(m[1]))

  m = t.match(/\bset\s*(?:de\s*)?(\d{1,4})\b/)
  if (m) candidatos.push(Number(m[1]))

  m = t.match(/\b(\d{1,4})\s*(?:unidades|unidad|unid\.?|uds?\.?|und\.?|piezas|pzas\.?|sobres|rollos|pares|sachets?)\b/)
  if (m) candidatos.push(Number(m[1]))

  // "x60" suelto: no precedido por dígito (60x40) ni seguido de unidad de medida
  m = t.match(/(?<![\dx])x\s?(\d{2,4})\b(?!\s*(?:cm|mm|mts?|m\b|w\b|v\b|ml|lts?|grs?\b|kg|gb|tb|mah|led|colores|hojas))/)
  if (m) candidatos.push(Number(m[1]))

  const validos = candidatos.filter((n) => n >= 2 && n <= 1000)
  return validos.length ? Math.max(...validos) : null
}

// Distribución de precio POR UNIDAD para nichos que venden en packs: el precio
// por listing mezcla el pack de 3 con el de 60 y su mediana no compara nada.
// null si ningún listing declara pack (nicho unitario: no aporta).
export function preciosPorUnidad({ snapshots, productosPorSku }) {
  const precios = []
  let listingsConPack = 0
  for (const snap of snapshots) {
    if (!Number.isFinite(snap.precio)) continue
    const unidades = unidadesDelTitulo(productosPorSku.get(snap.sku)?.titulo)
    if (unidades) listingsConPack++
    precios.push(snap.precio / (unidades ?? 1))
  }
  if (!listingsConPack || !precios.length) return null
  precios.sort((a, b) => a - b)
  const cuantil = (p) => precios[Math.min(precios.length - 1, Math.floor(p * precios.length))]
  return {
    mediana: Math.round(cuantil(0.5)),
    p25: Math.round(cuantil(0.25)),
    p75: Math.round(cuantil(0.75)),
    listingsConPack,
    pctConPack: Math.round((listingsConPack / precios.length) * 100),
  }
}

// Sellers "gemelos": vendedores NO oficiales, chicos, que están ganando
// reseñas AHORA dentro del nicho — la prueba directa de que un entrante
// genérico (como el importador) puede vender aquí. Requiere dos scans.
export function detectarSellersGemelos({ snapshots, productosPorSku, snapshotsPrevios }) {
  if (!snapshotsPrevios?.length) return null
  const previasPorSku = new Map(snapshotsPrevios.map((s) => [s.sku, s.numReviews]))

  const porSeller = new Map()
  for (const snap of snapshots) {
    const prod = productosPorSku.get(snap.sku)
    if (!prod?.vendedor || prod.esTiendaOficial) continue
    const antes = previasPorSku.get(snap.sku)
    if (!Number.isFinite(snap.numReviews) || !Number.isFinite(antes)) continue
    const g = porSeller.get(prod.vendedor) ?? {
      vendedor: prod.vendedor,
      productos: 0,
      reviewsNuevas: 0,
      reviewsTotal: 0,
    }
    g.productos++
    g.reviewsNuevas += Math.max(0, snap.numReviews - antes)
    g.reviewsTotal += snap.numReviews
    porSeller.set(prod.vendedor, g)
  }

  // "chico" = venía con ≤500 reseñas acumuladas en el nicho antes de crecer:
  // un no-oficial gigante no es gemelo de un entrante
  return [...porSeller.values()]
    .filter((g) => g.reviewsNuevas > 0 && g.reviewsTotal - g.reviewsNuevas <= 500)
    .sort((a, b) => b.reviewsNuevas - a.reviewsNuevas)
    .slice(0, 5)
}

// Arma el reporte del último scan de un nicho leyendo de Mongo.
export async function generarReporteNicho(nicho, { topN = 50 } = {}) {
  const ultimoSnap = await Snapshot.findOne({ keyword: nicho.keyword }).sort({ fecha: -1 }).lean()
  if (!ultimoSnap) return null

  const snapshots = await Snapshot.find({ keyword: nicho.keyword, fecha: ultimoSnap.fecha }).lean()
  const productos = await Producto.find({ sku: { $in: snapshots.map((s) => s.sku) } }).lean()
  const productosPorSku = new Map(productos.map((p) => [p.sku, p]))

  // scan de referencia para el delta: el más reciente con ≥ ventanaMinDias de
  // distancia (resolución del piso de detección); si la serie es muy nueva,
  // cae al inmediatamente anterior
  const corteVentana = new Date(
    new Date(ultimoSnap.fecha).getTime() - scoring.depuracionDelta.ventanaMinDias * 86_400_000,
  )
  const snapPrevio =
    (await Snapshot.findOne({ keyword: nicho.keyword, fecha: { $lte: corteVentana } })
      .sort({ fecha: -1 })
      .lean()) ??
    (await Snapshot.findOne({ keyword: nicho.keyword, fecha: { $lt: ultimoSnap.fecha } })
      .sort({ fecha: -1 })
      .lean())
  const snapshotsPrevios = snapPrevio
    ? await Snapshot.find({ keyword: nicho.keyword, fecha: snapPrevio.fecha }).lean()
    : null

  // el volumen de búsqueda vive en la curva estacional (una consulta, no caduca)
  let curvaNicho = null
  try {
    const { CurvaEstacional } = await import('../models/CurvaEstacional.js')
    curvaNicho = await CurvaEstacional.findOne({ keyword: nicho.keyword }).select('busquedasMes').lean()
  } catch {
    // sin curva el score queda null hasta que el cron la mida: mejor sin score
    // que con uno inventado
  }

  const metricas = calcularMetricas({
    snapshots,
    productosPorSku,
    totalResultados: nicho.ultimoTotalResultados ?? null,
    topN,
    snapshotsPrevios,
    nivelBusqueda: nicho.nivelBusqueda ?? null,
    busquedasMes: curvaNicho?.busquedasMes ?? null,
  })
  const gemelos = detectarSellersGemelos({ snapshots, productosPorSku, snapshotsPrevios })
  if (gemelos) metricas.competencia.sellersGemelos = gemelos
  const porUnidad = preciosPorUnidad({ snapshots, productosPorSku })
  if (porUnidad) metricas.precio.porUnidad = porUnidad

  // EL JUEZ DEL RUIDO. El delta de reseñas produce saltos imposibles cuando ML
  // consolida un catálogo: medido sobre el histórico, 41 de 277 comparaciones
  // consecutivas saltan de forma que ninguna temporada explica (partidor
  // batería llegó a ir de 118 a 35.063 en un scan). La curva anual de Google no
  // depende de reseñas ni del scraper, así que puede arbitrar sin contaminarse.
  //
  // NO se borra el dato: se anula la tasa de reseñas para que salga de la
  // serie y del conteo de maduración —los consumidores ya filtran $ne:null— y
  // el valor crudo queda guardado en `saltoSospechoso`. Si algún día un salto
  // era real (un viral, un lanzamiento), se puede ver y revisar.
  try {
    const previo = metricas.demanda?.resenasNuevasPorDia
    if (previo != null) {
      const [{ Reporte }, { CurvaEstacional }, { saltoEsCreible }] = await Promise.all([
        import('../models/Reporte.js'),
        import('../models/CurvaEstacional.js'),
        import('./estacionalidad.js'),
      ])
      const anterior = await Reporte.findOne({
        nichoId: nicho._id,
        'metricas.demanda.resenasNuevasPorDia': { $ne: null },
      })
        .sort({ fecha: -1 })
        .select('fecha metricas.demanda.resenasNuevasPorDia')
        .lean()
      if (anterior) {
        const curva = await CurvaEstacional.findOne({ keyword: nicho.keyword }).select('curva').lean()
        const veredicto = saltoEsCreible({
          anterior: anterior.metricas.demanda.resenasNuevasPorDia,
          actual: previo,
          curva: curva?.curva?.length === 12 ? curva.curva : null,
          mesActual: new Date(ultimoSnap.fecha).getMonth() + 1,
          mesAnterior: new Date(anterior.fecha).getMonth() + 1,
        })
        if (veredicto?.creible === false) {
          metricas.demanda.saltoSospechoso = {
            valorCrudo: previo,
            contra: anterior.metricas.demanda.resenasNuevasPorDia,
            salto: veredicto.salto,
            motivo: veredicto.motivo,
          }
          metricas.demanda.resenasNuevasPorDia = null
        }
      }
    }
  } catch {
    // sin juez el reporte sale igual: mejor un dato sin arbitrar que ninguno
  }

  const topProductos = [...snapshots]
    .sort((a, b) => (a.posicion ?? Infinity) - (b.posicion ?? Infinity))
    .slice(0, 10)
    .map((snap) => {
      const prod = productosPorSku.get(snap.sku)
      return {
        sku: snap.sku,
        posicion: snap.posicion,
        titulo: prod?.titulo ?? null,
        imagen: prod?.imagen ?? null,
        precio: snap.precio,
        descuentoPct: snap.descuentoPct,
        rating: snap.rating,
        vendedor: prod?.vendedor ?? null,
        esTiendaOficial: prod?.esTiendaOficial ?? null,
        esFull: prod?.esFull ?? null,
        tipoListing: prod?.tipoListing ?? null,
        url: prod?.url ?? null,
      }
    })

  return {
    fechaScan: ultimoSnap.fecha,
    metricas,
    topProductos,
    topSellers: metricas.competencia.topSellers,
  }
}
