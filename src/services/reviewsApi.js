
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

// ML CORTA DESPUÉS DE ~115 CONSULTAS SEGUIDAS. Medido el 17-sep-2026 en el primer
// scan de 4 páginas ("gafas de sol", 202 publicaciones): las primeras 116
// respondieron y las 86 siguientes volvieron 429 "too many requests", todas en 4
// segundos. Con 100 publicaciones por scan el límite casi no se tocaba; con 200
// se pierde el 43% de la canasta. Tres cosas: menos en paralelo, y ante un 429
// TODOS los obreros se frenan unos segundos y esa publicación se reintenta — sin
// el freno compartido cada obrero sigue disparando y el castigo se alarga.
const CONCURRENCIA = 3
// techo duro: con 200 items y todo lento, antes que retrasar el scan se entrega
// lo que se alcanzó a medir
const PRESUPUESTO_MS = 150_000
const PAUSA_429_MS = 4_000
const REINTENTOS = 3
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

// Una consulta que distingue "ML me frenó" de "no hay dato": la versión segura
// de meli.js se traga el error y acá hace falta verlo.
async function contarUna(id) {
  try {
    const { meliGet } = await import('./meli.js')
    const { resumenReviewsOficiales } = await import('./meli.js')
    return { numReviews: resumenReviewsOficiales(await meliGet(`/reviews/item/${id}`))?.numReviews ?? null }
  } catch (err) {
    return { frenado: /\b429\b|too many/i.test(err.message), error: err.message }
  }
}

export async function conteosPorItem(itemIds, { concurrencia = CONCURRENCIA, presupuestoMs = PRESUPUESTO_MS, contar = contarUna, pausaMs = PAUSA_429_MS } = {}) {
  const pendientes = [...new Set((itemIds ?? []).filter(Boolean))].map((id) => ({ id, intentos: 0 }))
  const porItem = new Map()
  if (!pendientes.length) return porItem

  const limite = Date.now() + presupuestoMs
  let agotado = false
  let frenadoHasta = 0
  let frenos = 0

  async function obrero() {
    while (pendientes.length) {
      if (Date.now() > limite) {
        agotado = true
        return
      }
      if (Date.now() < frenadoHasta) await esperar(frenadoHasta - Date.now())
      const tarea = pendientes.shift()
      if (!tarea) return
      const r = await contar(tarea.id)
      if (Number.isFinite(r?.numReviews)) porItem.set(tarea.id, r.numReviews)
      else if (r?.frenado && ++tarea.intentos < REINTENTOS) {
        // freno compartido y creciente; la publicación vuelve a la fila
        frenos++
        frenadoHasta = Math.max(frenadoHasta, Date.now() + pausaMs * tarea.intentos)
        pendientes.push(tarea)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrencia, pendientes.length) }, () => obrero()))

  if (agotado || frenos) {
    console.warn(`[reviews-api] ${porItem.size}/${new Set(itemIds.filter(Boolean)).size} publicaciones medidas · ${frenos} frenos de ML${agotado ? ' · presupuesto de tiempo agotado' : ''}`)
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
