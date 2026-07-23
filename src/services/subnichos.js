import { Nicho } from '../models/Nicho.js'
import { keywordReal } from './busquedasReales.js'
import { encolarScanNicho } from '../jobs/queues.js'
import { gastoDelMes } from './gastos.js'
import { config } from '../config/env.js'

// Cierra el hoyo keyword ≠ jugada: el ranking de ML mezcla familias de
// producto bajo una búsqueda (carpa camping en invierno = 55% lonas de toldo)
// y el score del nicho es triage sobre esa mezcla. Cuando el analista
// recomienda un segmento que NO domina el top, la apuesta se mide SOLA:
// sub-nicho automático con la keyword que la aísla — sin esperar el clic del
// usuario. El ciclo de confirmación corre entonces sobre lo que de verdad se
// va a traer, no sobre la mezcla.
export async function crearSubNichoDeJugada(nicho, analisis) {
  const candidata = String(analisis.keywordJugada ?? '')
    .trim()
    .toLowerCase()
  if (!candidata || analisis.veredicto === 'no_entrar') return null
  if (candidata === nicho.keyword) return null
  // tope de UN nivel: un sub-nicho de jugada no engendra otro (la cadena
  // batidora de mano → inmersion → minipimer 5 en 1 → … quemaría scans sin
  // fin; el refinamiento extra queda en puertas laterales para clic manual)
  if (nicho.origen === 'jugada') {
    console.log(`[jugada] "${nicho.keyword}" ya es sub-nicho: "${candidata}" queda como puerta lateral manual`)
    return null
  }

  const gastado = await gastoDelMes()
  if (gastado >= config.presupuestoUsdMes) {
    console.log(`[jugada] presupuesto mensual agotado: no se mide "${candidata}"`)
    return null
  }

  // canonizar a búsqueda real (mismo criterio del radar); autosuggest caído → tal cual
  let keyword = candidata
  try {
    const real = await keywordReal(candidata)
    if (!real) {
      console.log(`[jugada] "${candidata}" no es una búsqueda real en ML: no se crea sub-nicho`)
      return null
    }
    keyword = real.keyword
  } catch {
    // 403 del autosuggest: la keyword del analista viaja tal cual
  }

  const domainCode = nicho.domainCode ?? 'CL'
  const existente = await Nicho.findOne({ keyword, domainCode })
  if (existente) return null // la jugada ya se mide (o midió) aparte

  const hijo = await Nicho.create({
    keyword,
    domainCode,
    origen: 'jugada',
    frecuenciaScan: 'semanal',
    fase: 'screening', // detalle barato hasta que su propio score lo justifique
    jugadaDe: { nichoId: String(nicho._id), keyword: nicho.keyword, generadoEl: new Date() },
  })
  await encolarScanNicho(hijo._id, { motivo: 'jugada' })
  console.log(`[jugada] "${nicho.keyword}" → sub-nicho automático "${keyword}": la apuesta se mide pura`)
  return hijo
}
