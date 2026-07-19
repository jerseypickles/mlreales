import { Router } from 'express'
import { Nicho } from '../../models/Nicho.js'
import {
  detectarTramites,
  tendenciaVentas,
  inversionEstimadaUsd,
  unidadesPrimeraCompra,
  cambiosPorEtapa,
  ETAPAS_COMPRA,
  confirmacionVeredicto,
  exwObjetivo,
} from '../../services/oportunidades.js'
import { config } from '../../config/env.js'
import { generarRfqPendientes } from '../../services/rfq.js'
import { llmDisponible } from '../../services/llm.js'
import { calcularMargen } from '../../services/margen.js'

// Margen estimado si compras al EXW que cotizó el proveedor, con los mismos
// supuestos estándar de la tabla del análisis (volumen 0.003 m³/u, marítimo).
// Es el semáforo de la planilla; la afinación fina se hace en el simulador.
function margenCotizacion({ exwUsd, rec, unidades }) {
  if (!Number.isFinite(exwUsd) || !Number.isFinite(rec?.precioVentaClp)) return null
  try {
    const sim = calcularMargen({
      costoExwUsd: exwUsd,
      precioVentaClp: rec.precioVentaClp,
      unidades: unidades ?? 500,
      volumenM3: 0.003,
      modoFlete: 'maritimo',
      parametros: Number.isFinite(rec.comisionMlPct)
        ? { mercadoLibre: { comisionPct: rec.comisionMlPct } }
        : undefined,
    })
    return {
      margenClp: sim.porUnidad.margenClp,
      margenPct: sim.resultado.margenPctSobreVenta,
      viable: sim.resultado.viable,
    }
  } catch {
    return null
  }
}

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Panel de decisión: todos los nichos activos con veredicto de entrada,
// aplanados a una fila comparable y rankeados por score (empate: demanda).
// Con ?todos=1 devuelve TODO lo analizado (incluye no_entrar y pausados) —
// es la fuente de la planilla de recomendaciones IA.
router.get(
  '/',
  manejar(async (req, res) => {
    const todos = req.query.todos === '1' || req.query.todos === 'true'
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
          estado: 1,
          etapaCompra: 1,
          etapaCompraEl: 1,
          notaEtapa: 1,
          frecuenciaScan: 1,
          exwCotizadoUsd: 1,
          exwCotizadoEl: 1,
          radarInfo: 1,
          rfq: 1,
          ultimos: 1,
          conAnalisis: 1,
          tieneListing: { $cond: [{ $ifNull: ['$listingDraft', false] }, true, false] },
        },
      },
    ])

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
      // cotización real del proveedor: se compara contra el máximo y se estima
      // la ganancia por unidad al precio recomendado del análisis
      let cotizacion = null
      if (Number.isFinite(n.exwCotizadoUsd)) {
        cotizacion = {
          exwUsd: n.exwCotizadoUsd,
          fecha: n.exwCotizadoEl ?? null,
          cierra: exwMax != null ? n.exwCotizadoUsd <= exwMax : null,
          ...(margenCotizacion({ exwUsd: n.exwCotizadoUsd, rec, unidades: unidadesPrueba }) ?? {}),
        }
      }
      oportunidades.push({
        nichoId: n._id,
        keyword: n.keyword,
        origen: n.origen,
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
        sellersGemelos: gemelos ? gemelos.length : null,
        gemelosDetalle: gemelos?.length
          ? gemelos.map((g) => `${g.vendedor} (+${g.reviewsNuevas} reseñas)`).join(', ')
          : null,
        pctFull: ultimo?.metricas?.competencia?.pctFull ?? null,
        sellersUnicos: ultimo?.metricas?.competencia?.sellersUnicos ?? null,
        titular: rec.titular ?? null,
        segmento: rec.segmento ?? null,
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
        unidadesPrueba,
        especificacionProducto: n.rfq?.especificacion ?? rec.especificacionProducto ?? null,
        comoValidar: rec.comoValidar ?? null,
        comisionMlPct: rec.comisionMlPct ?? null,
        fechaAnalisis: analisis.generadoEl ?? docAnalisis.fecha ?? null,
      })
    }

    oportunidades.sort(
      (a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.ventasDia ?? 0) - (a.ventasDia ?? 0),
    )
    res.json({ total: oportunidades.length, oportunidades })
  }),
)

// Avanza varios nichos de etapa de una vez (ej: los incluidos en una descarga
// de planilla pasan a "cotizando")
router.post(
  '/avanzar',
  manejar(async (req, res) => {
    const { nichoIds, etapa } = req.body ?? {}
    if (!Array.isArray(nichoIds) || !nichoIds.length) {
      return res.status(400).json({ error: 'nichoIds requerido (lista no vacía)' })
    }
    if (!ETAPAS_COMPRA.includes(etapa)) {
      return res.status(400).json({ error: `etapa debe ser una de: ${ETAPAS_COMPRA.join(', ')}` })
    }
    let avanzados = 0
    for (const id of nichoIds.slice(0, 100)) {
      const nicho = await Nicho.findById(id).select('etapaCompra').lean().catch(() => null)
      if (!nicho) continue
      await Nicho.updateOne({ _id: id }, { $set: cambiosPorEtapa(etapa, nicho) })
      avanzados++
    }
    res.json({ avanzados, etapa })
  }),
)

// Acota con IA los campos del proveedor (inglés, specs limpias) para los nichos
// que no los tengan al día — una sola llamada barata, sin regenerar análisis
router.post(
  '/rfq',
  manejar(async (_req, res) => {
    if (!llmDisponible()) {
      return res.status(503).json({ error: 'IA no configurada: falta ANTHROPIC_API_KEY en el entorno' })
    }
    const resultado = await generarRfqPendientes()
    res.json(resultado)
  }),
)

export default router
