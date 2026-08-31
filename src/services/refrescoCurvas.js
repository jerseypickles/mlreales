import { CurvaEstacional } from '../models/CurvaEstacional.js'
import { Nicho } from '../models/Nicho.js'

// LA CURVA DE BÚSQUEDA SE MEDÍA UNA VEZ Y NUNCA MÁS.
//
// `calcularMetricas` la mide solo si falta (`if (!tiene)`), así que un nicho
// creado en julio seguía mostrando el volumen de julio. Medido el 30-ago-2026:
// 54 de 84 nichos activos tenían la curva de hace ~46 días.
//
// Para la FORMA del año eso da igual —la estacionalidad de un árbol de navidad
// no cambia mes a mes— pero `busquedasMes` sí se mueve: Google devuelve el
// promedio de los últimos 12 meses, y cada mes entra uno nuevo y sale el más
// viejo. Un nicho que viene entrando en temporada puede haber subido bastante
// desde que se midió.
//
// Refrescar es barato de verdad: DataForSEO cobra POR REQUEST y no por
// keyword, y entran 1.000 por llamada. Los 84 nichos son UNA llamada de
// US$0,09 al mes. No refrescarlos no ahorraba nada.

// un mes: el promedio móvil de 12 meses no se mueve más rápido que eso
const VIGENCIA_DIAS = 30
// tope por pasada, para que una corrida no barra la mesa entera de golpe si
// algo salió mal y todas quedaron viejas a la vez
const POR_PASADA = 200

// Pura. Cuáles hay que volver a medir: las de nichos activos cuya medición
// pasó la vigencia. Las que nunca se midieron no entran acá — de esas se
// encarga `calcularMetricas`, que las mide al primer reporte.
export function aRefrescar(curvas, { ahora = Date.now(), vigenciaDias = VIGENCIA_DIAS } = {}) {
  const corte = ahora - vigenciaDias * 86400e3
  return curvas
    .filter((c) => c.medidoEl && new Date(c.medidoEl).getTime() < corte)
    .sort((a, b) => new Date(a.medidoEl) - new Date(b.medidoEl))
    .map((c) => c.keyword)
}

export async function refrescarCurvasVencidas({ vigenciaDias = VIGENCIA_DIAS, limite = POR_PASADA } = {}) {
  const activos = await Nicho.find({ estado: 'activo' }).select('keyword').lean()
  if (!activos.length) return { omitido: true, motivo: 'sin nichos activos' }

  const curvas = await CurvaEstacional.find({ keyword: { $in: activos.map((n) => n.keyword) } })
    .select('keyword medidoEl')
    .lean()
  const vencidas = aRefrescar(curvas, { vigenciaDias }).slice(0, limite)
  if (!vencidas.length) {
    return { refrescadas: 0, motivo: `las ${curvas.length} curvas están dentro de los ${vigenciaDias} días` }
  }

  const { medirAtractivo } = await import('./atractivoNicho.js')
  // `medirAtractivo` ya pide en lote y actualiza por upsert, así que refrescar
  // es volver a llamarlo con las vencidas
  await medirAtractivo(vencidas, { conCrecimiento: true })
  console.log(`[refresco-curvas] ${vencidas.length} curva(s) re-medidas (vencían a los ${vigenciaDias} días)`)
  return { refrescadas: vencidas.length, keywords: vencidas.slice(0, 10) }
}
