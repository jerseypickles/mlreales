// Normaliza el output del actor nivel 2. Soporta dos formatos con auto-detección:
// - sourabhbgp/mercadolibre-scraper (camelCase, mode:"product") — actual; schema
//   validado contra output real el 2026-07-17 (test/fixtures/nivel2-sourabhbgp.json)
// - ecomscrape/mercadolibre-product-details-scraper (snake_case) — legado/rollback
// Ninguno entrega vendidos ni stock numérico; la señal de demanda continua es el
// conteo de calificaciones (exacto) vía delta entre scans.

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

// sourabhbgp: el ID pedido puede venir como catalogProductId, productId, sku o
// dentro de variations[].id (comprobado: pedir /p/MLC62124281 devuelve el catálogo
// padre MLC62133922 con la variante pedida en variations)
function skusCandidatosSourabh(raw) {
  const variantes = Array.isArray(raw?.variations) ? raw.variations.map((v) => v?.id) : []
  return [raw?.catalogProductId, raw?.productId, raw?.sku, ...variantes].filter(
    (v, i, arr) => typeof v === 'string' && REGEX_SKU.test(v) && arr.indexOf(v) === i,
  )
}

function normalizarItemSourabh(raw) {
  const candidatos = skusCandidatosSourabh(raw)
  if (!candidatos.length) return null

  const numero = (v) => (Number.isFinite(v) ? v : null)
  const sellerId = raw.sellerId != null ? String(raw.sellerId) : null
  const origen = raw.shipping?.originCountry ?? null

  return {
    skusCandidatos: candidatos,
    itemId: typeof raw.productId === 'string' ? raw.productId : null,
    titulo: raw.title ?? null,
    precio: numero(raw.price),
    precioAnterior: numero(raw.originalPrice),
    rating: numero(raw.rating),
    // ratingCount = total de calificaciones (equivale al reviews.count de ecomscrape);
    // reviewCount son solo las reseñas con texto — fallback si falta el primero
    numReviews: numero(raw.ratingCount) ?? numero(raw.reviewCount),
    // este actor no expone el flag de Full: null = no tocar lo que dijo el nivel 1
    esFull: null,
    envioGratis: raw.freeShipping === true,
    categoriaML: raw.categoryId ?? (Array.isArray(raw.breadcrumbs) ? raw.breadcrumbs.join(' > ') : null),
    condicion: raw.condition ?? null,
    imagen: raw.thumbnail ?? (Array.isArray(raw.images) ? raw.images[0] : null) ?? null,
    // solo afirmar cross-border cuando el actor entrega el origen; null = desconocido
    origenCrossBorder: origen ? String(origen).toUpperCase().startsWith('CN') : null,
    seller: sellerId
      ? {
          sellerId,
          nombre: raw.sellerName ?? null,
          reputacion: raw.sellerReputation ?? null,
          powerSeller: raw.sellerPowerStatus ?? null,
          esTiendaOficial: raw.isOfficialStore === true,
          officialStoreId: raw.officialStoreName ?? null,
        }
      : null,
  }
}

export function normalizarItemDetalle(raw) {
  if (!raw || typeof raw !== 'object') return null
  // formato sourabhbgp: camelCase con mode/productId; ecomscrape usa snake_case
  if (raw.mode === 'product' || raw.catalogProductId !== undefined || raw.productId !== undefined) {
    return normalizarItemSourabh(raw)
  }
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
