import { Nicho } from '../models/Nicho.js'
import { obtenerProductosUltimoScan, unidadesDelTitulo } from './metricas.js'

// Surtido que le falta al catálogo propio: productos del top que VENDEN AHORA
// en un formato (piezas/pack) que el vendedor no cubre. Sin LLM — sale del
// scan que ya se pagó: quién vende, a cuánto y con qué respaldo de reseñas.
const MULTIPLO_FORMATO_DISTINTO = 1.5

export async function surtidoQueFalta(nichoId, propiosDelNicho, { max = 4 } = {}) {
  const nicho = await Nicho.findById(nichoId).select('keyword').lean()
  if (!nicho) return null
  const vista = await obtenerProductosUltimoScan(nicho)
  if (!vista?.productos?.length) return null

  // formatos que YA cubro (piezas declaradas en mis títulos)
  const misFormatos = propiosDelNicho.map((p) => unidadesDelTitulo(p.titulo) ?? 1)
  const miTecho = Math.max(1, ...misFormatos)
  const miPrecio = Math.max(0, ...propiosDelNicho.map((p) => (p.mediciones ?? []).at(-1)?.precio ?? 0))

  const candidatos = vista.productos
    .map((p) => ({ ...p, unidades: unidadesDelTitulo(p.titulo) ?? null }))
    .filter((p) => {
      if (!p.imagen || !Number.isFinite(p.precio)) return false
      // vende de verdad: velocidad medida o respaldo de reseñas acumuladas
      if (!(p.ventasDia > 0 || (p.numReviews ?? 0) >= 50)) return false
      // formato distinto al mío: más piezas, o el mismo pero a ticket mayor
      const formatoMayor = p.unidades != null && p.unidades >= miTecho * MULTIPLO_FORMATO_DISTINTO
      const ticketMayor = miPrecio > 0 && p.precio >= miPrecio * 2
      return formatoMayor || ticketMayor
    })
    .sort((a, b) => (b.ventasDia ?? 0) - (a.ventasDia ?? 0) || (b.numReviews ?? 0) - (a.numReviews ?? 0))

  // uno por formato: no repetir cuatro veces el mismo tamaño de pack
  const vistos = new Set()
  const elegidos = []
  for (const c of candidatos) {
    const clave = c.unidades ?? `p${Math.round(c.precio / 5000)}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    elegidos.push({
      sku: c.sku,
      titulo: c.titulo,
      url: c.url,
      imagen: c.imagen,
      precio: c.precio,
      unidades: c.unidades,
      numReviews: c.numReviews,
      ventasDia: c.ventasDia,
      vendedor: c.vendedor,
      esFull: c.esFull,
    })
    if (elegidos.length >= max) break
  }
  if (!elegidos.length) return null
  return { keyword: nicho.keyword, miTecho, sugeridos: elegidos }
}
