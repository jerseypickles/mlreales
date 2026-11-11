import { meliGet } from './meli.js'

// LO QUE MERCADO LIBRE PIDE PARA CADA PUBLICACIÓN (11-nov-2026).
//
// Pedido del importador: «revisa si la API de Mercado Libre tiene mejores
// endpoints». La documentación de Chile publica `/item/{id}/performance`, que
// reemplazó a `/items/{id}/health`: el puntaje de calidad que ML le pone a la
// publicación, su nivel y, uno por uno, los requisitos cumplidos y pendientes
// con su texto. Medido ese día en las publicaciones activas de la cuenta: casi
// todas estaban en el nivel medio y a todas les faltaba lo mismo.
//
// Los requisitos vienen en dos grupos. «Datos del producto» es lo que depende
// de la publicación: video, características, fotos, título, código universal.
// «Condiciones de venta» es comercial: publicar en Premium para dar cuotas,
// envío gratis, precio mayorista, promociones, Flex. Sobre el segundo el
// importador fue claro: «lo comercial no me sirve porque hace que gastemos
// más». Por eso se sigue el primero, con su puntaje propio, y del segundo solo
// se anota cuáles son, para explicar por qué el puntaje total no sube.

// Por si un requisito comercial llega fuera de su grupo (publicaciones que no
// son user product): se reconoce también por su clave.
const COMERCIAL = /FINANCING|FREE_SHIPPING|PRICE|PROMOTION|FLEX|LISTING_TYPE/

const entero = (x) => (Number.isFinite(x) ? Math.round(x) : null)

// Pura. De la respuesta de ML a lo que guarda el producto propio.
export function normalizarCalidadMl(r, { ahora = new Date() } = {}) {
  if (!r || !Array.isArray(r.buckets)) return null
  const producto = [], venta = []
  let puntajeProducto = null
  for (const b of r.buckets) {
    const grupoComercial = b.type === 'ITEM'
    if (!grupoComercial && Number.isFinite(b.score)) puntajeProducto = entero(b.score)
    for (const v of b.variables ?? []) {
      if (v.status === 'COMPLETED') continue
      const regla = (v.rules ?? []).find((x) => x.status !== 'COMPLETED') ?? v.rules?.[0]
      const pendiente = {
        clave: v.key,
        titulo: v.title ?? null,
        // lo que hay que hacer, en palabras de ML
        detalle: regla?.wordings?.title ?? null,
        // cuánto lleva cumplido, de 0 a 1: las características vienen a medias; el video es sí o no
        avance: Number.isFinite(regla?.progress) ? regla.progress : null,
      }
      if (grupoComercial || COMERCIAL.test(v.key ?? '')) venta.push(pendiente)
      else producto.push(pendiente)
    }
  }
  return {
    puntaje: entero(r.score),
    nivel: r.level_wording ?? r.level ?? null,
    puntajeProducto,
    pendientes: producto,
    // lo comercial no se sigue: queda solo qué es, para explicar el puntaje total
    comerciales: venta.map((p) => ({ clave: p.clave, titulo: p.titulo })),
    calculadaEl: r.calculated_at ?? null,
    leidaEl: ahora,
  }
}

export async function leerCalidadMl(itemId) {
  return normalizarCalidadMl(await meliGet(`/item/${itemId}/performance`))
}

// ML recalcula el puntaje una vez al día: no hace falta leerlo en cada medición.
export const CALIDAD_ML_CADA_MS = 6 * 3600e3
export function tocaLeerCalidadMl(guardada, ahora = new Date()) {
  const leida = guardada?.leidaEl ? new Date(guardada.leidaEl).getTime() : null
  return !(Number.isFinite(leida) && ahora.getTime() - leida < CALIDAD_ML_CADA_MS)
}
