// Pura. La marca de un ítem de Mercado Libre (atributo BRAND) como se guarda en la publicación propia: { id, nombre }.
// Con la categoría dice en qué ranking de más vendidos compite la publicación (rankingPropio.js). Con los atributos
// a la vista siempre devuelve algo (una marca escrita a mano no tiene id, y su ranking es el de la categoría sin
// filtrar); sin atributos devuelve null: no se sabe. Va en su propio archivo porque lo usan la medición de productos
// propios y el ranking, que no se importan entre sí.
export function marcaDeItem(item) {
  if (!Array.isArray(item?.attributes)) return null
  const m = item.attributes.find((a) => a?.id === 'BRAND')
  return { id: m?.value_id != null && m.value_id !== '' ? String(m.value_id) : null, nombre: m?.value_name ?? null }
}
