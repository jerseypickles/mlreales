import { Nicho } from '../models/Nicho.js'
import {
  detectarTramites,
  tendenciaVentas,
  inversionEstimadaUsd,
  unidadesPrimeraCompra,
  confirmacionVeredicto,
  exwObjetivo,
} from './oportunidades.js'
import { config } from '../config/env.js'
import { calcularMargen } from './margen.js'
import { comisionMlExacta, categoriaDominante } from './comisionesMl.js'
import { topSkusPorKeyword, agruparFamilias } from './familias.js'
import { puntajeBusqueda, explicar } from './nivelBusqueda.js'
import { ventanaDeCompra } from './ventana.js'

// Margen estimado si compras al EXW que cotizó el proveedor, con los mismos
// supuestos estándar de la tabla del análisis (volumen 0.003 m³/u, marítimo).
// Es el semáforo de la planilla; la afinación fina se hace en el simulador.
// comisionPct: la exacta de la API oficial manda sobre la que declaró el LLM.
// Margen con el costo REAL puesto en Chile: sin flete estimado ni cubicaje,
// solo precio − comisión ML − costo. Es la vía preferida cuando el importador
// conoce el número (regla suya del 8-ago: "más fácil de calcular").
function margenPuesto({ costoPuestoClp, rec, comisionPct = null }) {
  if (!Number.isFinite(costoPuestoClp) || !Number.isFinite(rec?.precioVentaClp)) return null
  const pct = comisionPct ?? rec.comisionMlPct ?? 14
  const comisionClp = Math.round((pct / 100) * rec.precioVentaClp)
  const margenClp = rec.precioVentaClp - comisionClp - costoPuestoClp
  return {
    margenClp,
    margenPct: Math.round((margenClp / rec.precioVentaClp) * 1000) / 10,
    viable: margenClp > 0,
    landedClp: costoPuestoClp,
    comisionClp,
    base: 'costo puesto en Chile',
  }
}

// EL VOLUMEN QUE FALTA. Hasta el 26-ago-2026 esto clavaba `volumenM3: 0.003`
// —un producto chico de bodega— sin decirlo en ninguna parte. Con la cotización
// de QBUY sobre la mesa el supuesto dejó de ser inocente: en la depiladora el
// flete es el 1% del costo puesto, pero en un rack de 85 cm con 0,05 m³ reales
// es el 23%. El mismo supuesto que no cambia nada en uno decide el otro.
//
// Ahora el cubicaje viaja desde el nicho cuando existe, y cuando no, el número
// sale igual PERO con `volumenSupuesto` en true para que la pantalla lo diga.
const VOLUMEN_SUPUESTO_M3 = 0.003

function margenCotizacion({ exwUsd, rec, unidades, comisionPct = null, volumenM3 = null, tipoCambioUsdClp = null }) {
  if (!Number.isFinite(exwUsd) || !Number.isFinite(rec?.precioVentaClp)) return null
  const pctFinal = comisionPct ?? rec.comisionMlPct
  const volumenSupuesto = !(volumenM3 > 0)
  const vol = volumenSupuesto ? VOLUMEN_SUPUESTO_M3 : volumenM3
  const parametros = {}
  if (Number.isFinite(pctFinal)) parametros.mercadoLibre = { comisionPct: pctFinal }
  if (Number.isFinite(tipoCambioUsdClp)) parametros.tipoCambioUsdClp = tipoCambioUsdClp
  try {
    const sim = calcularMargen({
      costoExwUsd: exwUsd,
      precioVentaClp: rec.precioVentaClp,
      unidades: unidades ?? 500,
      volumenM3: vol,
      modoFlete: 'maritimo',
      parametros: Object.keys(parametros).length ? parametros : undefined,
    })
    return {
      margenClp: sim.porUnidad.margenClp,
      margenPct: sim.resultado.margenPctSobreVenta,
      viable: sim.resultado.viable,
      // desglose para el panel de detalle: costo puesto en Chile y comisión+Full
      landedClp: sim.porUnidad.landedNetoClp,
      comisionClp: Math.round(sim.porUnidad.comisionMlClp + sim.porUnidad.fullClp),
      fleteClp: sim.porUnidad.fleteClp ?? null,
      volumenM3: vol,
      volumenSupuesto,
    }
  } catch {
    return null
  }
}

