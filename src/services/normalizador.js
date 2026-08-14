// Normaliza el output del actor nivel 1 (karamelo/mercadolibre-scraper-espanol-castellano).
// El actor entrega campos en español y casi todo como string; ver README para el schema validado.

const REGEX_SKU = /MLC-?(U)?-?(\d{6,})/i

// Números tal como los emite ML/el actor: "15990", "9747,93" (coma decimal),
// "9.999" y "1.234.567" (punto de miles), "4.6" (rating). CLP no usa decimales
// en la práctica, pero el actor a veces los emite.
export function parsearNumero(valor) {
  if (valor === null || valor === undefined) return null
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  let s = String(valor).replace(/[^\d.,-]/g, '')
  if (!s || s === '-') return null

  const tienePunto = s.includes('.')
  const tieneComa = s.includes(',')
  if (tienePunto && tieneComa) {
    // el separador que aparece más a la derecha es el decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replaceAll('.', '').replace(',', '.')
    else s = s.replaceAll(',', '')
  } else if (tieneComa) {
    const partes = s.split(',')
    // una sola coma con 1-2 dígitos detrás => decimal ("9747,93"); si no, miles
    if (partes.length === 2 && partes[1].length >= 1 && partes[1].length <= 2) s = partes.join('.')
    else s = partes.join('')
  } else if (tienePunto) {
    const partes = s.split('.')
    const esMiles =
      partes.length >= 2 &&
      partes[0].length >= 1 &&
      partes[0].length <= 3 &&
      partes.slice(1).every((p) => p.length === 3)
    if (esMiles) s = partes.join('')
    else if (partes.length > 2) s = partes.slice(0, -1).join('') + '.' + partes.at(-1)
  }

  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export const parsearPrecio = parsearNumero

// `Envio` trae flags embebidos: "{same_day_free_shipping} {full_icon}"
export function parsearEnvio(envio) {
  const texto = typeof envio === 'string' ? envio : ''
  const flags = [...texto.matchAll(/\{([a-z0-9_]+)\}/gi)].map((m) => m[1].toLowerCase())
  if (flags.length) {
    return {
      esFull: flags.some((f) => f === 'full_icon' || f === 'full'),
      envioRapido: flags.some((f) => f.includes('same_day') || f.includes('next_day') || f.includes('flash')),
      envioGratis: flags.some((f) => f.includes('free_shipping')),
      flags,
    }
  }
  // el actor también entrega el envío como TEXTO NATURAL, sin flags: "Llega
  // gratis mañana Enviado por FULL" (verificado 9-ago en el crudo del nivel 1
  // para pastillas freno — 48/48 items así). Leer solo llaves dejaba el %Full
  // en "desconocido" para nichos enteros y lo subestimaba en todo el tablero.
  const t = texto.toLowerCase()
  if (!t.trim()) return { esFull: null, envioRapido: null, envioGratis: null, flags }
  return {
    esFull: /\bfull\b/.test(t),
    envioRapido: /(mañana|manana|hoy|24\s*h|mismo d[ií]a)/.test(t),
    envioGratis: /gratis/.test(t),
    flags,
  }
}

// URLs con /p/MLC... son página de catálogo; /up/MLCU... o articulo... son listing suelto
export function detectarTipoListing(url) {
  if (typeof url === 'string' && /\/p\/MLC\d+/i.test(url)) return 'catalogo'
  return 'listing'
}

export function extraerSku(item) {
  const directo = typeof item?.SKU === 'string' ? item.SKU.trim() : ''
  const fuente = directo || (typeof item?.zProductoLink === 'string' ? item.zProductoLink : '')
  const m = fuente.match(REGEX_SKU)
  if (m) return `MLC${m[1] ? 'U' : ''}${m[2]}`
  return directo || null
}

// "+9.999 resultados" → { total: 9999, esMinimo: true } (ML capea el contador en 9999)
export function parsearResultadosTotales(valor) {
  if (valor === null || valor === undefined || valor === '') return null
  const s = String(valor)
  const total = parsearNumero(s)
  if (total === null) return null
  return { total, esMinimo: s.includes('+') }
}

export function calcularDescuentoPct(precio, precioAnterior) {
  if (!Number.isFinite(precio) || !Number.isFinite(precioAnterior)) return null
  if (precioAnterior <= 0 || precioAnterior <= precio) return null
  return Math.round(((precioAnterior - precio) / precioAnterior) * 1000) / 10
}

export function normalizarItemBusqueda(raw, { fecha, keyword, posicionGlobal } = {}) {
  if (!raw || typeof raw !== 'object') return null
  const sku = extraerSku(raw)
  if (!sku) return null

  const url = typeof raw.zProductoLink === 'string' && raw.zProductoLink ? raw.zProductoLink : null
  const precio = parsearPrecio(raw.nuevoPrecio)
  const precioAnterior = parsearPrecio(raw.precioAnterior)
  const envio = parsearEnvio(raw.Envio)
  const kw = String(raw.palabraClave || keyword || '').trim().toLowerCase() || null

  const imagen =
    typeof raw.imgDireccion === 'string' && raw.imgDireccion.startsWith('http') ? raw.imgDireccion : null

  const producto = {
    sku,
    keywordOrigen: kw,
    titulo: raw.articuloTitulo || null,
    url,
    imagen,
    tipoListing: detectarTipoListing(url),
    categoriaML: raw.produtoCategoryID || null,
    domainML: raw.produtoDomainID || null,
    vendedor: raw.Vendedor || null,
    sellerId: raw.sellerID || null, // vacío en nivel 1, lo completa el nivel 2
    esTiendaOficial: Boolean(raw.esTiendaOficial),
    esFull: envio.esFull,
    envioRapido: envio.envioRapido,
  }

  const snapshot = {
    sku,
    fecha,
    precio,
    precioAnterior,
    descuentoPct: calcularDescuentoPct(precio, precioAnterior),
    cuotas: raw.installments || null,
    rating: parsearNumero(raw.produtoReviews),
    numReviews: parsearNumero(raw.numeroEvaluaciones),
    // El badge público "+N vendidos" del listado. Venía descartado desde el
    // día uno ("Fase 2") aunque el actor lo trae en el nivel 1 — gratis, sin
    // pasar por el detalle. Ver senalVendidos() en metricas.js: es un balde
    // acumulado, no una tasa, y se usa solo para comparar tamaño entre nichos.
    vendidos: parsearNumero(raw.cantidadVendida),
    stock: null, // Fase 2
    // itemPosition del actor reinicia en cada página; el orden del dataset es la posición global
    posicion: posicionGlobal ?? parsearNumero(raw.itemPosition),
    keyword: kw,
  }

  return { producto, snapshot }
}

// Dedup por SKU (el listado repite items promocionados) quedándose con la mejor posición.
export function normalizarScan(rawItems, { fecha, keyword } = {}) {
  const porSku = new Map()
  let descartados = 0
  let totalResultados = null

  for (const [indice, raw] of (rawItems ?? []).entries()) {
    const tot = parsearResultadosTotales(raw?.resultadosTotales)
    if (tot && (!totalResultados || tot.total > totalResultados.total)) totalResultados = tot

    const norm = normalizarItemBusqueda(raw, { fecha, keyword, posicionGlobal: indice + 1 })
    if (!norm) {
      descartados++
      continue
    }
    const previo = porSku.get(norm.producto.sku)
    if (!previo || (norm.snapshot.posicion ?? Infinity) < (previo.snapshot.posicion ?? Infinity)) {
      porSku.set(norm.producto.sku, norm)
    }
  }

  return { items: [...porSku.values()], descartados, totalResultados }
}
