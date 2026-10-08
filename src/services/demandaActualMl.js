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

// ─── EL RANKING EN EL TIEMPO (8-oct-2026) ─────────────────────────────────────
// El importador pidió tres usos que faltaban: ver si SUS productos están en el
// ranking de más vendidos y en qué puesto, si cada nicho viene subiendo o
// bajando en el ranking, y que eso pese en el score. Hasta acá el ranking solo
// se usaba como sí/no ("hay algo esta semana").
export const DIAS_TENDENCIA = 21

// Pura. Por día: cuántos de `ids` aparecen en algún ranking y su mejor puesto.
// `indice`: Map id → [{ dia, posicion }].
export function serieRanking(ids, indice, dias) {
  return dias.map((dia) => {
    let productos = 0, mejor = null
    for (const id of new Set(ids)) {
      const p = (indice.get(id) ?? []).filter((x) => x.dia === dia).map((x) => x.posicion).filter(Number.isFinite)
      if (p.length) { productos++; const m = Math.min(...p); if (mejor == null || m < mejor) mejor = m }
    }
    return { dia, productos, mejor }
  })
}

// Pura. La última semana contra las dos anteriores: ¿más productos del nicho en
// el ranking, o mejor puesto? 'sube' / 'baja' / 'estable' / 'fuera' (no
// aparece en ninguna) / 'nuevo' (aparece ahora y antes no había historia).
export function tendenciaRanking(serie) {
  const ult = serie.slice(-7), antes = serie.slice(-DIAS_TENDENCIA, -7)
  const prom = (xs, k) => { const v = xs.map((x) => x[k]).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
  const conAhora = ult.filter((d) => d.productos > 0).length, conAntes = antes.filter((d) => d.productos > 0).length
  const pAhora = prom(ult, 'productos'), pAntes = prom(antes, 'productos')
  const mAhora = prom(ult.filter((d) => d.mejor != null), 'mejor'), mAntes = prom(antes.filter((d) => d.mejor != null), 'mejor')
  const base = { productosAhora: pAhora != null ? Math.round(pAhora * 10) / 10 : 0, productosAntes: pAntes != null ? Math.round(pAntes * 10) / 10 : null,
    mejorAhora: mAhora != null ? Math.round(mAhora) : null, mejorAntes: mAntes != null ? Math.round(mAntes) : null, diasAhora: conAhora, diasAntes: conAntes }
  if (!conAhora && !conAntes) return { ...base, estado: 'fuera' }
  if (!antes.length) return { ...base, estado: conAhora ? 'nuevo' : 'fuera' }
  if (conAhora && !conAntes) return { ...base, estado: 'sube' }
  if (!conAhora && conAntes) return { ...base, estado: 'baja' }
  const masProductos = pAhora - pAntes, mejoraPuesto = mAntes != null && mAhora != null ? mAntes - mAhora : 0
  if (masProductos >= 0.5 || mejoraPuesto >= 3) return { ...base, estado: 'sube' }
  if (masProductos <= -0.5 || mejoraPuesto <= -3) return { ...base, estado: 'baja' }
  return { ...base, estado: 'estable' }
}

// Pura. Lo que la tendencia del ranking mueve el score del nicho, en puntos.
// Pesos INICIALES y chicos a propósito: se aplican al leer la mesa (la serie de
// scores exige una sola fórmula) y se calibrarán cuando haya evidencia de que
// anticipan algo. Pedido del importador del 8-oct.
export const AJUSTE_RANKING = { sube: 3, nuevo: 2, estable: 1, baja: -2, fuera: 0 }
export function ajustePorRanking(t) {
  if (!t?.estado) return 0
  if (t.estado === 'estable' && (t.mejorAhora ?? 99) <= 5) return 2
  return AJUSTE_RANKING[t.estado] ?? 0
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
  const desdeTendencia = diaChile(+ahora - DIAS_TENDENCIA * DIA)
  const ranking = new Map()
  const indice = new Map() // id → [{ dia, posicion }] de las últimas 3 semanas
  for (const r of await RankingMasVendidos.find({ dia: { $gte: desdeTendencia } }).select('dia items').lean()) {
    for (const i of r.items ?? []) {
      if (!i?.id) continue
      indice.set(i.id, [...(indice.get(i.id) ?? []), { dia: r.dia, posicion: i.posicion }])
      if (r.dia >= desde && (!ranking.has(i.id) || i.posicion < ranking.get(i.id))) ranking.set(i.id, i.posicion)
    }
  }
  const dias = Array.from({ length: DIAS_TENDENCIA }, (_, k) => diaChile(+ahora - (DIAS_TENDENCIA - k) * DIA))
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
    const tendencia = tendenciaRanking(serieRanking(ids, indice, dias))
    await Nicho.updateOne({ _id: n._id }, { $set: { demandaMl: { ...lectura, tendenciaRanking: tendencia, ventanaDias: VENTANA_DIAS, medidoEl: ahora } } })
  }
  console.log(`[demanda-ml] ${conDemanda}/${nichos.length} nichos con demanda actual en ML (ranking ${VENTANA_DIAS} días o baja de stock)`)
  const propios = await rankingDePropios({ ahora, indice, dias }).catch((e) => ({ error: e.message }))
  return { nichos: nichos.length, conDemanda, propios }
}

// TUS PRODUCTOS EN EL RANKING. El ranking no usa el id de la publicación: usa
// el del producto de usuario (MLCU…) o el de catálogo. Se piden una vez por
// producto a /items (gratis) y se guardan; después, el puesto de cada día.
export async function rankingDePropios({ ahora = new Date(), indice, dias, pedir = null } = {}) {
  const { ProductoPropio } = await import('../models/ProductoPropio.js')
  const obtener = pedir ?? (await import('./meli.js')).meliGet
  const propios = await ProductoPropio.find({}).select('itemIdMl sku titulo idsRanking').lean()
  const capturadas = new Set(await RankingMasVendidos.distinct('categoriaId', { dia: { $gte: dias[0] } }))
  let conPuesto = 0
  for (const p of propios) {
    const id = p.itemIdMl ?? p.sku
    let ids = p.idsRanking
    if (!ids) {
      const it = await obtener(`/items/${id}`).catch(() => null)
      if (!it) continue
      ids = { userProductId: it.user_product_id ?? null, catalogProductId: it.catalog_product_id ?? null, categoriaId: it.category_id ?? null }
    }
    const buscar = [ids.userProductId, ids.catalogProductId, id].filter(Boolean)
    const serie = serieRanking(buscar, indice, dias)
    const ultimo = [...serie].reverse().find((d) => d.mejor != null) ?? null
    if (ultimo) conPuesto++
    await ProductoPropio.updateOne({ _id: p._id }, { $set: { idsRanking: ids, rankingMl: {
      puestoActual: serie.at(-1)?.mejor ?? null, ultimoVisto: ultimo, serie: serie.map((d) => ({ dia: d.dia, puesto: d.mejor })),
      tendencia: tendenciaRanking(serie), categoriaCapturada: ids.categoriaId ? capturadas.has(ids.categoriaId) : null, medidoEl: ahora } } })
  }
  return { productos: propios.length, conPuesto }
}
