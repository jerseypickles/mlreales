// Normaliza el output del actor nivel 2 (ecomscrape/mercadolibre-product-details-scraper).
// Schema validado contra output real el 2026-07-16 (ver test/fixtures/nivel2.json).
// Nota: este actor NO entrega vendidos ni stock numérico pese a lo que anuncia;
// la señal de demanda continua es reviews.count (exacto) vía delta entre scans.

const REGEX_SKU = /^MLCU?\d{6,}$/

// El output no incluye la URL pedida: el match con nuestros productos es por
// los IDs que expone (user_product_id para /up/, catalog_product_id para /p/, item_id).
export function skusCandidatos(raw) {
  return [raw?.user_product_id, raw?.catalog_product_id, raw?.item_id]
    .filter((v) => typeof v === 'string' && REGEX_SKU.test(v))
}

// La galería trae IDs de fotos + templates de URL; {sanitizedTitle} puede ir vacío.
export function extraerImagen(raw) {
  const galeria = raw?.gallery
  const foto = galeria?.pictures?.[0]?.id
  const template = galeria?.picture_config?.template_thumbnail
  if (!foto || typeof template !== 'string') return null
  return template.replace('{id}', foto).replace('{sanitizedTitle}', '')
}

export function normalizarItemDetalle(raw) {
  if (!raw || typeof raw !== 'object') return null
  const candidatos = skusCandidatos(raw)
  if (!candidatos.length) return null

  const numero = (v) => (Number.isFinite(v) ? v : null)
  const sellerId = raw.seller_id != null ? String(raw.seller_id) : null

  return {
    skusCandidatos: candidatos,
    itemId: typeof raw.item_id === 'string' ? raw.item_id : null,
    titulo: raw.title ?? null,
    precio: numero(raw.price),
    precioAnterior: numero(raw.original_price),
    rating: numero(raw.reviews?.rate),
    numReviews: numero(raw.reviews?.count),
    esFull: raw.logistic_type === 'fulfillment',
    envioGratis: raw.free_shipping === true,
    categoriaML: raw.category_id ?? null,
    condicion: raw.item_condition ?? null,
    imagen: extraerImagen(raw),
    // items despachados desde China (CNGD01, etc.) = competencia cross-border directa
    origenCrossBorder: Array.isArray(raw.item_origins)
      ? raw.item_origins.some((o) => String(o).startsWith('CN'))
      : false,
    seller: sellerId
      ? {
          sellerId,
          nombre: raw.seller_name ?? null,
          reputacion: raw.reputation_level ?? null, // ej: "5_green"
          powerSeller: raw.power_seller_status ?? null, // ej: "platinum" | "silver" | null
          esTiendaOficial: raw.official_store_id != null,
          officialStoreId: raw.official_store_id ?? null,
        }
      : null,
  }
}

// Indexa resultados del actor por SKU nuestro (a partir de los candidatos).
export function indexarDetallesPorSku(rawItems, skusPedidos) {
  const pedidos = new Set(skusPedidos)
  const porSku = new Map()
  let sinMatch = 0
  for (const raw of rawItems ?? []) {
    const det = normalizarItemDetalle(raw)
    if (!det) {
      sinMatch++
      continue
    }
    const sku = det.skusCandidatos.find((c) => pedidos.has(c))
    if (!sku) {
      sinMatch++
      continue
    }
    porSku.set(sku, det)
  }
  return { porSku, sinMatch }
}
