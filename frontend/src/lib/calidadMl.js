// LO QUE MERCADO LIBRE PIDE, POR TARJETA DE MIS PRODUCTOS (11-nov-2026).
//
// El servidor guarda en cada publicación lo que ML le pide (services/calidadMl.js).
// Una tarjeta puede juntar varias publicaciones —los colores de una familia—, así
// que acá se arma una sola lista: cada pendiente una vez, aunque le falte a varias,
// y el puntaje más bajo de la familia. Lo comercial (Premium para dar cuotas, envío
// gratis, precio mayorista) no se sigue, por pedido del importador: solo se nombra.

// Pura. `publicaciones`: los productos propios de la tarjeta (uno, o las variantes).
export function calidadDeEntrada(publicaciones) {
  const leidas = (publicaciones ?? []).map((p) => p?.calidadMl).filter(Boolean)
  if (!leidas.length) return null
  const pendientes = new Map()
  for (const c of leidas) {
    for (const x of c.pendientes ?? []) {
      const previo = pendientes.get(x.clave)
      const avances = [previo?.avance, x.avance].filter(Number.isFinite)
      pendientes.set(x.clave, { ...x, avance: avances.length ? Math.min(...avances) : null, en: (previo?.en ?? 0) + 1 })
    }
  }
  const puntajes = leidas.map((c) => c.puntajeProducto).filter(Number.isFinite)
  const peor = leidas.reduce((a, c) => (a == null || (c.puntaje ?? Infinity) < (a.puntaje ?? Infinity) ? c : a), null)
  return {
    puntajeProducto: puntajes.length ? Math.min(...puntajes) : null,
    puntaje: peor?.puntaje ?? null,
    nivel: peor?.nivel ?? null,
    pendientes: [...pendientes.values()],
    // lo comercial, nombrado en corto y una vez cada cosa
    comerciales: [...new Set(leidas.flatMap((c) => c.comerciales ?? []).map(nombreComercial))],
    publicaciones: leidas.length,
  }
}

// Lo comercial que ML también pide, dicho en corto.
const COMERCIAL = {
  UP_FINANCING: 'publicar en Premium para dar cuotas sin interés',
  UP_FREE_SHIPPING: 'envío gratis',
  UP_PRICE: 'precio mayorista',
  UP_PROMOTIONS: 'promociones',
  UP_ME_FLEX_ITEM_OPTIN: 'Envíos Flex',
}
function nombreComercial(c) {
  return COMERCIAL[c?.clave] ?? c?.titulo ?? c?.clave ?? 'otra condición de venta'
}

// Cómo se nombra cada pendiente en una etiqueta corta (la tarjeta cerrada no tiene espacio para el texto de ML).
const CORTO = {
  UP_SHORTS: 'video',
  UP_TECHNICAL_SPECIFICATIONS_MAIN: 'características',
  UP_PICTURES: 'fotos',
  UP_TITLE: 'título',
  UP_GTIN: 'código universal',
  UP_STOCK_AVAILABILITY_TIME: 'tiempo de disponibilidad',
}
export const nombreCortoPendiente = (clave) => CORTO[clave] ?? 'un dato'

// Pura. «ML pide video y características» / null si no hay nada pendiente.
export function resumenPendientes(calidad) {
  // siempre en el mismo orden (el de la lista de arriba), venga como venga de ML
  const orden = Object.keys(CORTO)
  const lugar = (clave) => (orden.includes(clave) ? orden.indexOf(clave) : orden.length)
  const nombres = [...new Set([...(calidad?.pendientes ?? [])].sort((a, b) => lugar(a.clave) - lugar(b.clave)).map((p) => nombreCortoPendiente(p.clave)))]
  if (!nombres.length) return null
  return `ML pide ${nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`}`
}
