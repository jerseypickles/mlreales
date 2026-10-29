// Una publicación cerrada conserva su historia, pero deja de integrar el catálogo operativo.
export const ESTADOS_FINALIZADOS = ['closed', 'deleted']
export const FILTRO_VIGENTES = { estadoMl: { $nin: ESTADOS_FINALIZADOS } }
export const publicacionVigente = (p) => !ESTADOS_FINALIZADOS.includes(p.estadoMl)

const miembros = (entrada) => entrada.variantes ?? [entrada.p]
const normalizar = (texto) => String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const sumarConocidos = (valores) => valores.length && valores.every(Number.isFinite)
  ? valores.reduce((total, n) => total + n, 0) : null

export function inventarioEntrada(entrada) {
  const variantes = miembros(entrada)
  const full = variantes.filter((p) => p.envioMl?.logistica === 'fulfillment')
  const bodega = variantes.filter((p) => p.envioMl?.logistica && p.envioMl.logistica !== 'fulfillment')
  return {
    tieneFull: full.length > 0,
    tieneBodega: bodega.length > 0,
    full: sumarConocidos(full.map((p) => p.inventarioFull?.disponible)),
    bodega: sumarConocidos(bodega.map((p) => p.mediciones?.at(-1)?.stock)),
  }
}

export function coincideFiltro(entrada, filtro) {
  const inventario = inventarioEntrada(entrada)
  if (filtro === 'full') return inventario.tieneFull
  if (filtro === 'bodega') return inventario.tieneBodega
  if (filtro === 'reponer') return ['quebrado', 'critico', 'reponer'].includes(entrada.m.reposicion?.urgencia)
  if (filtro === 'pausados') return miembros(entrada).some((p) => p.estadoMl === 'paused')
  return true
}

export function filtrarEntradas(entradas, { busqueda = '', filtro = 'todos' } = {}) {
  const palabras = normalizar(busqueda).split(/\s+/).filter(Boolean)
  return entradas.filter((e) => {
    const texto = normalizar([e.titulo, ...miembros(e).flatMap((p) => [p.titulo, p.sku, p.itemIdMl, p.familiaMl?.variante])].filter(Boolean).join(' '))
    return coincideFiltro(e, filtro) && palabras.every((palabra) => texto.includes(palabra))
  })
}

export function paginarEntradas(entradas, pagina = 1, tamano = 12) {
  const paginas = Math.max(1, Math.ceil(entradas.length / tamano))
  const actual = Math.min(paginas, Math.max(1, pagina))
  const inicio = (actual - 1) * tamano
  return { entradas: entradas.slice(inicio, inicio + tamano), pagina: actual, paginas, desde: entradas.length ? inicio + 1 : 0, hasta: Math.min(inicio + tamano, entradas.length), total: entradas.length }
}

// El mínimo de una familia solo usa instantes medidos en todos sus colores.
export function seriePrecioEntrada(entrada) {
  const series = miembros(entrada).map((p) => new Map((p.mediciones ?? []).map((d) => [d.fecha, d.precioEfectivo ?? d.precio]).filter(([fecha, precio]) => fecha && Number.isFinite(precio))))
  if (!series.length) return []
  return [...series[0].keys()].filter((fecha) => series.every((s) => s.has(fecha))).sort().slice(-14)
    .map((fecha) => ({ fecha, valor: Math.min(...series.map((s) => s.get(fecha))) }))
}
