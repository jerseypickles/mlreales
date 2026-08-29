import { buscarNivel1Zyte } from './listadoMl.js'
import { detallesDeMl } from './detalleMl.js'
import { reviewsOficialesSeguro } from './meli.js'
import { idDesdeUrl } from './normalizadorDetalle.js'

// ¿PUEDEN LAS RESEÑAS SALIR GRATIS, PARA TODO EL LISTADO?
//
// Hoy el conteo de reseñas es el dato más caro del sistema: sale del nivel 2,
// que corre sobre el top 50 y paga un request de navegador por ficha. Es además
// la base de la señal de demanda —el delta entre scans—, así que sin él no se
// puntúa un nicho.
//
// Medido el 29-ago-2026 contra producción: `/reviews/item/` con el id de
// CATÁLOGO da 404 ("not found item id"). Quiere el id del ITEM, que el nivel 1
// por Zyte ahora entrega en `metadata.id`.
//
// Con el id correcto responde, pero la fidelidad es la duda: en dos sondeos a
// mano, un item dio 60 contra 59 de la ficha (calza) y otro dio 401 contra 843
// (la mitad), y en ese segundo las reseñas venían de un `reviewable_object`
// distinto al pedido. Por eso esto se mide sobre una muestra y no se decide con
// dos anécdotas.
// Esta sonda cierra el círculo y responde tres cosas con números:
//
//   1. COBERTURA: de los items del listado, ¿cuántos traen id de catálogo?
//   2. RESPUESTA: de esos, ¿cuántos contesta la API oficial?
//   3. FIDELIDAD: ¿el número que da la API es el mismo que muestra la ficha?
//
// La tercera es la que decide. Un conteo que no calza con el de la ficha no
// sirve para continuar la serie histórica: mezclaría dos métricas distintas y
// fabricaría deltas que nadie hizo —el mismo error que los saltos de catálogo.
//
// Solo lee. No escribe nada ni cambia el pipeline.

const MUESTRA_FICHAS = 8

// CUÁNTO PUEDE DIFERIR LA API DE LA FICHA SIN QUE IMPORTE.
//
// El primer criterio fue ±2 reseñas, absoluto. Estaba mal y lo delató la
// medición: sobre "cama perro" la API dio 80/80, 74/74 y 109/109 —exacto— pero
// 1529 contra 1549 en un producto grande, y eso lo marcaba como error. Son 20
// reseñas sobre 1549: un 1,3%.
//
// Lo que este sistema usa NO es el conteo sino su DELTA entre scans. Un desfase
// proporcional y estable no ensucia un delta —se cancela en la resta—; lo que
// lo rompe es mezclar dos fuentes con escalas distintas, que fue el caso del
// endpoint público (0,36 a 0,69 de la ficha, sin patrón).
//
// Así que se tolera lo que sea proporcional y chico, con un piso absoluto para
// los conteos pequeños, donde un porcentaje no significa nada.
const TOLERANCIA_ABS = 2
const TOLERANCIA_PCT = 0.03

export function calzaConteo(ficha, api) {
  if (!Number.isFinite(ficha) || !Number.isFinite(api)) return false
  const dif = Math.abs(ficha - api)
  if (dif <= TOLERANCIA_ABS) return true
  return ficha > 0 && dif / ficha <= TOLERANCIA_PCT
}

// Pura. El veredicto, separado para poder probarlo sin red.
export function veredicto({ conCatalogo, total, responden, comparados, calzan }) {
  if (!total) return { apto: false, motivo: 'el listado vino vacío' }
  if (!conCatalogo) return { apto: false, motivo: 'ningún item trae id de catálogo' }
  if (!comparados) {
    return { apto: false, motivo: 'no se pudo comparar contra ninguna ficha: sin verdad conocida' }
  }
  const pctCalza = calzan / comparados
  const pctResponde = responden / conCatalogo
  if (pctCalza < 0.8) {
    return {
      apto: false,
      motivo: `la API solo calza con la ficha en ${calzan}/${comparados}: mide otra cosa y mezclarlo rompería la serie`,
    }
  }
  if (pctResponde < 0.5) {
    return {
      apto: false,
      motivo: `la API responde solo ${responden}/${conCatalogo}: la cobertura no alcanza para puntuar`,
    }
  }
  return {
    apto: true,
    motivo: `calza ${calzan}/${comparados} contra la ficha y responde ${responden}/${conCatalogo}`,
  }
}

export async function sondearReviewsPorCatalogo(keyword, { domainCode = 'CL' } = {}) {
  const inicio = Date.now()
  const { items } = await buscarNivel1Zyte(keyword, { domainCode })
  const conId = items.filter((i) => i.itemId)

  // 1 y 2: cobertura y respuesta de la API oficial
  const tApi = Date.now()
  const porItem = new Map()
  for (const i of conId) {
    if (porItem.has(i.itemId)) continue
    porItem.set(i.itemId, await reviewsOficialesSeguro(i.itemId))
  }
  const msApi = Date.now() - tApi
  const responden = [...porItem.values()].filter((r) => Number.isFinite(r?.numReviews)).length

  // 3: fidelidad contra la ficha, que es la verdad que usa el sistema hoy.
  // Se comparan solo los que la API contestó: pedir fichas de los que no
  // respondieron es gastar navegador para no aprender nada.
  const muestra = conId
    .filter((i) => i.zProductoLink && Number.isFinite(porItem.get(i.itemId)?.numReviews))
    .slice(0, MUESTRA_FICHAS)
  const { items: fichas, fallidos } = await detallesDeMl(muestra.map((i) => i.zProductoLink))

  // el emparejamiento por URL cruda falla: Zyte devuelve la canónica. Se
  // normaliza por el id embebido en la URL, que es el que ambos lados comparten.
  const porIdUrl = new Map()
  for (const f of fichas) {
    const k = idDesdeUrl(f.url) ?? f.sku
    if (k) porIdUrl.set(k, f)
  }

  const comparaciones = []
  for (const i of muestra) {
    const k = idDesdeUrl(i.zProductoLink)
    const ficha = porIdUrl.get(k) ?? porIdUrl.get(i.catalogId)
    const deFicha = ficha?.ratingCount ?? null
    const deApi = porItem.get(i.itemId)?.numReviews ?? null
    if (!Number.isFinite(deFicha) || !Number.isFinite(deApi)) continue
    comparaciones.push({
      itemId: i.itemId,
      catalogId: i.catalogId ?? null,
      ficha: deFicha,
      api: deApi,
      // la razón viaja: si el desfase es proporcional y estable se puede
      // migrar la serie; si es errático, no
      razon: deFicha > 0 ? Math.round((deApi / deFicha) * 1000) / 1000 : null,
      calza: calzaConteo(deFicha, deApi),
    })
  }
  const calzan = comparaciones.filter((c) => c.calza).length

  return {
    keyword,
    items: items.length,
    conId: conId.length,
    itemsUnicos: porItem.size,
    responden,
    fichasPedidas: muestra.length,
    fichasFallidas: fallidos.length,
    // cuánto tarda pedirle a la API oficial todo el listado: es el costo real
    // de reemplazar al nivel 2, y es tiempo, no plata
    msApiPorItem: porItem.size ? Math.round(msApi / porItem.size) : null,
    comparaciones,
    veredicto: veredicto({
      conCatalogo: conId.length,
      total: items.length,
      responden,
      comparados: comparaciones.length,
      calzan,
    }),
    msTotal: Date.now() - inicio,
  }
}
