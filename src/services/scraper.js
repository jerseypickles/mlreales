import { config } from '../config/env.js'
import { buscarNivel1, ejecutarActorAsync, construirInputDetalle } from './apify.js'
import { buscarNivel1Zyte } from './listadoMl.js'
import { detallesDeMl, MOTIVO_NO_ES_FICHA } from './detalleMl.js'
import { conCortacircuito } from './cortacircuito.js'

// QUIÉN SCRAPEA, DECIDIDO EN UN SOLO LUGAR.
//
// Durante ago-2026 el scraping migra de dos actores de Apify (karamelo para el
// listado, sourabhbgp para la ficha) a Zyte. La migración NO es un corte: los
// dos proveedores conviven detrás de esta puerta, se eligen por variable de
// entorno y registran su gasto por separado, para poder comparar datos y costo
// sobre nichos reales antes de apagar el viejo.
//
//   SCRAPER_LISTADO=zyte|apify     (default zyte)
//   SCRAPER_DETALLE=zyte|apify     (default zyte)
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
    // `html` viaja para poder guardarlo crudo: cuando ML cambia la forma de un
    // dato, tener la página que sirvió ese día es la diferencia entre leer un
    // documento y volver a scrapear esperando que repita la variante
    const { items, costoUsd, html } = await conCortacircuito('zyte', () =>
      buscarNivel1Zyte(keyword, { domainCode }),
    )
    return { items, costoUsd, html, fuente: 'zyte' }
  }
  const { items, costoUsd } = await conCortacircuito('apify', () =>
    buscarNivel1(keyword, { domainCode }),
  )
  return { items, costoUsd, fuente: 'apify' }
}

// Nivel 2. `preciosListado` (url → precio del nivel 1) solo lo usa Zyte, para
// contrastar el precio contra una fuente independiente; el actor lo ignora.
// LO QUE ZYTE NO SIRVIÓ NO SE COBRA. Medido el 9-nov-2026 en los scans del día:
// de 20 fichas pedidas se aplicaban entre 7 y 13, y las demás volvían con HTTP
// 520 "Website Ban" (Mercado Libre bloqueó la petición). Zyte solo factura las
// respuestas exitosas, así que anotar el costo de todo lo pedido inflaba el
// gasto del mes con fichas que nadie cobró —y el techo de presupuesto frena los
// scans mirando ese número—. El seguimiento de stock ya descontaba así desde el
// 19-sep; esto deja la misma regla para los scans. El cascarón (la página llegó
// pero no era una ficha) sí se cobra.
export function costoServido({ costoUsd = 0, fallidos = [], pedidas = null } = {}) {
  if (!Number.isFinite(costoUsd) || !(pedidas > 0)) return costoUsd
  const sinCobro = (fallidos ?? []).filter((f) => f?.motivo !== MOTIVO_NO_ES_FICHA).length
  return costoUsd * Math.max(0, 1 - sinCobro / pedidas)
}

export async function buscarDetalle(urls, { domainCode = 'CL', preciosListado } = {}) {
  const lista = (urls ?? []).filter(Boolean)
  if (!lista.length) return { items: [], costoUsd: 0, fuente: proveedorDetalle(), fallidos: [] }

  if (proveedorDetalle() === 'zyte') {
    const { items, fallidos, pedidas } = await conCortacircuito('zyte', () =>
      detallesDeMl(lista, { preciosListado }),
    )
    return {
      items,
      fallidos,
      // Zyte factura por request y no expone el costo en la respuesta: se
      // estima por el tramo de navegador y se calibra contra la factura.
      // Se cobra por lo PEDIDO, no por lo que salió bien: los reintentos de
      // una ficha que volvió vacía también se pagan.
      costoUsd: pedidas * config.zyteCostoFichaUsd,
      pedidas,
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
