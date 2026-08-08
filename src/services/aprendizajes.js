import { Aprendizaje } from '../models/Aprendizaje.js'
import { Producto } from '../models/Producto.js'
import { meliGet, hayCuentaMeli } from './meli.js'

// Registra que un nicho VENDE con evidencia propia y lo ancla a su categoría
// de ML. Idempotente: si ya existe, actualiza la evidencia (las ventas cambian,
// el hecho no).
export async function registrarNichoQueVende({ nicho, ventasDia, sharePct, conversion, precio }) {
  // categoría real: la dominante entre los productos medidos del nicho
  const rutas = await Producto.aggregate([
    { $match: { keywordOrigen: nicho.keyword, categoriaML: { $ne: null } } },
    { $group: { _id: { id: '$categoriaML', ruta: '$categoriaRuta' }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ])
  const categoriaMl = rutas[0]?._id?.id ?? null
  const categoriaRuta = rutas[0]?._id?.ruta ?? null

  let categoriaPadre = null
  if (categoriaMl && (await hayCuentaMeli())) {
    try {
      const cat = await meliGet(`/categories/${categoriaMl}`)
      const camino = cat?.path_from_root ?? []
      categoriaPadre = camino.length >= 2 ? camino[camino.length - 2].id : null
    } catch {
      /* sin categoría padre igual sirve el aprendizaje */
    }
  }

  const leccion =
    `"${nicho.keyword}" VENDE con evidencia propia: ${ventasDia} u/día` +
    (sharePct != null ? ` (${sharePct}% del nicho)` : '') +
    (conversion != null ? `, conversión ${conversion}%` : '') +
    (precio ? `, a $${precio}` : '') +
    (categoriaRuta ? ` — categoría: ${categoriaRuta}` : '')

  await Aprendizaje.findOneAndUpdate(
    { tipo: 'nicho-vende', keyword: nicho.keyword },
    {
      $set: {
        nichoId: nicho._id,
        categoriaMl,
        categoriaRuta,
        categoriaPadre,
        evidencia: { ventasDia, sharePct, conversion, precio, medidoEl: new Date() },
        leccion,
        actualizadoEl: new Date(),
      },
      $setOnInsert: { primeraVezEl: new Date() },
    },
    { upsert: true },
  )
  return { categoriaMl, categoriaRuta, categoriaPadre }
}

// Categorías HERMANAS de las que ya venden: el árbol de ML sabe qué se parece
// a lo que te funciona mejor que cualquier lluvia de ideas. Devuelve nombres
// para que el sugeridor los convierta en keywords reales.
export async function hermanasDeLoQueVende({ max = 12 } = {}) {
  const probados = await Aprendizaje.find({ tipo: 'nicho-vende', categoriaPadre: { $ne: null } }).lean()
  if (!probados.length || !(await hayCuentaMeli())) return []
  const vistas = new Set(probados.map((p) => p.categoriaMl))
  const hermanas = []
  for (const p of probados) {
    try {
      const padre = await meliGet(`/categories/${p.categoriaPadre}`)
      for (const hija of padre?.children_categories ?? []) {
        if (vistas.has(hija.id) || hermanas.some((h) => h.id === hija.id)) continue
        hermanas.push({ id: hija.id, nombre: hija.name, hermanaDe: p.keyword, rama: padre.name })
        if (hermanas.length >= max) return hermanas
      }
    } catch {
      /* si ML no responde, seguimos con las demás */
    }
  }
  return hermanas
}

export async function leccionesAprendidas() {
  const todos = await Aprendizaje.find().sort({ actualizadoEl: -1 }).limit(20).lean()
  return todos.map((a) => a.leccion)
}
