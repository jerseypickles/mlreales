// ¿Este producto del ranking es de la búsqueda del nicho? El ranking es de
// TODA la categoría de ML: en "mesa auxiliar" entran mesas plegables y de
// centro. Calza si trae todas las palabras de la keyword (con plurales).
const raiz = (w) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/(es|s)$/, '')
export function calzaConBusqueda(titulo, keyword) {
  const palabras = String(titulo ?? '').split(/[^\p{L}\p{N}]+/u).map(raiz)
  return String(keyword ?? '').split(/\s+/).filter((w) => w.length >= 3).map(raiz)
    .every((k) => palabras.some((w) => w.startsWith(k)))
}
