// Helpers puros del panel de oportunidades (testeables sin Mongo).

// Una mención está negada si poco antes viene "no/sin/ni/exento/...":
// los análisis suelen escribir "no requiere SEC ni ISP" y eso NO es un trámite.
// la coma corta el alcance: "no requiere ISP, pero sí SEC" afirma SEC
const NEGACION = /\b(no|sin|ni|exentos?|exenta?s?|libre de|no aplica|no requiere|no necesita)\b[^.;:,]{0,50}$/i

function mencionAfirmada(texto, patron) {
  const limpio = texto.replace(/sin embargo/gi, '~~~') // "sin embargo" no es negación
  const re = new RegExp(patron.source, 'gi')
  let m
  while ((m = re.exec(limpio))) {
    const antes = limpio.slice(Math.max(0, m.index - 60), m.index)
    if (!NEGACION.test(antes)) return true
  }
  return false
}

// Chips de trámite desde los textos de riesgo del análisis y del radar.
// Fallback para análisis viejos: los nuevos traen `analisis.tramites` estructurado.
export function detectarTramites(textos) {
  const t = (textos ?? []).filter(Boolean).join('. ')
  const tramites = []
  if (mencionAfirmada(t, /\bsec\b|certificaci[oó]n el[eé]ctrica/)) tramites.push('SEC')
  if (mencionAfirmada(t, /\bisp\b|registro sanitario/)) tramites.push('ISP')
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

// Inversión aproximada del pedido de prueba: unidades × EXW máximo.
export function inversionEstimadaUsd(primeraCompra, exwMaximoUsd) {
  const unidades = unidadesPrimeraCompra(primeraCompra)
  if (unidades == null || !Number.isFinite(exwMaximoUsd)) return null
  return Math.round(unidades * exwMaximoUsd)
}
