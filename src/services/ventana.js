// CUÁNDO se compra. El dato que ordena el tablero del importador.
//
// Un nicho bueno con la ventana cerrada es peor negocio que uno mediano
// comprable hoy, pero hasta ahora el sidebar rankeaba por score y la ventana
// era un chip decorativo: el campo estructurado `analisis.ventanaCompra` solo
// existía en 2 de 80 nichos (los análisis viejos no lo traen).
//
// La estacionalidad SÍ está: el radar la guarda en radarInfo.estacionalidad
// con sus meses pico. De ahí sale la ventana sin gastar un peso de IA —
// pico menos el lead time de importación.

const MESES_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

// CUÁNTO ANTES DEL PICO HAY QUE PEDIR.
//
// El reloj arranca cuando se le paga al proveedor en China, no cuando zarpa:
// producción + 35-50 días de mar + internación + ingreso a Full = 50-70 días
// (~2 a 2,5 meses) antes de tener la primera unidad vendible.
//
//   pedir a pico−4  →  el stock llega ~1,5 meses ANTES del pico (holgado, y
//                      alcanza a juntar reseñas y ranking antes de la ola)
//   pedir a pico−2  →  el stock llega justo cuando el pico arranca (o unos
//                      días después, si el tránsito se va a los 70 días)
//   pedir a pico−1  →  no alcanza: llega con el pico corriendo
//
// Ajustables sin tocar código (LEAD_COMPRA_MAX_MESES / LEAD_COMPRA_MIN_MESES):
// el lead real lo sabe el importador con su forwarder, no este archivo.
export const LEAD_MAX_MESES = Number(process.env.LEAD_COMPRA_MAX_MESES) || 4
export const LEAD_MIN_MESES = Number(process.env.LEAD_COMPRA_MIN_MESES) || 2

export const mesChile = (fecha = new Date()) =>
  fecha.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }).slice(0, 7)

const aAbsoluto = (aaaamm) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(aaaamm ?? ''))
  if (!m) return null
  return Number(m[1]) * 12 + Number(m[2])
}
const aTexto = (abs) => {
  const anio = Math.floor((abs - 1) / 12)
  const mes = abs - anio * 12
  return `${anio}-${String(mes).padStart(2, '0')}`
}

// El pico puede cruzar el año ("noviembre, diciembre, enero, febrero"): su
// INICIO es el mes cuyo anterior no está en la lista.
export function inicioDelPico(mesesPico) {
  const nums = [...new Set((mesesPico ?? []).map((m) => MESES_ES[String(m).toLowerCase().trim()]).filter(Boolean))]
  if (!nums.length) return null
  const inicio = nums.find((m) => !nums.includes(m === 1 ? 12 : m - 1))
  return inicio ?? Math.min(...nums)
}

function estadoDesde(absHoy, desde, hasta) {
  if (absHoy > hasta) return null // esta ocurrencia ya no alcanza
  if (absHoy >= desde) return absHoy === hasta ? 'ultimo-mes' : 'ahora'
  return desde - absHoy <= 2 ? 'pronto' : 'futura'
}