// Panel de decisión: todos los nichos con análisis, aplanados a una fila
// comparable y rankeados por score (empate: demanda). Con todos=true incluye
// no_entrar y pausados — fuente de la planilla IA y del estratega semanal.
export async function tableroOportunidades({ todos = false } = {}) {
  // el dólar del día para que el costo puesto no se calcule con el del archivo
  let tipoCambioUsdClp = null
  try {
    const { dolarObservado } = await import('./indicadores.js')
    tipoCambioUsdClp = Math.round((await dolarObservado()).valor)
  } catch {
    // sin indicador se usa el del config: calcularMargen ya tiene su default
  }
  const filas = await Nicho.aggregate([
    { $match: todos ? {} : { estado: 'activo' } },
    {
      $lookup: {
        from: 'reportes',
        let: { nid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$nichoId', '$$nid'] } } },
          { $sort: { fecha: -1 } },
          { $limit: 2 },
          { $project: { fecha: 1, scoreOportunidad: 1, metricas: 1 } },
        ],
        as: 'ultimos',
      },
    },
    {
      $lookup: {
        from: 'reportes',
        let: { nid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$nichoId', '$$nid'] }, analisis: { $ne: null } } },
          { $sort: { fecha: -1 } },
          { $limit: 1 },
          { $project: { fecha: 1, scoreOportunidad: 1, analisis: 1 } },
        ],
        as: 'conAnalisis',
      },
    },
    {
      // cuántos scans respaldan la demanda: la base de "confirmado vs preliminar"
      $lookup: {
        from: 'reportes',
        let: { nid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$nichoId', '$$nid'] },
              'metricas.demanda.resenasNuevasPorDia': { $ne: null },
            },
          },
          { $count: 'n' },
        ],
        as: 'conteoDemanda',
      },
    },
    {
      // SERIE de scores. Medido el 18-ago sobre los 12 nichos con 8+ scans: el
      // score NO converge — oscila ±5 pts alrededor de un nivel para siempre
      // (foco solares: 69 61 72 70 73 79 70 76). Leer el último valor acierta
      // el veredicto 64-69% de las veces; leer el promedio de la serie, 81%.
      // Por eso el tablero rankea por NIVEL, no por la última medición.
      // SOLO SCORES DE LA MISMA FÓRMULA. El score se reescribió el 16-ago-2026
      // (entraron constancia, entrada y economía; salieron calidad y full), y
      // promediar los de antes con los de después mezcla dos escalas.
      //
      // Medido el 22-ago: 29 de 76 nichos tenían el nivel contaminado. El peor,
      // ventilador de torre, promediaba su 58 actual con 82, 81, 88, 91, 90, 90
      // y 90 de la fórmula vieja y mostraba 84 — el tablero rankeaba por un
      // número que ninguna fórmula había calculado.
      //
      // `componentes.constancia` solo existe en la nueva, así que sirve de sello.
      // El costo de filtrar es que un nicho recién medido queda con nivel de
      // pocos scans y por lo tanto más ruidoso; se prefiere ruidoso y correcto
      // antes que suave y falso, que es el criterio de toda la mesa.
      $lookup: {
        from: 'reportes',
        let: { nid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$nichoId', '$$nid'] },
              scoreOportunidad: { $ne: null },
              'metricas.oportunidad.componentes.constancia': { $ne: null },
            },
          },
          { $sort: { fecha: -1 } },
          { $limit: 8 },
          { $project: { _id: 0, s: '$scoreOportunidad' } },
        ],
        as: 'serieScore',
      },
    },
    {
      $project: {
        keyword: 1,
        conteoDemanda: 1,
        serieScore: 1,
        nivelBusqueda: 1,
        creadoEl: 1, // la mesa marca los recién descubiertos
        origen: 1,
        jugadaDe: 1,
        familiaAparte: 1,
        estado: 1,
        etapaCompra: 1,
        etapaCompraEl: 1,
        notaEtapa: 1,
        frecuenciaScan: 1,
        exwCotizadoUsd: 1,
        exwCotizadoEl: 1,
        costoPuestoClp: 1,
        costoPuestoEl: 1,
        unidadesPedido: 1,
        volumenM3: 1,
        pesoKg: 1,
        precioVentaObjetivoClp: 1,
        radarInfo: 1,
        rfq: 1,
        ultimos: 1,
        conAnalisis: 1,
        tieneListing: { $cond: [{ $ifNull: ['$listingDraft', false] }, true, false] },
      },
    },
  ])

  // comisión exacta solo para filas con cotización (pocas), EN PARALELO y con
  // cache 24h en comisionesMl — en serie dentro del loop sumaba ~1-2s al tablero
  const comisionPorKeyword = new Map()
  await Promise.all(
    filas
      .filter((n) => (Number.isFinite(n.exwCotizadoUsd) || Number.isFinite(n.costoPuestoClp)) && n.conAnalisis?.[0]?.analisis)
      .map(async (n) => {
        try {
          const rec = n.conAnalisis[0].analisis.recomendacion ?? {}
          const categoria = await categoriaDominante(n.keyword)
          const c = await comisionMlExacta({ precioClp: rec.precioVentaClp, categoriaId: categoria })
          if (c?.pct != null) comisionPorKeyword.set(n.keyword, c.pct)
        } catch {
          // sin comisión exacta: margenCotizacion cae a la del LLM
        }
      }),
  )

  // LA FORMA DEL AÑO, medida (Google Trends, ver services/estacionalidad.js).
  // Una sola consulta para todo el tablero: la curva no caduca. Si un nicho no
  // la tiene, la tarjeta lo dice — nunca se inventa un pico.
  const curvaPorKeyword = new Map()
  try {
    const { CurvaEstacional } = await import('../models/CurvaEstacional.js')
    const curvas = await CurvaEstacional.find({ 'curva.11': { $exists: true } })
      .select('keyword curva mesPico nombreMesPico ratioPico clasificacion promedio fuente busquedasMes competenciaAds cpcUsd keywordMedida correccionFactor')
      .lean()
    for (const c of curvas) curvaPorKeyword.set(c.keyword, c)
  } catch {
    // sin curvas medidas el tablero funciona igual, con la estacionalidad del radar
  }

  // NICHOS DONDE YA VENDO. La mesa de compra listaba los 45 nichos como si
  // todos fueran territorio nuevo, pero en varios ya hay publicación propia
  // —y en uno ya hay ventas—. No es lo mismo evaluar un nicho a ciegas que
  // uno del que tienes conversión, visitas y precio propio: ahí la decisión
  // no es "entrar" sino "reponer" o "ampliar surtido".
  //
  // Misma agregación que ya alimenta el sidebar de Nichos (routes/nichos.js),
  // reutilizada acá para que las dos vistas no se contradigan.
  const propiosPorNicho = new Map()
  try {
    const { ProductoPropio } = await import('../models/ProductoPropio.js')
    const { ventasPorItem } = await import('./ventasMl.js')
    const propios = await ProductoPropio.find({ nichoId: { $ne: null } })
      .select('nichoId itemIdMl sku estado estadoMl')
      .lean()
    const v30 = await ventasPorItem({ dias: 30 }).catch(() => new Map())
    for (const p of propios) {
      const clave = String(p.nichoId)
      const acc = propiosPorNicho.get(clave) ?? { publicaciones: 0, activas: 0, unidades30d: 0 }
      acc.publicaciones++
      if (p.estado === 'activo' && p.estadoMl !== 'closed') acc.activas++
      acc.unidades30d += v30.get(p.itemIdMl ?? p.sku)?.unidades ?? 0
      propiosPorNicho.set(clave, acc)
    }
  } catch {
    // sin datos de propios la mesa funciona igual, solo sin el distintivo
  }

  const oportunidades = []
  for (const n of filas) {
    const docAnalisis = n.conAnalisis?.[0]
    const analisis = docAnalisis?.analisis
    // LOS RECIÉN DESCUBIERTOS TAMBIÉN SE MUESTRAN.
    //
    // La mesa exigía análisis para entrar, así que un nicho nuevo del radar era
    // invisible acá hasta juntar sus 5 scans — una semana en la que el
    // importador no sabía que existía. Ahora aparece en su grupo desde el día
    // uno, sin score ni veredicto (no los tiene y no se van a inventar) y
    // diciendo cuántos scans le faltan. Misma doctrina que el sidebar de
    // Nichos: se muestra que se está midiendo, no un número prematuro.
    if (!analisis) {
      if (n.estado !== 'activo') continue
      const scans = n.conteoDemanda?.[0]?.n ?? 0
      // LO QUE YA SE MIDIÓ SE MUESTRA, AUNQUE NO HAYA ANÁLISIS.
      //
      // La primera versión de esta fila solo llevaba nombre, curva y scans, así
      // que en la mesa aparecían con Google medido pero las columnas de ML en
      // blanco — y el importador preguntó por qué. El dato estaba: "zapatos
      // seguridad" ya tenía ≥48.400 vendidos, 94% de despegue y 71,4% de Full
      // desde su primer scan. Vendidos y Full salen del nivel 1 y NO necesitan
      // serie; lo único que la serie aporta es el score y el veredicto.
      const met = n.ultimos?.[0]?.metricas ?? null
      oportunidades.push({
        nichoId: String(n._id),
        keyword: n.keyword,
        creadoEl: n.creadoEl ?? null,
        midiendo: true,
        scansConDemanda: scans,
        faltanScans: Math.max(0, config.maduracionScans - scans),
        score: null,
        veredicto: null,
        mediana: met?.precio?.mediana ?? null,
        vendidosHistoricos: met?.vendidosHistoricos ?? null,
        profundidadStock: met?.profundidadStock ?? null,
        pctFull: met?.competencia?.pctFull ?? null,
        pctCatalogo: met?.competencia?.pctCatalogo ?? null,
        pctCrossBorder: met?.competencia?.pctCrossBorder ?? null,
        sellersUnicos: met?.competencia?.sellersUnicos ?? null,
        curvaAnual: curvaPorKeyword.get(n.keyword) ?? null,
        ventana: ventanaDeCompra({
          estacionalidad: n.radarInfo?.estacionalidad,
          curvaAnual: curvaPorKeyword.get(n.keyword),
        }),
        nivelBusqueda: n.nivelBusqueda ?? null,
        estado: n.estado,
        etapaCompra: n.etapaCompra ?? 'evaluando',
        mios: propiosPorNicho.get(String(n._id)) ?? null,
      })
      continue
    }
    // un no_entrar con serie completa sí se esconde: ya se decidió. Uno sin
    // serie es un primer vistazo y se queda a la vista, marcado como midiendo.
    const scansDeEste = n.conteoDemanda?.[0]?.n ?? 0
    if (!todos && analisis.veredicto === 'no_entrar' && scansDeEste >= config.maduracionScans) continue

    const ultimo = n.ultimos?.[0]
    const rec = analisis.recomendacion ?? {}
    // análisis viejos guardaron fobMaximoUsd; el significado nuevo es EXW
    const exwMax = rec.exwMaximoUsd ?? rec.fobMaximoUsd ?? null
    const scansConDemanda = n.conteoDemanda?.[0]?.n ?? 0
    const tendencia = tendenciaVentas(n.ultimos?.[0], n.ultimos?.[1])
    const gemelos = ultimo?.metricas?.competencia?.sellersGemelos ?? null
    const unidadesPrueba = unidadesPrimeraCompra(rec.primeraCompra)
    // la cantidad editada a mano en la planilla pisa la sugerida por el análisis
    const unidadesEfectivas = Number.isFinite(n.unidadesPedido) ? n.unidadesPedido : unidadesPrueba
    // cotización real del proveedor: se compara contra el máximo y se estima
    // la ganancia por unidad al precio recomendado del análisis
    let cotizacion = null
    const comisionPct = comisionPorKeyword.get(n.keyword) ?? null
    // EL MARGEN SOLO SI HAY PRECIO PROPIO, y vale para las dos ramas.
    // `rec.precioVentaClp` sale de la mediana del mercado, o sea de OTRO
    // producto. Si el tuyo es de mejor calidad ese margen no dice nada.
    const precioPropio = Number.isFinite(n.precioVentaObjetivoClp) ? n.precioVentaObjetivoClp : null
    const recParaMargen = precioPropio ? { ...rec, precioVentaClp: precioPropio } : rec

    if (Number.isFinite(n.costoPuestoClp)) {
      // el costo puesto en Chile manda: dato real del importador
      const m = precioPropio ? margenPuesto({ costoPuestoClp: n.costoPuestoClp, rec: recParaMargen, comisionPct }) : null
      cotizacion = {
        costoPuestoClp: n.costoPuestoClp,
        exwUsd: n.exwCotizadoUsd ?? null,
        fecha: n.costoPuestoEl ?? n.exwCotizadoEl ?? null,
        precioObjetivoClp: precioPropio,
        cierra: m ? m.margenClp > 0 : null,
        ...(m ?? {}),
      }
    } else if (Number.isFinite(n.exwCotizadoUsd)) {
      cotizacion = {
        exwUsd: n.exwCotizadoUsd,
        fecha: n.exwCotizadoEl ?? null,
        precioObjetivoClp: precioPropio,
        cierra: exwMax != null ? n.exwCotizadoUsd <= exwMax : null,
        // el costo puesto se calcula siempre (es lo que preguntó el importador);
        // el margen se borra si el precio no es suyo
        ...(() => {
          const m = margenCotizacion({
            exwUsd: n.exwCotizadoUsd,
            rec: recParaMargen,
            unidades: unidadesEfectivas,
            comisionPct,
            volumenM3: n.volumenM3 ?? null,
            tipoCambioUsdClp,
          })
          if (!m) return {}
          return precioPropio ? m : { ...m, margenClp: null, margenPct: null, viable: null }
        })(),
      }
    }
    // gasto del pedido: cantidad × EXW cotizado (real) o × EXW máx (estimación)
    const precioGasto = cotizacion?.exwUsd ?? exwMax
    const gastoPedidoUsd =
      Number.isFinite(precioGasto) && Number.isFinite(unidadesEfectivas)
        ? Math.round(precioGasto * unidadesEfectivas)
        : null
    oportunidades.push({
      nichoId: n._id,
      keyword: n.keyword,
      // ¿alguien busca esta keyword? La mesa de compra también tiene que
      // avisarlo: se cotiza con proveedores sobre esta fila
      nivelBusqueda: n.nivelBusqueda
        ? {
            nivel: n.nivelBusqueda.nivel,
            // la POSICIÓN tiene que viajar: sin ella la carta dice "búsqueda
            // alta" y hay que ir a chequear a mano si es #1 o #9 de su lista
            posicion: n.nivelBusqueda.posicion ?? null,
            deCuantas: n.nivelBusqueda.deCuantas ?? null,
            prefijo: n.nivelBusqueda.prefijo ?? null,
            colaLarga: n.nivelBusqueda.colaLarga ?? null,
            keywordSugerida: n.nivelBusqueda.keywordSugerida ?? null,
            explicacion: explicar(n.nivelBusqueda),
          }
        : null,
      origen: n.origen,
      jugadaDeKeyword: n.jugadaDe?.keyword ?? null,
      familiaAparte: n.familiaAparte ?? [],
      frecuenciaScan: n.frecuenciaScan,
      veredicto: analisis.veredicto,
      confianza: analisis.confianza ?? null,
      veredictoDeSerie: analisis.esGraduacion === true || undefined,
      ...nivelScore(n.serieScore, ultimo?.scoreOportunidad ?? docAnalisis.scoreOportunidad ?? null),
      fechaScan: ultimo?.fecha ?? null,
      mediana: ultimo?.metricas?.precio?.mediana ?? null,
      // LO CONTADO va primero y LO DERIVADO va marcado. `ventasDia` es delta de
      // reseñas × factor 25 — un factor que la calibración propia desmiente (54
      // ventas reales dieron 3 reseñas: factor 18) y que en 41 de 367 mediciones
      // produjo saltos de 5x o más. La tarjeta muestra el conteo real y deja la
      // estimación plegada con su aritmética a la vista.
      resenasNuevas: ultimo?.metricas?.demanda?.reviews?.delta ?? null,
      canasta: ultimo?.metricas?.demanda?.reviews?.itemsComparables ?? null,
      ventanaDias: ultimo?.metricas?.demanda?.reviews?.periodoDias ?? null,
      saltosFiltrados:
        (ultimo?.metricas?.demanda?.reviews?.saltosFiltrados ?? 0) +
          (ultimo?.metricas?.demanda?.reviews?.duplicadosCatalogo ?? 0) || null,
      preguntasNuevas: ultimo?.metricas?.demanda?.preguntas?.nuevas ?? null,
      ventasDia: ultimo?.metricas?.demanda?.resenasNuevasPorDia ?? null,
      // el dato que el juez del ruido descartó: no se borra, se muestra marcado
      saltoSospechoso: ultimo?.metricas?.demanda?.saltoSospechoso ?? null,
      factorEstimacion: 25,
      tendenciaVentas: tendencia,
      scansConDemanda,
      // la mesa muestra "N/5 · faltan X" en vez del score y el veredicto
      // mientras no haya serie, igual que el sidebar de Nichos: un score de un
      // solo scan es un número prematuro, no una medición
      midiendo:
        n.estado === 'activo' &&
        scansConDemanda < config.maduracionScans &&
        !['descartado', 'en-espera', 'vendiendo'].includes(n.etapaCompra ?? 'evaluando'),
      faltanScans: Math.max(0, config.maduracionScans - scansConDemanda),
      confirmacion: confirmacionVeredicto(scansConDemanda, tendencia),
      // el programador sube a diario los preliminares con veredicto de entrada
      // hasta juntar la serie: la carta lo muestra para que se sepa que corre solo
      // mismo criterio que el programador: le faltan mediciones (no confundir
      // con el preliminar por tendencia a la baja, que ya tiene serie y lo que
      // necesita es decisión, no más scans)
      // madurar depende de cuánto se midió, no del signo del veredicto: un
      // no_entrar dictado con cero scans es un primer vistazo, no un cierre
      // (ver el comentario largo en routes/nichos.js)
      madurando:
        n.estado === 'activo' &&
        scansConDemanda < config.maduracionScans &&
        !['descartado', 'en-espera', 'vendiendo'].includes(n.etapaCompra ?? 'evaluando'),
      sellersGemelos: gemelos ? gemelos.length : null,
      gemelosDetalle: gemelos?.length
        ? gemelos.map((g) => `${g.vendedor} (+${g.reviewsNuevas} reseñas)`).join(', ')
        : null,
      pctFull: ultimo?.metricas?.competencia?.pctFull ?? null,
      sellersUnicos: ultimo?.metricas?.competencia?.sellersUnicos ?? null,
      // TRAYECTORIA: suma de los badges "+N vendidos" del top. Es un piso
      // acumulado en baldes gruesos, no un ritmo — va acá para comparar el
      // tamaño de un nicho contra otro, que es lo único que resuelve bien.
      vendidosHistoricos: ultimo?.metricas?.vendidosHistoricos ?? null,
      // qué parte del top está por agotarse, y quién despacha desde el extranjero
      profundidadStock: ultimo?.metricas?.profundidadStock ?? null,
      pctCrossBorder: ultimo?.metricas?.competencia?.pctCrossBorder ?? null,
      origenesCrossBorder: ultimo?.metricas?.competencia?.origenesCrossBorder ?? null,
      // {publicaciones, activas, unidades30d} si ya tengo listing en este nicho
      mios: propiosPorNicho.get(String(n._id)) ?? null,
      // cuándo lo descubrió el radar: la mesa marca los recién llegados para
      // que no se pierdan entre 44 filas que ya estaban ahí ayer
      creadoEl: n.creadoEl ?? null,
      titular: rec.titular ?? null,
      segmento: rec.segmento ?? null,
      // cuánto del top mezclado respalda la jugada, y la búsqueda que la aísla
      shareJugadaPct: analisis.shareJugadaPct ?? null,
      keywordJugada: analisis.keywordJugada ?? null,
      precioVentaClp: rec.precioVentaClp ?? null,
      exwMaximoUsd: exwMax,
      exwObjetivoUsd: exwObjetivo(exwMax, config.exwObjetivoPct),
      cotizacion,
      primeraCompra: rec.primeraCompra ?? null,
      inversionEstimadaUsd: inversionEstimadaUsd(rec.primeraCompra, exwMax),
      // análisis nuevos lo declaran estructurado; los viejos caen al detector de texto
      tramites: Array.isArray(analisis.tramites)
        ? analisis.tramites
        : detectarTramites([...(analisis.riesgos ?? []), n.radarInfo?.riesgo]),
      // CUÁNDO se compra, calculado (pico menos lead time). Es lo que ordena la
      // mesa junto con el nivel de búsqueda: un nicho de score alto con la
      // ventana cerrada no se puede comprar y no puede ir arriba.
      ventana: ventanaDeCompra({
        ventanaCompra: analisis.ventanaCompra,
        estacionalidad: n.radarInfo?.estacionalidad,
        curvaAnual: curvaPorKeyword.get(n.keyword),
      }),
      // silueta real de 5 años: es lo que dibuja el minigráfico y lo que
      // permite leer un cero como valle de temporada en vez de como muerte
      curvaAnual: curvaPorKeyword.get(n.keyword) ?? null,
      ventanaImportacion: n.radarInfo?.ventanaImportacion ?? null,
      estacionalidad: n.radarInfo?.estacionalidad ?? null,
      condiciones: analisis.veredicto === 'entrar_con_condiciones' ? (analisis.resumen ?? null) : null,
      listingListo: n.tieneListing,
      estado: n.estado,
      etapaCompra: n.etapaCompra ?? 'evaluando',
      etapaCompraEl: n.etapaCompraEl ?? null,
      notaEtapa: n.notaEtapa ?? null,
      resumen: analisis.resumen ?? null,
      // Campos del proveedor. Los llenaba un pase de LLM para la planilla de
      // cotización; esa planilla se retiró (nunca se usó) y el pase con ella,
      // así que hoy salen del análisis. `productoClave` sí sigue vivo: es lo
      // que une dos nichos en una sola compra (unir/separar en Oportunidades).
      nichoIngles: n.rfq?.nichoIngles ?? analisis.nichoIngles ?? null,
      productoIngles: n.rfq?.productoIngles ?? rec.productoIngles ?? null,
      productoClave: n.rfq?.productoClave ?? null,
      unidadPedido: n.rfq?.unidadPedido ?? null,
      unidadesPrueba,
      unidadesPedido: n.unidadesPedido ?? null,
      unidadesEfectivas,
      gastoPedidoUsd,
      gastoEsReal: Boolean(cotizacion && Number.isFinite(cotizacion.exwUsd)),
      especificacionProducto: n.rfq?.especificacion ?? rec.especificacionProducto ?? null,
      comoValidar: rec.comoValidar ?? null,
      comisionMlPct: rec.comisionMlPct ?? null,
      fechaAnalisis: analisis.generadoEl ?? docAnalisis.fecha ?? null,
    })
  }

  oportunidades.sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.ventasDia ?? 0) - (a.ventasDia ?? 0),
  )

  // FAMILIAS: nichos que miden el mismo mercado (solape de SKUs del último
  // scan). El de mayor score lidera; los demás llevan familiaLider para que la
  // UI los colapse y el estratega reclame el gasto duplicado.
  try {
    // mismo criterio que el sidebar: lidera la keyword CLARA, no la de mayor
    // score (si no, la mal escrita manda sobre sus hermanas sanas)
    const porClaridad = [...oportunidades].sort(
      (a, b) => puntajeBusqueda(b.nivelBusqueda) - puntajeBusqueda(a.nivelBusqueda) || (b.score ?? -1) - (a.score ?? -1),
    )
    const skus = await topSkusPorKeyword(porClaridad.map((o) => o.keyword))
    const { deMiembro, deLider } = agruparFamilias(porClaridad, skus)
    for (const o of oportunidades) {
      const m = deMiembro.get(o.keyword)
      o.familiaLider = m?.lider ?? null
      o.familiaSolapePct = m?.solapePct ?? null
      o.esJugadaDelLider = m?.esJugadaDelLider ?? false
      o.familiaMiembros = deLider.get(o.keyword) ?? null
    }
  } catch (err) {
    console.warn(`[tablero] familias no calculadas: ${err.message}`)
  }

  marcarConversion(oportunidades)
  return oportunidades
}

