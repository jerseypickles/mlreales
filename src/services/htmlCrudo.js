import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { HtmlCrudo } from '../models/HtmlCrudo.js'

const comprimir = promisify(zlib.brotliCompress)
const descomprimir = promisify(zlib.brotliDecompress)

// tope de seguridad: un documento de Mongo son 16 MB y el HTML comprimido anda
// en 136 KB. Si algún día llega uno absurdo, se guarda el resumen sin el cuerpo
// antes que reventar el scan.
const TOPE_BYTES = 4 * 1024 * 1024

// Pura. Lo que el parser sacó de este HTML, para poder comparar después.
export function resumirExtraccion(items = []) {
  return {
    items: items.length,
    conPrecio: items.filter((i) => i.nuevoPrecio != null).length,
    conVendedor: items.filter((i) => i.Vendedor).length,
    conVendidos: items.filter((i) => i.cantidadVendida != null).length,
    conCatalogId: items.filter((i) => i.catalogId).length,
    anuncios: items.filter((i) => i.esAnuncio).length,
  }
}

// Best-effort de punta a punta: esto cuelga de un scan que ya funcionó y jamás
// debe voltearlo. Si falla, se pierde una ayuda de diagnóstico, no un dato.
export async function guardarHtmlCrudo({ keyword, html, items, fuente = 'zyte', fecha = new Date() }) {
  if (!keyword || typeof html !== 'string' || !html) return null
  try {
    const buf = await comprimir(Buffer.from(html))
    const doc = {
      fecha,
      fuente,
      chars: html.length,
      resumen: resumirExtraccion(items),
    }
    if (buf.length <= TOPE_BYTES) doc.htmlBr = buf
    else console.warn(`[html-crudo] "${keyword}" comprimido pesa ${Math.round(buf.length / 1024)} KB: se guarda solo el resumen`)
    await HtmlCrudo.updateOne({ keyword }, { $set: doc }, { upsert: true })
    return doc.resumen
  } catch (err) {
    console.warn(`[html-crudo] "${keyword}" no se pudo guardar: ${err.message}`)
    return null
  }
}

// Devuelve el HTML descomprimido de un nicho, para diagnosticar.
export async function leerHtmlCrudo(keyword) {
  const doc = await HtmlCrudo.findOne({ keyword }).lean()
  if (!doc) return null
  const html = doc.htmlBr ? (await descomprimir(doc.htmlBr)).toString('utf8') : null
  return { ...doc, html, htmlBr: undefined }
}