// Devuelve la ventana accionable del nicho, o null si no hay señal de temporada.
// `ventanaCompra` (la que declara el analista) manda sobre el cálculo.
export function ventanaDeCompra(
  { ventanaCompra = null, estacionalidad = null, curvaAnual = null } = {},
  { hoy = new Date(), leadMax = LEAD_MAX_MESES, leadMin = LEAD_MIN_MESES } = {},
) {
  const absHoy = aAbsoluto(mesChile(hoy))

  // 0. LA CURVA MEDIDA MANDA. `estacionalidad` la escribe la IA de memoria; la
  // curva son 5 años de búsquedas chilenas reales (services/estacionalidad.js).
  // Solo pisa al analista cuando el nicho es estacional de verdad: si la curva
  // dice "todo el año", la ventana deja de estorbar y no hay pico que perseguir.
  // 'alza-suave' cuenta como venta pareja: hay un bulto en el año pero NO existe
  // "el último mes para pedir". Marcarlo con urgencia era la mentira que el
  // importador cazó — toallitas húmedas (ratio 1,50) gritaba urgencia con una
  // curva visualmente plana. Se conserva el mes del bulto como información.
  if (curvaAnual?.clasificacion === 'todo-el-año' || curvaAnual?.clasificacion === 'alza-suave') {
    return {
      fuente: 'curva-medida',
      tipo: 'todo_el_año',
      estado: 'sin-temporada',
      desde: null,
      hasta: null,
      mesesAl: 0,
      alzaSuave: curvaAnual.clasificacion === 'alza-suave' || undefined,
      mesAlza: curvaAnual.clasificacion === 'alza-suave' ? (curvaAnual.nombreMesPico ?? null) : null,
      ratioPico: curvaAnual.ratioPico ?? null,
    }
  }
  if (curvaAnual?.clasificacion === 'estacional' && curvaAnual.mesPico) {
    const v = ventanaDesdePico(curvaAnual.mesPico, absHoy, leadMax, leadMin)
    if (v) return { ...v, fuente: 'curva-medida', ratioPico: curvaAnual.ratioPico ?? null }
  }

  // 1. lo que dictó el analista, si viene y no venció
  const desdeA = aAbsoluto(ventanaCompra?.desde)
  const hastaA = aAbsoluto(ventanaCompra?.hasta)
  if (desdeA && hastaA && hastaA >= absHoy) {
    return {
      fuente: 'analisis',
      tipo: 'estacional',
      desde: aTexto(desdeA),
      hasta: aTexto(hastaA),
      estado: estadoDesde(absHoy, desdeA, hastaA) ?? 'ahora',
      mesesAl: Math.max(0, desdeA - absHoy),
      motivo: ventanaCompra?.motivo ?? null,
    }
  }

  const tipo = estacionalidad?.tipo ?? null
  if (!tipo) return null

  // 2. sin temporada: se compra cuando se quiera — no ordena ni estorba
  if (tipo !== 'estacional') {
    return { fuente: 'estacionalidad', tipo, estado: 'sin-temporada', desde: null, hasta: null, mesesAl: 0 }
  }

  const inicio = inicioDelPico(estacionalidad?.mesesPico)
  if (!inicio) return null

  return ventanaDesdePico(inicio, absHoy, leadMax, leadMin)
}

// Del mes pico a la ventana de compra: se busca la próxima ocurrencia del pico
// a la que TODAVÍA se llega con el lead time de importación. Lo comparten la
// curva medida y la estacionalidad inferida — la diferencia entre ambas es de
// dónde sale el mes pico, no cómo se calcula la ventana.
function ventanaDesdePico(mesPico, absHoy, leadMax, leadMin) {
  const anioHoy = Math.floor((absHoy - 1) / 12)
  for (let k = 0; k <= 2; k++) {
    const pico = (anioHoy + k) * 12 + mesPico
    const desde = pico - leadMax
    const hasta = pico - leadMin
    const estado = estadoDesde(absHoy, desde, hasta)
    if (!estado) continue
    return {
      fuente: 'estacionalidad',
      tipo: 'estacional',
      desde: aTexto(desde),
      hasta: aTexto(hasta),
      pico: aTexto(pico),
      estado,
      mesesAl: Math.max(0, desde - absHoy),
      // el pico de esta temporada ya no se alcanza: la ventana es la del ciclo siguiente
      perdioLaTemporada: k > 0 || undefined,
      // para que la UI pueda explicar de dónde sale la fecha sin adivinar
      leadMeses: { min: leadMin, max: leadMax },
      motivo: null,
    }
  }
  return null
}

// Orden de urgencia para el sidebar: lo comprable hoy primero.
export const ORDEN_VENTANA = { 'ultimo-mes': 0, ahora: 1, pronto: 2, 'sin-temporada': 3, futura: 4 }

export const ventanaOrdena = (v) => ORDEN_VENTANA[v?.estado] ?? 3
