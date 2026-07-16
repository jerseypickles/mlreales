const BASE = import.meta.env.VITE_API_URL || ''

async function pedir(ruta, opciones) {
  const resp = await fetch(`${BASE}${ruta}`, opciones)
  const cuerpo = await resp.json().catch(() => ({}))
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
  sugerirNichos: (contexto) => pedir('/api/nichos/sugerencias', json({ contexto })),
  simularMargen: (entrada) => pedir('/api/margen', json(entrada)),
  parametrosMargen: () => pedir('/api/margen/parametros'),
}
