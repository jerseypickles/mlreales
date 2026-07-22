import { Nicho } from '../models/Nicho.js'
import { Snapshot } from '../models/Snapshot.js'
import { Producto } from '../models/Producto.js'
import { Reporte } from '../models/Reporte.js'

// Inspector one-shot por logs (misma mecánica que sondaReviews): con
// SONDA_NICHO_KEYWORD en el entorno, vuelca al log los nichos cuya keyword
// contenga el texto — doc del nicho + títulos del último scan — para
// diagnosticar casos de "estos productos no corresponden" sin la x-api-key.
export async function sondaNicho(fragmento) {
  const nichos = await Nicho.find({ keyword: new RegExp(fragmento, 'i') }).lean()
  if (!nichos.length) {
    console.warn(`[sonda-nicho] ningún nicho con keyword que contenga "${fragmento}"`)
    return
  }
  for (const n of nichos) {
    const reporte = await Reporte.findOne({ nichoId: n._id }).sort({ fecha: -1 }).select('scoreOportunidad fecha').lean()
    console.log(
      `[sonda-nicho] "${n.keyword}" — origen:${n.origen} estado:${n.estado} etapa:${n.etapaCompra ?? '-'} ` +
        `score:${reporte?.scoreOportunidad ?? 'null'} ideada:"${n.radarInfo?.keywordIdeada ?? '-'}" ` +
        `estacionalidad:${JSON.stringify(n.radarInfo?.estacionalidad ?? null)}`,
    )
    // ¿el analista ya pivoteó la jugada (patrón piscina) o el RFQ traduce otra cosa?
    const conAnalisis = await Reporte.findOne({ nichoId: n._id, analisis: { $ne: null } })
      .sort({ fecha: -1 })
      .select('analisis fecha')
      .lean()
    if (conAnalisis?.analisis) {
      const a = conAnalisis.analisis
      console.log(
        `[sonda-nicho]   análisis (${conAnalisis.fecha.toISOString().slice(0, 10)}): ${a.veredicto}/${a.confianza} — titular: "${a.recomendacion?.titular ?? '-'}" · segmento: "${a.recomendacion?.segmento ?? '-'}" · productoIngles: "${a.recomendacion?.productoIngles ?? '-'}"`,
      )
      console.log(
        `[sonda-nicho]   segmentos: ${(a.segmentos ?? []).map((s) => `"${s.nombre}" (${s.shareReviewsPct}% rev, ${s.atractivo})`).join(' · ')}`,
      )
      console.log(`[sonda-nicho]   rfq: ${JSON.stringify(n.rfq ?? null)}`)
      console.log(`[sonda-nicho]   resumen: ${a.resumen ?? '-'}`)
    } else {
      console.log(`[sonda-nicho]   (sin análisis)`)
    }
    const ultimo = await Snapshot.findOne({ keyword: n.keyword }).sort({ fecha: -1 }).select('fecha').lean()
    if (!ultimo) {
      console.log(`[sonda-nicho]   (sin snapshots)`)
      continue
    }
    const snaps = await Snapshot.find({ keyword: n.keyword, fecha: ultimo.fecha })
      .sort({ posicion: 1 })
      .limit(15)
      .select('sku posicion numReviews')
      .lean()
    const productos = await Producto.find({ sku: { $in: snaps.map((s) => s.sku) } })
      .select('sku titulo url')
      .lean()
    const porSku = new Map(productos.map((p) => [p.sku, p]))
    console.log(`[sonda-nicho]   scan ${ultimo.fecha.toISOString()} — top ${snaps.length}:`)
    for (const s of snaps) {
      const p = porSku.get(s.sku)
      console.log(
        `[sonda-nicho]   #${s.posicion} [${s.numReviews ?? '—'} rev] ${p?.titulo ?? '(sin título)'} · ${String(p?.url ?? '').slice(0, 90)}`,
      )
    }
  }
}
