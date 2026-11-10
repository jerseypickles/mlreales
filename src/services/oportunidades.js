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
  if (mencionAfirmada(t, /\bseremi\b|autorizaci[oó]n sanitaria/)) tramites.push('SEREMI')
  if (mencionAfirmada(t, /\bsubtel\b/)) tramites.push('SUBTEL')
  return tramites
}

// ¿Se vende por tallas? No es un trámite, pero el importador pidió que quede a
// la vista igual (9-nov-2026): las tallas inmovilizan stock por medida. Sale de
// los mismos textos de riesgo; "talla única" no cuenta.
export function detectarTallas(textos) {
  const t = (textos ?? []).filter(Boolean).join('. ')
  return mencionAfirmada(t, /\btallas?\b(?!\s+[uú]nica)|\btallaje\b/)
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

// Pura. Las tasas de reseñas de dos reportes, MEDIDAS CON LA MISMA FUENTE.
//
// El 29-sep-2026 ML cerró `/reviews/item` para publicaciones ajenas y todos los
// scans pasaron de la canasta de la API (127-164 productos) a la de la ficha
// (4-26): comparar una contra otra daba "baja" en la mitad de los nichos sin
// que la demanda se moviera. Con fuentes distintas se compara la ficha, que se
// guarda siempre en `reviewsFicha`; sin ficha en ambos, no hay comparación.
export function tasasComparables(ultimo, anterior) {
  const da = ultimo?.metricas?.demanda, db = anterior?.metricas?.demanda
  const fa = da?.fuenteResenas ?? 'ficha', fb = db?.fuenteResenas ?? 'ficha'
  if (fa === fb) return [da?.resenasNuevasPorDia, db?.resenasNuevasPorDia]
  return [da?.reviewsFicha?.porDia, db?.reviewsFicha?.porDia]
}

// Pura. Las dos tasas de `tasasComparables` puestas SOBRE LA MISMA CANASTA.
//
// La tasa de un nicho es la SUMA de las reseñas nuevas de las publicaciones que
// se pudieron comparar entre dos scans, así que sube y baja con cuántas fichas
// llegaron sin que la demanda se mueva. Medido el 10-nov-2026 sobre los pares de
// scans seguidos de toda la serie: la suma sigue al número de comparables (cuando
// se duplican, hace más que duplicarse) y, dividida por los comparables, deja de
// seguirlos. Se probaron además una canasta fija de las primeras posiciones y las
// mismas publicaciones en los cuatro scans: ninguna se mueve menos que esta.
//
// Lo destapó el arreglo del 9-nov a las fichas bloqueadas: al llegar el doble de
// fichas por scan, la tasa de los nichos empezó a subir sola y el juez del ruido
// anuló como salto imposible una lectura que solo traía más canasta.
//
// Con los comparables de los dos reportes a la vista se compara la tasa por
// publicación comparada; si falta alguno (reportes viejos), queda la suma.
// `crudas` son las sumas, que es lo que se guarda y se muestra.
export function tasasMismaCanasta(ultimo, anterior) {
  const crudas = tasasComparables(ultimo, anterior)
  const [a, b] = crudas
  const da = ultimo?.metricas?.demanda, db = anterior?.metricas?.demanda
  // los comparables de la misma señal que eligió tasasComparables
  const deFicha = (da?.fuenteResenas ?? 'ficha') !== (db?.fuenteResenas ?? 'ficha')
  const comparables = (d) => (deFicha ? d?.reviewsFicha?.itemsComparables : d?.reviews?.itemsComparables)
  const ca = comparables(da), cb = comparables(db)
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(ca > 0) || !(cb > 0)) {
    return { actual: a, ancla: b, base: 'suma', crudas }
  }
  return { actual: a / ca, ancla: b / cb, base: 'por-comparable', crudas, comparables: [ca, cb] }
}

// Dirección de la demanda entre los dos últimos reportes (±15% = ruido), sobre
// la misma canasta: que hoy lleguen más o menos fichas no es subir ni bajar.
export function tendenciaVentas(ultimo, anterior) {
  const { actual: a, ancla: b } = tasasMismaCanasta(ultimo, anterior)
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
