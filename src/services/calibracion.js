// Factor reseñas→ventas OBSERVADO en la cuenta propia: ventas reales
// sincronizadas (orders) vs reseñas nuevas de las publicaciones propias en el
// mismo lapso. Es el ancla que convierte el 25 teórico en dato — se afina solo
// a medida que la tienda vende.

// Función pura (testeable): propios con su serie de mediciones + ventas crudas.
export function calibracionFactor(propios, ventas) {
  const skusPropios = new Set(propios.flatMap((p) => [p.sku, p.itemIdMl].filter(Boolean)))
  const unidadesDe = (v) =>
    (v.items ?? [])
      .filter((i) => skusPropios.has(i.itemId))
      .reduce((a, i) => a + (i.cantidad ?? 0), 0)
  const propias = (ventas ?? []).filter((v) => v.fecha && unidadesDe(v) > 0)
  if (!propias.length) return null

  const desde = new Date(Math.min(...propias.map((v) => new Date(v.fecha).getTime())))
  const unidades = propias.reduce((s, v) => s + unidadesDe(v), 0)

  // reseñas nuevas propias desde la primera venta: última medición vs la
  // medición vigente en ese momento (las reseñas llegan días después de la
  // venta, así que el factor parte alto y converge con el tiempo)
  let resenasNuevas = 0
  for (const p of propios) {
    const serie = (p.mediciones ?? []).filter((m) => Number.isFinite(m.numReviews))
    if (!serie.length) continue
    const base = [...serie].reverse().find((m) => new Date(m.fecha) <= desde) ?? serie[0]
    resenasNuevas += Math.max(0, serie[serie.length - 1].numReviews - base.numReviews)
  }

  return {
    desde,
    ventas: unidades,
    resenasNuevas,
    factorObservado: resenasNuevas > 0 ? Math.round((unidades / resenasNuevas) * 10) / 10 : null,
  }
}
