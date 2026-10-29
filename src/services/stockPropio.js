// Un inventory_id también puede existir en publicaciones despachadas por el vendedor.
export const usaInventarioFull = (item) => item?.shipping?.logistic_type === 'fulfillment'

export function normalizarStockPropio(propio) {
  const logistica = propio.envioMl?.logistica
  if (!logistica || logistica === 'fulfillment' || !propio.inventarioFull) return propio
  const mediciones = [...(propio.mediciones ?? [])]
  const declarado = propio.inventarioFull.declaraElItem
  if (mediciones.length && Number.isFinite(declarado)) {
    mediciones[mediciones.length - 1] = { ...mediciones.at(-1), stock: declarado }
  }
  return { ...propio, inventarioFull: null, mediciones }
}
