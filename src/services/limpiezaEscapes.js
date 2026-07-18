import { Reporte } from '../models/Reporte.js'
import { Nicho } from '../models/Nicho.js'
import { decodificarEscapes } from './texto.js'

// Reparación one-shot al arranque: análisis y listings guardados con escapes
// doble-codificados ("Depilación" literal) se decodifican en la base.
// Idempotente: los documentos limpios no se tocan; corre en segundos.
export async function limpiarEscapesGuardados() {
  let arreglados = 0

  const reportes = await Reporte.find({ analisis: { $ne: null } }).select('analisis').lean()
  for (const r of reportes) {
    const limpio = decodificarEscapes(r.analisis)
    if (JSON.stringify(limpio) !== JSON.stringify(r.analisis)) {
      await Reporte.updateOne({ _id: r._id }, { $set: { analisis: limpio } })
      arreglados++
    }
  }

  const nichos = await Nicho.find({
    $or: [{ listingDraft: { $ne: null } }, { rfq: { $ne: null } }, { radarInfo: { $ne: null } }],
  })
    .select('listingDraft rfq radarInfo')
    .lean()
  for (const n of nichos) {
    const cambios = {}
    for (const campo of ['listingDraft', 'rfq', 'radarInfo']) {
      if (!n[campo]) continue
      const limpio = decodificarEscapes(n[campo])
      if (JSON.stringify(limpio) !== JSON.stringify(n[campo])) cambios[campo] = limpio
    }
    if (Object.keys(cambios).length) {
      await Nicho.updateOne({ _id: n._id }, { $set: cambios })
      arreglados++
    }
  }

  if (arreglados) console.log(`[limpieza] ${arreglados} documento(s) con escapes doble-codificados reparados`)
  return { arreglados }
}