// EL SCORE ES UNA MEDICIÓN CON RUIDO, NO UN VALOR.
//
// Medido el 18-ago-2026 sobre los 12 nichos con 8 o más scans: el score nunca
// converge. Oscila ±5 puntos alrededor de un nivel estable y se queda ahí para
// siempre — foco solares dio 69 61 72 70 73 79 70 76, piscina inflable 77 79 80
// 83 76 73 87 69. No le faltan mediciones: la medición misma vibra.
//
// La consecuencia es contraintuitiva y por eso vale escribirla. Leyendo el
// ÚLTIMO valor, el veredicto del scan 5 acierta MENOS que el del scan 3 (64% vs
// 69%): cada scan nuevo es otro tiro al aire, y el último tiro no sabe más que
// el anteúltimo. Leyendo el PROMEDIO de la serie sube a 81%, y ahí 3 scans
// acierta exactamente igual que 5 (81% ambos, error de 2,3 vs 1,4 puntos —
// diferencia que cae dentro del propio ruido).
//
// Por eso: el tablero rankea por nivel, y la maduración baja de 5 scans a 3.
// Los dos scans que se ahorran no compraban precisión, compraban demora.
//
// `dispersion` se expone para que la mesa pueda mostrar cuánto vibra el nicho:
// un 72 firme y un 72 que rebota entre 58 y 88 no son la misma apuesta.
function nivelScore(serie, respaldo) {
  const s = (serie ?? []).map((r) => r.s).filter(Number.isFinite)
  if (!s.length) return { score: respaldo, scoreUltimo: respaldo, dispersion: null }
  const nivel = Math.round(s.reduce((a, b) => a + b, 0) / s.length)
  return {
    score: nivel,
    scoreUltimo: s[0], // la serie viene ordenada de más nueva a más vieja
    dispersion: s.length >= 3 ? Math.max(...s) - Math.min(...s) : null,
  }
}

