// Helpers puros del panel de oportunidades (testeables sin Mongo).

// sin etapa "muestra": la prueba real es el pedido mínimo (MOQ) que pida el
// proveedor — cotizando pasa directo a pedido y de ahí a vendiendo
export const ETAPAS_COMPRA = ['evaluando', 'cotizando', 'pedido', 'vendiendo', 'en-espera', 'descartado']
// etapas que liberan cupo del radar y bajan a scan semanal (en-espera incluida:
// parqueado con motivo, ej. "esperando registro ISP" — se sigue midiendo barato)
const ETAPAS_AVANZADAS = new Set(['cotizando', 'pedido', 'vendiendo', 'en-espera'])

// Cambios que implica mover un nicho de etapa:
// - descartado pausa el nicho (deja de gastar); salir de descartado lo reactiva
// - etapas avanzadas bajan a scan semanal (seguimiento barato) y liberan cupo
//   del radar (el cupo cuenta solo "evaluando")
export function cambiosPorEtapa(etapa, nichoActual = {}) {
  if (!ETAPAS_COMPRA.includes(etapa)) return null
  const cambios = { etapaCompra: etapa, etapaCompraEl: new Date() }
  if (etapa === 'descartado') cambios.estado = 'pausado'
  else if (nichoActual.etapaCompra === 'descartado') cambios.estado = 'activo'
  if (ETAPAS_AVANZADAS.has(etapa)) cambios.frecuenciaScan = 'semanal'
  return cambios
}

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

// Precio objetivo para anclar al proveedor en la hoja de cotización: un % del
// EXW máximo (default 80%). El máximo real es el tope de negociación y NUNCA
// se le muestra; el target ancla bajo y deja espacio para negociar.
export function exwObjetivo(exwMaximoUsd, pct = 80) {
  if (!Number.isFinite(exwMaximoUsd) || exwMaximoUsd <= 0) return null
  return Math.round(exwMaximoUsd * (pct / 100) * 10) / 10
}

// Un "entrar" con un solo scan es una foto; confirmado = la demanda se sostuvo
// en al menos 3 scans y no viene cayendo. Distingue hipótesis de evidencia.
export function confirmacionVeredicto(scansConDemanda, tendencia) {
  return scansConDemanda >= 3 && tendencia !== 'baja' ? 'confirmado' : 'preliminar'
}

// Dirección de la demanda entre los dos últimos reportes (±15% = ruido).
export function tendenciaVentas(ultimo, anterior) {
  const a = ultimo?.metricas?.demanda?.resenasNuevasPorDia
  const b = anterior?.metricas?.demanda?.resenasNuevasPorDia
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
