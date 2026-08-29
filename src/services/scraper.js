import { config } from '../config/env.js'
import { buscarNivel1, ejecutarActorAsync, construirInputDetalle } from './apify.js'
import { buscarNivel1Zyte } from './listadoMl.js'
import { detallesDeMl } from './detalleMl.js'

// QUIÉN SCRAPEA, DECIDIDO EN UN SOLO LUGAR.
//
// Durante ago-2026 el scraping migra de dos actores de Apify (karamelo para el
// listado, sourabhbgp para la ficha) a Zyte. La migración NO es un corte: los
// dos proveedores conviven detrás de esta puerta, se eligen por variable de
// entorno y registran su gasto por separado, para poder comparar datos y costo
// sobre nichos reales antes de apagar el viejo.
//
//   SCRAPER_LISTADO=zyte|apify     (default apify)
//   SCRAPER_DETALLE=zyte|apify     (default apify)
//
// Ambos devuelven la misma forma que devolvía Apify —{items, costoUsd}— y los
// items llevan los nombres de campo de los actores, así que ni los
// normalizadores ni nada aguas abajo distinguen de dónde vino el dato.

export function proveedorListado() {
  return config.scraperListado === 'zyte' ? 'zyte' : 'apify'
}

export function proveedorDetalle() {
  return config.scraperDetalle === 'zyte' ? 'zyte' : 'apify'
}

// Nivel 1. `fuente` viaja de vuelta para que quien llame registre el gasto en
// la cuenta correcta.
export async function buscarListado(keyword, { domainCode = 'CL' } = {}) {
  if (proveedorListado() === 'zyte') {
    const { items, costoUsd } = await buscarNivel1Zyte(keyword, { domainCode })
    return { items, costoUsd, fuente: 'zyte' }
  }
  const { items, costoUsd } = await buscarNivel1(keyword, { domainCode })
  return { items, costoUsd, fuente: 'apify' }
}

// Nivel 2. `preciosListado` (url → precio del nivel 1) solo lo usa Zyte, para
// contrastar el precio contra una fuente independiente; el actor lo ignora.
export async function buscarDetalle(urls, { domainCode = 'CL', preciosListado } = {}) {
  const lista = (urls ?? []).filter(Boolean)
  if (!lista.length) return { items: [], costoUsd: 0, fuente: proveedorDetalle(), fallidos: [] }

  if (proveedorDetalle() === 'zyte') {
    const { items, fallidos, pedidas } = await detallesDeMl(lista, { preciosListado })
    return {
      items,
      fallidos,
      // Zyte factura por request y no expone el costo en la respuesta: se
      // estima por el tramo de navegador y se calibra contra la factura.
      // Se cobra por lo PEDIDO, no por lo que salió bien: los reintentos de
      // una ficha que volvió vacía también se pagan.
      costoUsd: pedidas * config.zyteCostoFichaUsd,
      fuente: 'zyte',
    }
  }
  const r = await ejecutarActorAsync(
    config.actorDetails,
    construirInputDetalle(config.actorDetails, lista, { domainCode }),
    { conMeta: true },
  )
  return { items: r.items, fallidos: [], costoUsd: r.costoUsd, fuente: 'apify' }
}
