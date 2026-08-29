import { meliGet, hayCuentaMeli } from './meli.js'

// SEÑALES QUE ML PUBLICA GRATIS Y NO ESTÁBAMOS PIDIENDO.
//
// Todo lo que este sistema sabe de demanda sale de scrapear el listado y de
// Google Ads. Pero ML publica dos cosas por su API oficial, sin costo y sin
// riesgo de bloqueo, que responden preguntas que hoy contestamos peor:
//
//   /highlights/MLC/category/{id}   el ranking de MÁS VENDIDOS de la categoría,
//                                   dicho por ML. No es una estimación nuestra
//                                   sobre reseñas: es su propio ranking.
//
//   /trends/MLC/{id}                las búsquedas que suben en esa categoría,
//                                   con la keyword tal como la escribe la gente
//                                   —"philips lumea ipl 9000", no "depiladora"—.
//
// Las dos son gratis y no las puede suspender una cuenta de scraping. Descubierto
// el 29-ago-2026 probando qué más da la API oficial además del conteo de reseñas.

// Pura. `highlights` mezcla productos de catálogo (PRODUCT) y publicaciones de
// vendedor (USER_PRODUCT). Los ids no son intercambiables: el catálogo es
// MLC…, la publicación MLCU…, y nuestro sku sale de la URL, que puede ser
// cualquiera de los dos.
export function normalizarDestacados(raw) {
  const filas = raw?.content ?? []
  return filas
    .filter((f) => f?.id)
    .map((f) => ({
      id: String(f.id),
      posicion: Number(f.position) || null,
      tipo: f.type === 'USER_PRODUCT' ? 'publicacion' : 'catalogo',
    }))
}

// Pura. Las tendencias vienen como {keyword, url}; solo interesa la keyword,
// limpia y sin repetir.
export function normalizarTendencias(raw) {
  const vistas = new Set()
  const salida = []
  for (const f of raw ?? []) {
    const k = String(f?.keyword ?? '').trim().toLowerCase()
    if (!k || vistas.has(k)) continue
    vistas.add(k)
    salida.push(k)
  }
  return salida
}

// Pura. Cuántos de los más vendidos de ML aparecen en el top que medimos.
//
// Es un control de calidad del scrapeo, no un score: si ML dice que los diez
// más vendidos de la categoría son estos y nuestro top 50 no contiene ninguno,
// estamos midiendo un listado que no es el que compra la gente —keyword mal
// elegida, o el scrapeo trajo otra cosa.
export function cruceConDestacados(destacados, skusMedidos) {
  const medidos = new Set(skusMedidos ?? [])
  const enTop = (destacados ?? []).filter((d) => medidos.has(d.id))
  const total = (destacados ?? []).length
  return {
    destacados: total,
    enNuestroTop: enTop.length,
    pct: total ? Math.round((enTop.length / total) * 100) : null,
    faltantes: (destacados ?? []).filter((d) => !medidos.has(d.id)).slice(0, 10).map((d) => d.id),
  }
}

// Nunca rompe: estas señales enriquecen, no sostienen. Un nicho sin categoría
// medida o una API que no responde no puede voltear un scan.
export async function masVendidosDeCategoria(categoriaId, { site = 'MLC' } = {}) {
  if (!categoriaId || !(await hayCuentaMeli())) return null
  try {
    return normalizarDestacados(await meliGet(`/highlights/${site}/category/${categoriaId}`))
  } catch (err) {
    console.warn(`[senales-oficiales] highlights de ${categoriaId}: ${err.message}`)
    return null
  }
}

export async function tendenciasDeCategoria(categoriaId, { site = 'MLC', limite = 20 } = {}) {
  if (!(await hayCuentaMeli())) return null
  const ruta = categoriaId ? `/trends/${site}/${categoriaId}` : `/trends/${site}`
  try {
    return normalizarTendencias(await meliGet(ruta)).slice(0, limite)
  } catch (err) {
    console.warn(`[senales-oficiales] trends de ${categoriaId ?? site}: ${err.message}`)
    return null
  }
}
