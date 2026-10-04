import { Nicho } from '../models/Nicho.js'
import { Producto } from '../models/Producto.js'
import { Snapshot } from '../models/Snapshot.js'
import { RankingMasVendidos } from '../models/RankingMasVendidos.js'
import { diaChile } from './inventarioFull.js'

// ¿SE VENDE HOY EN MERCADO LIBRE? (4-oct-2026)
//
// El importador lo corrigió así: "el top vendió X, pero ¿en cuánto tiempo? Es
// un label; no podemos depender de eso". El badge "+N vendidos" se acumula desde
// que se publicó cada aviso —hace 3 meses o 5 años— y no dice nada del ritmo de
// hoy. Las dos señales de ML que SÍ tienen fecha:
//   · el ranking de más vendidos de la categoría, capturado a diario: qué
//     productos del nicho están vendiendo esta semana
//   · la baja de stock de los competidores seguidos: unidades que salieron
//     entre dos lecturas, venta real en días conocidos
// Con Google (cuánta gente lo busca) y el autocompletado (si se escribe en ML),
// es lo que separa un nicho con impresiones de un producto muerto.

const DIA = 86400e3
export const VENTANA_DIAS = 7
// un nicho nuevo tiene este plazo para mostrar demanda actual antes de la alerta
export const PLAZO_CONFIRMAR_DIAS = 14
// la regla vale para los nichos que el radar abra desde que se decidió
export const REGLA_DESDE = '2026-10-04'

// Pura. Cuántos productos del nicho están hoy en el ranking de más vendidos y
// su mejor puesto. `ids`: ids del nicho (publicación y catálogo); `ranking`:
// Map id → mejor puesto visto en la ventana.
export function enRanking(ids, ranking) {
  const vistos = [...new Set(ids)].filter((id) => ranking.has(id))
  return { productos: vistos.length, mejorPuesto: vistos.length ? Math.min(...vistos.map((id) => ranking.get(id))) : null }
}

// Pura. La lectura de un nicho: hay demanda actual si algo suyo está en el
// ranking de la semana o algún competidor seguido bajó stock.
export function lecturaDemanda({ ranking, stock }) {
  const hay = (ranking?.productos ?? 0) > 0 || (stock?.vendiendo ?? 0) > 0
  return { hayDemanda: hay, ranking, stock }
}

// Pura. ¿Corresponde la alerta? Solo nichos abiertos desde la regla, con el
// plazo cumplido y sin ninguna de las dos señales.
export function sinDemandaActual(nicho, ahora = new Date()) {
  const creado = nicho?.creadoEl ? new Date(nicho.creadoEl) : null
  if (!creado || creado.toISOString().slice(0, 10) < REGLA_DESDE) return false
  if (+ahora - +creado < PLAZO_CONFIRMAR_DIAS * DIA) return false
  return nicho?.demandaMl ? !nicho.demandaMl.hayDemanda : false
}

export async function medirDemandaActual({ ahora = new Date() } = {}) {
  const desde = diaChile(+ahora - VENTANA_DIAS * DIA)
  const ranking = new Map()
  for (const r of await RankingMasVendidos.find({ dia: { $gte: desde } }).select('items').lean()) {
    for (const i of r.items ?? []) if (i?.id && (!ranking.has(i.id) || i.posicion < ranking.get(i.id))) ranking.set(i.id, i.posicion)
  }
  let porKeyword = new Map()
  try {
    const { resumenSeguimiento } = await import('./seguimientoStock.js')
    const r = await resumenSeguimiento({ ahora })
    porKeyword = new Map((r.nichos ?? []).map((n) => [n.keyword, { seguidos: n.seguidos, vendiendo: n.vendiendo, fuertes: n.fuertes, unidadesPisoSemana: n.unidadesPisoSemana }]))
  } catch (err) {
    console.warn(`[demanda-ml] seguimiento de stock no leído: ${err.message}`)
  }
  const nichos = await Nicho.find({ estado: 'activo' }).select('keyword').lean()
  const hace14 = new Date(+ahora - 14 * DIA)
  let conDemanda = 0
  for (const n of nichos) {
    const skus = await Snapshot.distinct('sku', { keyword: n.keyword, fecha: { $gte: hace14 } })
    const prods = skus.length ? await Producto.find({ sku: { $in: skus } }).select('sku itemId catalogId').lean() : []
    const ids = prods.flatMap((p) => [p.sku, p.itemId, p.catalogId]).filter(Boolean)
    const lectura = lecturaDemanda({ ranking: enRanking(ids, ranking), stock: porKeyword.get(n.keyword) ?? null })
    if (lectura.hayDemanda) conDemanda++
    await Nicho.updateOne({ _id: n._id }, { $set: { demandaMl: { ...lectura, ventanaDias: VENTANA_DIAS, medidoEl: ahora } } })
  }
  console.log(`[demanda-ml] ${conDemanda}/${nichos.length} nichos con demanda actual en ML (ranking ${VENTANA_DIAS} días o baja de stock)`)
  return { nichos: nichos.length, conDemanda }
}
