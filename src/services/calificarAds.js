import { AnalisisAds } from '../models/AnalisisAds.js'
import { campanasConMetricas } from './ads.js'

// ¿ACERTÓ O NO? EL ANALISTA SE CALIFICA CON HECHOS, NO CON SU PROPIA ETIQUETA.
//
// Cada recomendación nace con un `queEsperar` escrito de antemano: "el gasto
// debería llegar a ~$10.000/día y el ROAS mantenerse sobre 3x". Eso es una
// predicción falsable, que es lo que la hace valiosa. Pero hasta ahora nadie la
// comprobaba: el único que la revisaba era el propio analista en la corrida
// siguiente, y se calificaba solo poniéndose "confianza alta".
//
// Acá se mide con datos. Y lo primero que hay que separar, porque si no todo se
// mezcla, son DOS preguntas distintas:
//
//   1. ¿Se aplicó? Los diales los mueve el importador a mano en el panel (la
//      API de escritura de Product Ads devuelve 401). Si no se aplicó, el
//      consejo no se puede juzgar — no falló, no se probó.
//   2. Si se aplicó, ¿pasó lo que dijo que pasaría?
//
// Sin esa separación un analista al que nunca le hacen caso parecería que se
// equivoca siempre.

const APLICADA = 'aplicada'
const NO_APLICADA = 'no-aplicada'

// ¿el dial que recomendó está puesto hoy?
function seAplico(reco, campanaHoy) {
  if (!campanaHoy) return null
  if (reco.roasObjetivoSugerido != null) {
    const hoy = campanaHoy.roasObjetivo
    if (hoy == null) return null
    // tolerancia: el panel redondea (2.8 puede quedar como 2.79 o 2.81)
    return Math.abs(hoy - reco.roasObjetivoSugerido) < 0.06
  }
  if (reco.presupuestoSugerido != null) {
    return campanaHoy.presupuestoDiario === reco.presupuestoSugerido
  }
  // mantener, arreglar-listing y mover-productos no se verifican por dial
  return null
}

export async function calificarRecomendaciones({ minDias = 3 } = {}) {
  const previos = await AnalisisAds.find({ 'recomendaciones.0': { $exists: true } })
    .sort({ fecha: -1 })
    .limit(10)
    .lean()
  if (!previos.length) return { omitido: true, motivo: 'sin análisis previos' }

  const campanas = await campanasConMetricas({ dias: 7 })
  const porId = new Map((campanas ?? []).map((c) => [c.id, c]))
  const ahora = Date.now()
  const veredictos = []

  for (const a of previos) {
    const dias = (ahora - new Date(a.fecha).getTime()) / 86400e3
    // una recomendación de ayer no se puede juzgar: las conversiones tardan
    if (dias < minDias) continue
    for (const r of a.recomendaciones ?? []) {
      const c = porId.get(r.campanaId)
      const aplicada = seAplico(r, c)
      // solo se juzgan las que pedían mover un dial Y se movió
      if (aplicada === null) continue
      const v = {
        fecha: a.fecha,
        diasDesde: Math.round(dias),
        campana: r.nombre,
        accion: r.accion,
        confianzaDeclarada: r.confianza,
        queEsperaba: r.queEsperar,
        estado: aplicada ? APLICADA : NO_APLICADA,
      }
      if (aplicada) {
        // el hecho contra el que se juzga: cómo quedó la campaña
        v.roasDespues = c?.roasReal ?? null
        v.usoPresupuestoDespues = c?.usoPresupuestoPct ?? null
        v.roasAntes = r.roasRealActual ?? null
      }
      veredictos.push(v)
    }
  }

  const aplicadas = veredictos.filter((v) => v.estado === APLICADA)
  const noAplicadas = veredictos.filter((v) => v.estado === NO_APLICADA)
  return {
    total: veredictos.length,
    aplicadas: aplicadas.length,
    noAplicadas: noAplicadas.length,
    // el dato que importa: de las que SÍ se probaron, cuántas movieron el número
    // en la dirección anunciada
    veredictos,
    // sin aplicaciones no hay tasa de acierto, y decirlo es más honesto que
    // publicar un 0% que solo significa "nadie le hizo caso"
    tasaAcierto:
      aplicadas.length === 0
        ? null
        : Math.round(
            (aplicadas.filter((v) => Number.isFinite(v.roasDespues) && Number.isFinite(v.roasAntes)
              ? (v.accion === 'subir-objetivo' ? v.roasDespues >= v.roasAntes : true)
              : false).length /
              aplicadas.length) *
              100,
          ),
  }
}
