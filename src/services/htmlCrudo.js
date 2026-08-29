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

// Pura. Mongoose con `.lean()` devuelve los Buffer como `Binary` del driver de
// MongoDB, que zlib rechaza —"Received an instance of Binary"—. Se normaliza
// acá para que quien llame no tenga que saberlo.
export function aBuffer(v) {
  if (!v) return null
  if (Buffer.isBuffer(v)) return v
  if (Buffer.isBuffer(v.buffer)) return v.buffer
  if (typeof v.value === 'function') return Buffer.from(v.value(true))
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  return null
}

// Devuelve el HTML de un nicho, para diagnosticar. Con `soloResumen` NO
// descomprime: los conteos son lo que se mira primero y no hace falta pagar
// 2 MB de descompresión para leer seis números.
export async function leerHtmlCrudo(keyword, { soloResumen = false } = {}) {
  const doc = await HtmlCrudo.findOne({ keyword }).lean()
  if (!doc) return null
  const meta = { ...doc, htmlBr: undefined, comprimidoBytes: aBuffer(doc.htmlBr)?.length ?? null }
  if (soloResumen) return { ...meta, html: null }
  const buf = aBuffer(doc.htmlBr)
  return { ...meta, html: buf ? (await descomprimir(buf)).toString('utf8') : null }
}
