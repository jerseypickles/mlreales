import { buscarNivel1Zyte } from './listadoMl.js'
import { detallesDeMl } from './detalleMl.js'
import { reviewsOficialesSeguro } from './meli.js'

// ¿PUEDEN LAS RESEÑAS SALIR GRATIS, PARA TODO EL LISTADO?
//
// Hoy el conteo de reseñas es el dato más caro del sistema: sale del nivel 2,
// que corre sobre el top 50 y paga un request de navegador por ficha. Es además
// la base de la señal de demanda —el delta entre scans—, así que sin él no se
// puntúa un nicho.
//
// `sondaReviews.js` ya había encontrado que `/reviews/item/{id}` con el id del
// ITEM devuelve el bucket propio, casi vacío en publicaciones de catálogo,
// mientras la página muestra el agregado del CATÁLOGO. Le faltaba el id de
// catálogo, y ese solo se conseguía haciendo justamente la llamada de ficha que
// se quería evitar.
//
// El nivel 1 por Zyte lo entrega gratis: `metadata.product_id` de cada tarjeta.
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
// la ficha y la API pueden diferir en una reseña por el momento de la lectura
const TOLERANCIA = 2

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
  const conCatalogo = items.filter((i) => i.catalogId)

  // 1 y 2: cobertura y respuesta de la API oficial
  const tApi = Date.now()
  const porCatalogo = new Map()
  for (const i of conCatalogo) {
    if (porCatalogo.has(i.catalogId)) continue
    porCatalogo.set(i.catalogId, await reviewsOficialesSeguro(i.catalogId))
  }
  const msApi = Date.now() - tApi
  const responden = [...porCatalogo.values()].filter((r) => Number.isFinite(r?.numReviews)).length

  // 3: fidelidad contra la ficha, que es la verdad que usa el sistema hoy
  const muestra = conCatalogo.filter((i) => i.zProductoLink).slice(0, MUESTRA_FICHAS)
  const { items: fichas } = await detallesDeMl(muestra.map((i) => i.zProductoLink))
  const porUrl = new Map(fichas.map((f) => [f.url, f]))

  const comparaciones = []
  for (const i of muestra) {
    const ficha = porUrl.get(i.zProductoLink) ?? fichas.find((f) => f.sku === i.catalogId)
    const deFicha = ficha?.ratingCount ?? null
    const deApi = porCatalogo.get(i.catalogId)?.numReviews ?? null
    if (!Number.isFinite(deFicha) || !Number.isFinite(deApi)) continue
    comparaciones.push({
      catalogId: i.catalogId,
      ficha: deFicha,
      api: deApi,
      calza: Math.abs(deFicha - deApi) <= TOLERANCIA,
    })
  }
  const calzan = comparaciones.filter((c) => c.calza).length

  return {
    keyword,
    items: items.length,
    conCatalogo: conCatalogo.length,
    catalogosUnicos: porCatalogo.size,
    responden,
    // cuánto tarda pedirle a la API oficial todo el listado: es el costo real
    // de reemplazar al nivel 2, y es tiempo, no plata
    msApiPorItem: porCatalogo.size ? Math.round(msApi / porCatalogo.size) : null,
    comparaciones,
    veredicto: veredicto({
      conCatalogo: conCatalogo.length,
      total: items.length,
      responden,
      comparados: comparaciones.length,
      calzan,
    }),
    msTotal: Date.now() - inicio,
  }
}
