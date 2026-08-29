import { reviewsOficialesSeguro } from './meli.js'

// RESEÑAS POR LA API OFICIAL, PARA TODO EL LISTADO Y GRATIS.
//
// El conteo de reseñas es la base de la señal de demanda y hoy sale del nivel 2:
// un request de navegador por ficha, sobre el top 50. `/reviews/item/{itemId}`
// devuelve `paging.total` sin costo y responde para el listado completo —medido
// el 29-ago-2026: 109/109 en "cama perro" y 97/97 en "freidora de aire", a
// ~285 ms por item.
//
// OJO: NO ES EL MISMO NÚMERO. La API cuenta las reseñas de la PUBLICACIÓN; la
// ficha muestra a veces el agregado del CATÁLOGO, sumando a todos los
// vendedores del mismo producto. Razones medidas contra la ficha: 1,000 /
// 1,005 / 0,997 / 1,013 / 0,966 / 0,919 / 0,297. Esa última —ficha 5.765, API
// 1.713— no es ruido.
//
// Por eso esto NO reemplaza nada todavía: se guarda al lado en
// `Snapshot.numReviewsApi` para poder comparar cuál de las dos series es más
// estable. La hipótesis es que la de la API lo sea más, porque al ser por
// publicación no sufre los saltos de catálogo que hubo que filtrar en julio.
// Se demuestra con una serie, no con una foto.
//
// Es best-effort de punta a punta: esto se cuelga de un scan que ya funciona y
// jamás debe voltearlo.

// la API oficial responde en ~285 ms; de a 6 el listado entero sale en ~5 s
const CONCURRENCIA = 6
// techo duro: con 100 items y todo lento, antes que retrasar el scan se entrega
// lo que se alcanzó a medir
const PRESUPUESTO_MS = 60_000

export async function conteosPorItem(itemIds, { concurrencia = CONCURRENCIA, presupuestoMs = PRESUPUESTO_MS } = {}) {
  const pendientes = [...new Set((itemIds ?? []).filter(Boolean))]
  const porItem = new Map()
  if (!pendientes.length) return porItem

  const limite = Date.now() + presupuestoMs
  let cursor = 0
  let agotado = false

  async function obrero() {
    while (cursor < pendientes.length) {
      if (Date.now() > limite) {
        agotado = true
        return
      }
      const id = pendientes[cursor++]
      // reviewsOficialesSeguro ya nunca lanza: devuelve null y loguea
      const r = await reviewsOficialesSeguro(id)
      if (Number.isFinite(r?.numReviews)) porItem.set(id, r.numReviews)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrencia, pendientes.length) }, () => obrero()))

  if (agotado) {
    console.warn(
      `[reviews-api] presupuesto agotado: ${porItem.size}/${pendientes.length} items medidos`,
    )
  }
  return porItem
}

// Pura. Pega los conteos sobre los items ya normalizados, sin tocar nada más.
// Devuelve cuántos se pudieron poblar, para que el worker lo pueda reportar.
export function aplicarConteos(items, porItem) {
  let poblados = 0
  for (const it of items ?? []) {
    const id = it?.producto?.itemId
    if (!id) continue
    const n = porItem.get(id)
    if (!Number.isFinite(n)) continue
    it.snapshot.numReviewsApi = n
    poblados++
  }
  return poblados
}
