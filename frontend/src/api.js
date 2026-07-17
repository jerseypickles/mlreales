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
  historia: (sku) => pedir(`/api/productos/${sku}/historia`),
  analizarNicho: (id) => pedir(`/api/nichos/${id}/analisis`, { method: 'POST' }),
  tendencia: (id) => pedir(`/api/nichos/${id}/tendencia`),
  correrRadar: () => pedir('/api/nichos/radar', { method: 'POST' }),
  simularMargen: (entrada) => pedir('/api/margen', json(entrada)),
  parametrosMargen: () => pedir('/api/margen/parametros'),
  gastos: () => pedir('/api/gastos'),
}
