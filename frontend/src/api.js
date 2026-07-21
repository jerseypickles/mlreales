const BASE = import.meta.env.VITE_API_URL || ''
const CLAVE_STORAGE = 'meli-intel-clave'

export const claveApi = {
  obtener: () => localStorage.getItem(CLAVE_STORAGE),
  guardar: (clave) => localStorage.setItem(CLAVE_STORAGE, clave),
  borrar: () => localStorage.removeItem(CLAVE_STORAGE),
}

async function pedir(ruta, opciones = {}) {
  const clave = claveApi.obtener()
  const headers = { ...(opciones.headers ?? {}), ...(clave ? { 'x-api-key': clave } : {}) }
  const resp = await fetch(`${BASE}${ruta}`, { ...opciones, headers })
  const cuerpo = await resp.json().catch(() => ({}))
  if (resp.status === 401) {
    window.dispatchEvent(new CustomEvent('api-bloqueada'))
    throw new Error('clave de acceso requerida')
  }
  if (!resp.ok) throw new Error(cuerpo.error || `HTTP ${resp.status}`)
  return cuerpo
}

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  listarNichos: () => pedir('/api/nichos'),
  crearNicho: (keyword) => pedir('/api/nichos', json({ keyword })),
  reporte: (id) => pedir(`/api/nichos/${id}/reporte`),
  productosNicho: (id) => pedir(`/api/nichos/${id}/productos`),
  escanear: (id) => pedir(`/api/nichos/${id}/scan`, { method: 'POST' }),
  ajustarNicho: (id, cambios) => pedir(`/api/nichos/${id}`, { ...json(cambios), method: 'PATCH' }),
  historia: (sku) => pedir(`/api/productos/${sku}/historia`),
  analizarNicho: (id) => pedir(`/api/nichos/${id}/analisis`, { method: 'POST' }),
  tendencia: (id) => pedir(`/api/nichos/${id}/tendencia`),
  correrRadar: () => pedir('/api/nichos/radar', { method: 'POST' }),
  simularMargen: (entrada) => pedir('/api/margen', json(entrada)),
  parametrosMargen: () => pedir('/api/margen/parametros'),
  gastos: () => pedir('/api/gastos'),
  generarListing: (id) => pedir(`/api/nichos/${id}/listing`, { method: 'POST' }),
  listarPropios: () => pedir('/api/propios'),
  tendencias: (dias) => pedir(`/api/tendencias${dias ? `?dias=${dias}` : ''}`),
  oportunidades: (opts) => pedir(`/api/oportunidades${opts?.todos ? '?todos=1' : ''}`),
  // forzar: el clic manual regenera el tablero completo con la evidencia
  // de títulos, no solo los pendientes (caso traducciones malas al proveedor)
  generarRfq: (forzar = false) => pedir('/api/oportunidades/rfq', json({ forzar })),
  avanzarNichos: (nichoIds, etapa) => pedir('/api/oportunidades/avanzar', json({ nichoIds, etapa })),
  unirCompras: (nichoIds) => pedir('/api/oportunidades/unir', json({ nichoIds })),
  separarCompra: (nichoIds) => pedir('/api/oportunidades/separar', json({ nichoIds })),
  listarCriterios: () => pedir('/api/criterios'),
  crearCriterio: (texto) => pedir('/api/criterios', json({ texto })),
  ajustarCriterio: (id, cambios) => pedir(`/api/criterios/${id}`, { ...json(cambios), method: 'PATCH' }),
  eliminarCriterio: (id) => pedir(`/api/criterios/${id}`, { method: 'DELETE' }),
  productosGlobal: () => pedir('/api/productos'),
  capturarTendencias: () => pedir('/api/tendencias/capturar', { method: 'POST' }),
  crearPropio: (url) => pedir('/api/propios', json({ url })),
  medirPropios: () => pedir('/api/propios/scan', { method: 'POST' }),
  eliminarPropio: (id) => pedir(`/api/propios/${id}`, { method: 'DELETE' }),
}
