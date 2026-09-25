import { Nicho } from '../../models/Nicho.js'
import { Reporte } from '../../models/Reporte.js'

// ¿QUÉ SEÑAL DESCUBRE BUENOS NICHOS?
//
// El importador (25-sep-2026): "el learning machine será a futuro el
// comandante". El primer paso es que el sistema sepa de dónde salió cada nicho
// del radar —ranking de ML, búsqueda que sube, producto que despega, tienda
// ganadora, autocompletado, temporada, categoría hermana, pasillo probado o
// intuición de la IA— y lo cruce con cómo le fue: veredicto del analista,
// puntaje, si llegó a cotizarse o comprarse. Con muestra suficiente, el
// resultado vuelve al radar para que pese más lo que rinde.

export const MINIMO_POR_FUENTE = 10
const AVANZADO = ['cotizando', 'pedido', 'vendiendo']

// Pura. nichos: {radarInfo, etapaCompra, estado}; veredictos: Map(nichoId → {veredicto, score})
export function rendimientoPorFuente(nichos, veredictos) {
  const porFuente = new Map()
  for (const n of nichos) {
    const fuente = n.radarInfo?.fuente ?? 'sin-registrar'
    const f = porFuente.get(fuente) ?? { fuente, nichos: 0, conVeredicto: 0, entrar: 0, condiciones: 0, noEntrar: 0, puntajes: [], avanzados: 0 }
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
    porFuente.set(fuente, f)
  }
  return [...porFuente.values()].map(({ puntajes, ...f }) => ({ ...f,
    tasaEntrar: f.conVeredicto ? Math.round(f.entrar / f.conVeredicto * 100) : null,
    tasaNoEntrar: f.conVeredicto ? Math.round(f.noEntrar / f.conVeredicto * 100) : null,
    puntajeMedio: puntajes.length ? Math.round(puntajes.reduce((a, b) => a + b, 0) / puntajes.length) : null,
    conMuestra: f.conVeredicto >= MINIMO_POR_FUENTE,
  })).sort((a, b) => b.nichos - a.nichos)
}

export async function fuentesDelRadar() {
  const nichos = await Nicho.find({ origen: 'radar' }).select('radarInfo.fuente radarInfo.descubiertoEl etapaCompra estado').lean()
  const ultimos = await Reporte.aggregate([
    { $match: { nichoId: { $in: nichos.map((n) => n._id) }, 'analisis.veredicto': { $exists: true } } },
    { $sort: { fecha: -1 } },
    { $group: { _id: '$nichoId', veredicto: { $first: '$analisis.veredicto' }, score: { $first: '$scoreOportunidad' } } },
  ])
  const veredictos = new Map(ultimos.map((r) => [String(r._id), r]))
  return { desde: '2026-09-25', fuentes: rendimientoPorFuente(nichos, veredictos) }
}

// Las líneas que lee el radar: solo fuentes con muestra, y nunca "sin registrar"
// (los nichos anteriores al 25-sep no dicen de dónde salieron).
export async function historialParaRadar() {
  const { fuentes } = await fuentesDelRadar()
  return fuentes.filter((f) => f.conMuestra && f.fuente !== 'sin-registrar')
    .map((f) => `- ${f.fuente}: ${f.nichos} nichos, ${f.tasaEntrar}% terminó en "entrar" y ${f.tasaNoEntrar}% en "no entrar", puntaje medio ${f.puntajeMedio ?? '?'}${f.avanzados ? `, ${f.avanzados} llegaron a cotización o compra` : ''}`)
}