// ¿LA BÚSQUEDA DE GOOGLE SE CONVIERTE EN VENTA DENTRO DE ML?
//
// Dato de LECTURA, no del score — decisión explícita del importador el 17-ago.
// Google mide intención de investigar, no de comprar en ML, y las dos cosas se
// separan muchísimo: sobre 68 nichos la correlación entre búsquedas y unidades
// vendidas es apenas +0,47. Una manguera de jardín se compra sin googlear (260
// búsquedas, 14.500 unidades en su top); un aire acondicionado se googlea diez
// veces y se termina comprando en la tienda física (60.500 búsquedas, 14.650).
//
// EL RATIO CRUDO NO SIRVE: correlaciona −0,56 con el precio, o sea que mide
// sobre todo que lo barato vende más unidades (bajo $10k el ratio mediano es
// 7,5× y sobre $40k es 0,8×). Cableado así empujaría el tablero de vuelta a los
// productos de $3.000, donde Full se lleva el 46%.
//
// Por eso se compara cada nicho contra lo NORMAL DE SU TRAMO DE PRECIO: una
// regresión log-log de ratio sobre precio, y lo que se muestra es el desvío.
// Con eso el precio queda neutralizado (correlación −0,00) y sobrevive la señal
// que importa (+0,45 con el % del top que despegó).
//
// LÍMITE CONOCIDO, y por eso no entra al score: el numerador son unidades
// ACUMULADAS de por vida y el denominador son búsquedas de un mes. Un nicho con
// publicaciones viejas acumula más aunque hoy venda igual, así que parte de
// "convierte mejor" puede ser "sus listings son más antiguos". Para separarlo
// haría falta el DELTA de vendidos entre scans, que sí sería un flujo.
function marcarConversion(filas) {
  const base = filas
    .map((o) => ({
      o,
      precio: o.mediana,
      ratio: (o.vendidosHistoricos?.pisoUnidades ?? 0) / (o.curvaAnual?.busquedasMes || 0),
    }))
    .filter((x) => Number.isFinite(x.precio) && x.precio > 0 && Number.isFinite(x.ratio) && x.ratio > 0)
  if (base.length < 8) return // con menos, la regresión no dice nada

  const xs = base.map((x) => Math.log10(x.precio))
  const ys = base.map((x) => Math.log10(x.ratio))
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const pend = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0)
  const inter = my - pend * mx

  for (const { o, precio, ratio } of base) {
    const esperado = 10 ** (inter + pend * Math.log10(precio))
    o.conversion = {
      ratio: Math.round(ratio * 10) / 10,
      esperado: Math.round(esperado * 10) / 10,
      // >1 convierte mejor que lo normal de su precio; <1 peor
      factor: Math.round((ratio / esperado) * 100) / 100,
    }
  }
}
