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

// Margen estimado si compras al EXW que cotizó el proveedor, con los mismos
// supuestos estándar de la tabla del análisis (volumen 0.003 m³/u, marítimo).
// Es el semáforo de la planilla; la afinación fina se hace en el simulador.
// comisionPct: la exacta de la API oficial manda sobre la que declaró el LLM.
function margenCotizacion({ exwUsd, rec, unidades, comisionPct = null }) {
  if (!Number.isFinite(exwUsd) || !Number.isFinite(rec?.precioVentaClp)) return null
  const pctFinal = comisionPct ?? rec.comisionMlPct
  try {
    const sim = calcularMargen({
      costoExwUsd: exwUsd,
      precioVentaClp: rec.precioVentaClp,
      unidades: unidades ?? 500,
      volumenM3: 0.003,
      modoFlete: 'maritimo',
      parametros: Number.isFinite(pctFinal) ? { mercadoLibre: { comisionPct: pctFinal } } : undefined,
    })
    return {
      margenClp: sim.porUnidad.margenClp,
      margenPct: sim.resultado.margenPctSobreVenta,
      viable: sim.resultado.viable,
      // desglose para el panel de detalle: costo puesto en Chile y comisión+Full
      landedClp: sim.porUnidad.landedNetoClp,
      comisionClp: Math.round(sim.porUnidad.comisionMlClp + sim.porUnidad.fullClp),
    }
  } catch {
    return null
  }
}

// Panel de decisión: todos los nichos con análisis, aplanados a una fila
// comparable y rankeados por score (empate: demanda). Con todos=true incluye
// no_entrar y pausados — fuente de la planilla IA y del estratega semanal.
export async function tableroOportunidades({ todos = false } = {}) {
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
              'metricas.demanda.ventasEstimadasPorDia': { $ne: null },
            },
          },
          { $count: 'n' },
        ],
        as: 'conteoDemanda',
      },
    },
    {
      $project: {
        keyword: 1,
        conteoDemanda: 1,
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
        unidadesPedido: 1,
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
      .filter((n) => Number.isFinite(n.exwCotizadoUsd) && n.conAnalisis?.[0]?.analisis)
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

  const oportunidades = []
  for (const n of filas) {
    const docAnalisis = n.conAnalisis?.[0]
    const analisis = docAnalisis?.analisis
    if (!analisis) continue
    if (!todos && analisis.veredicto === 'no_entrar') continue

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
    if (Number.isFinite(n.exwCotizadoUsd)) {
      const comisionPct = comisionPorKeyword.get(n.keyword) ?? null
      cotizacion = {
        exwUsd: n.exwCotizadoUsd,
        fecha: n.exwCotizadoEl ?? null,
        cierra: exwMax != null ? n.exwCotizadoUsd <= exwMax : null,
        ...(margenCotizacion({ exwUsd: n.exwCotizadoUsd, rec, unidades: unidadesEfectivas, comisionPct }) ?? {}),
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
      origen: n.origen,
      jugadaDeKeyword: n.jugadaDe?.keyword ?? null,
      familiaAparte: n.familiaAparte ?? [],
      frecuenciaScan: n.frecuenciaScan,
      veredicto: analisis.veredicto,
      confianza: analisis.confianza ?? null,
      score: ultimo?.scoreOportunidad ?? docAnalisis.scoreOportunidad ?? null,
      fechaScan: ultimo?.fecha ?? null,
      mediana: ultimo?.metricas?.precio?.mediana ?? null,
      ventasDia: ultimo?.metricas?.demanda?.ventasEstimadasPorDia ?? null,
      tendenciaVentas: tendencia,
      scansConDemanda,
      confirmacion: confirmacionVeredicto(scansConDemanda, tendencia),
      // el programador sube a diario los preliminares con veredicto de entrada
      // hasta juntar la serie: la carta lo muestra para que se sepa que corre solo
      // mismo criterio que el programador: le faltan mediciones (no confundir
      // con el preliminar por tendencia a la baja, que ya tiene serie y lo que
      // necesita es decisión, no más scans)
      madurando:
        n.estado === 'activo' &&
        scansConDemanda < config.maduracionScans &&
        ['entrar', 'entrar_con_condiciones'].includes(analisis.veredicto) &&
        !['descartado', 'en-espera', 'vendiendo'].includes(n.etapaCompra ?? 'evaluando'),
      sellersGemelos: gemelos ? gemelos.length : null,
      gemelosDetalle: gemelos?.length
        ? gemelos.map((g) => `${g.vendedor} (+${g.reviewsNuevas} reseñas)`).join(', ')
        : null,
      pctFull: ultimo?.metricas?.competencia?.pctFull ?? null,
      sellersUnicos: ultimo?.metricas?.competencia?.sellersUnicos ?? null,
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
      ventanaImportacion: n.radarInfo?.ventanaImportacion ?? null,
      estacionalidad: n.radarInfo?.estacionalidad ?? null,
      condiciones: analisis.veredicto === 'entrar_con_condiciones' ? (analisis.resumen ?? null) : null,
      listingListo: n.tieneListing,
      estado: n.estado,
      etapaCompra: n.etapaCompra ?? 'evaluando',
      etapaCompraEl: n.etapaCompraEl ?? null,
      notaEtapa: n.notaEtapa ?? null,
      resumen: analisis.resumen ?? null,
      // los campos del proveedor: el rfq acotado (services/rfq.js) manda;
      // si no existe, lo que traiga el análisis
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
    const skus = await topSkusPorKeyword(oportunidades.map((o) => o.keyword))
    const { deMiembro, deLider } = agruparFamilias(oportunidades, skus)
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

  return oportunidades
}
