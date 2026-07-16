const BASE = import.meta.env.VITE_API_URL || ''

async function pedir(ruta, opciones) {
  const resp = await fetch(`${BASE}${ruta}`, opciones)
  const cuerpo = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(cuerpo.error || `HTTP ${resp.status}`)
  return cuerpo
}

export const api = {
  listarNichos: () => pedir('/api/nichos'),
  crearNicho: (keyword) =>
    pedir('/api/nichos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword }),
    }),
  reporte: (id) => pedir(`/api/nichos/${id}/reporte`),
  escanear: (id) => pedir(`/api/nichos/${id}/scan`, { method: 'POST' }),
}
