import { Router } from 'express'
import { Nicho } from '../../models/Nicho.js'
import {
  detectarTramites,
  tendenciaVentas,
  inversionEstimadaUsd,
} from '../../services/oportunidades.js'

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
        $project: {
          keyword: 1,
          origen: 1,
          estado: 1,
          frecuenciaScan: 1,
          radarInfo: 1,
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
        tendenciaVentas: tendenciaVentas(n.ultimos?.[0], n.ultimos?.[1]),
        pctFull: ultimo?.metricas?.competencia?.pctFull ?? null,
        sellersUnicos: ultimo?.metricas?.competencia?.sellersUnicos ?? null,
        titular: rec.titular ?? null,
        segmento: rec.segmento ?? null,
        precioVentaClp: rec.precioVentaClp ?? null,
        fobMaximoUsd: rec.fobMaximoUsd ?? null,
        primeraCompra: rec.primeraCompra ?? null,
        inversionEstimadaUsd: inversionEstimadaUsd(rec.primeraCompra, rec.fobMaximoUsd),
        // análisis nuevos lo declaran estructurado; los viejos caen al detector de texto
        tramites: Array.isArray(analisis.tramites)
          ? analisis.tramites
          : detectarTramites([...(analisis.riesgos ?? []), n.radarInfo?.riesgo]),
        ventanaImportacion: n.radarInfo?.ventanaImportacion ?? null,
        estacionalidad: n.radarInfo?.estacionalidad ?? null,
        condiciones: analisis.veredicto === 'entrar_con_condiciones' ? (analisis.resumen ?? null) : null,
        listingListo: n.tieneListing,
        estado: n.estado,
        resumen: analisis.resumen ?? null,
        especificacionProducto: rec.especificacionProducto ?? null,
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

export default router
