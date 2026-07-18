// Helpers puros del panel de oportunidades (testeables sin Mongo).

// Chips de trámite desde los textos de riesgo del análisis y del radar.
export function detectarTramites(textos) {
  const t = (textos ?? []).filter(Boolean).join(' ').toLowerCase()
  const tramites = []
  if (/\bsec\b|certificaci[oó]n el[eé]ctrica/.test(t)) tramites.push('SEC')
  if (/\bisp\b|registro sanitario/.test(t)) tramites.push('ISP')
  return tramites
}

// Dirección de la demanda entre los dos últimos reportes (±15% = ruido).
export function tendenciaVentas(ultimo, anterior) {
  const a = ultimo?.metricas?.demanda?.ventasEstimadasPorDia
  const b = anterior?.metricas?.demanda?.ventasEstimadasPorDia
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null
  const cambio = (a - b) / b
  if (cambio >= 0.15) return 'sube'
  if (cambio <= -0.15) return 'baja'
  return 'estable'
}

// "50-100 unidades" → 75; "100 unidades" → 100; sin número → null.
export function unidadesPrimeraCompra(texto) {
  const s = String(texto ?? '')
  const rango = s.match(/(\d+)\s*(?:-|–|\ba\b)\s*(\d+)/)
  if (rango) return Math.round((Number(rango[1]) + Number(rango[2])) / 2)
  const solo = s.match(/\d+/)
  return solo ? Number(solo[0]) : null
}

// Inversión aproximada del pedido de prueba: unidades × FOB máximo.
export function inversionEstimadaUsd(primeraCompra, fobMaximoUsd) {
  const unidades = unidadesPrimeraCompra(primeraCompra)
  if (unidades == null || !Number.isFinite(fobMaximoUsd)) return null
  return Math.round(unidades * fobMaximoUsd)
}
