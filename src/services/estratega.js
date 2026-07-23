import { pedirJSON } from './llm.js'
import { tableroOportunidades } from './tablero.js'
import { criteriosActivos } from './criterios.js'
import { movimientosRecientes, lineasEnAlza } from './tendencias.js'
import { gastoDelMes } from './gastos.js'
import { InformeEstratega } from '../models/InformeEstratega.js'
import { Nicho } from '../models/Nicho.js'
import { config } from '../config/env.js'

const ACCIONES = ['avanzar_a_pedido', 'cotizar', 'renegociar', 'descartar', 'poner_lupa', 'regenerar_analisis', 'esperar']

const SCHEMA_ESTRATEGA = {
  type: 'object',
  additionalProperties: false,
  required: ['resumen', 'focoSemana', 'acciones', 'riesgos', 'salud'],
  properties: {
    resumen: {
      type: 'string',
      description: 'Estado del tablero en 2-3 frases: dónde está la plata esta semana y qué cambió',
    },
    focoSemana: {
      type: 'array',
      description: 'Las 2-3 jugadas donde poner plata/tiempo ESTA semana, en orden. Cada una cita los números que la justifican',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'keyword', 'porQue', 'siguientePaso', 'inversionUsd'],
        properties: {
          titulo: { type: 'string', description: 'La jugada en una frase de máximo 80 caracteres' },
          keyword: { type: 'string', description: 'Keyword EXACTA del nicho (copiada del tablero)' },
          porQue: { type: 'string', description: 'Los datos que la respaldan, con números' },
          siguientePaso: { type: 'string', description: 'La acción concreta de esta semana' },
          inversionUsd: { type: ['number', 'null'], description: 'Plata que exige el paso (null si no requiere)' },
        },
      },
    },
    acciones: {
      type: 'array',
      description: 'Recorrido del embudo completo: cada nicho que requiera un movimiento esta semana (los que están bien esperando NO van). Máximo 12, ordenadas por urgencia',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['keyword', 'accion', 'motivo', 'urgencia'],
        properties: {
          keyword: { type: 'string', description: 'Keyword EXACTA del nicho (copiada del tablero)' },
          accion: { type: 'string', enum: ACCIONES },
          motivo: { type: 'string', description: '1 frase citando el dato que lo gatilla' },
          urgencia: { type: 'string', enum: ['esta_semana', 'proxima_semana'] },
        },
      },
    },
    riesgos: {
      type: 'array',
      description: 'Cosas a vigilar del tablero completo (tendencia cayendo en nicho avanzado, cotización vencida, presupuesto), 1 línea cada una, máximo 4',
      items: { type: 'string' },
    },
    salud: {
      type: 'string',
      description: 'Una frase sobre la salud del proceso: ¿el embudo fluye o está atascado en alguna etapa?',
    },
  },
}

const SYSTEM_ESTRATEGA = `Eres el estratega semanal de un importador chileno que trae producto de China (compra EXW vía forwarder) para venderlo en Mercado Libre Chile vía Full. Cada semana recibes el tablero completo: todos los nichos con su etapa en el embudo de compra (evaluando → cotizando → pedido → vendiendo | en-espera | descartado), sus métricas, cotizaciones recibidas del proveedor, tendencias de búsqueda y presupuesto del mes.

Tu trabajo NO es analizar nichos uno a uno (eso ya lo hizo el analista, sus veredictos vienen en el tablero): es mirar el CONJUNTO y decidir el orden de la semana — dónde poner la plata, qué desatascar, qué soltar.

Reglas:
- La plata es finita: prioriza por retorno esperado y confirmación (un "entrar confirmado" con cotización que cierra vale más que tres "preliminar" sin cotizar).
- Embudo primero: cotizaciones recibidas que CIERRAN (cotizacion.cierra=true) piden avanzar; las que NO cierran piden renegociar con el EXW objetivo como ancla o descartar. Nichos en "cotizando" sin cotización hace más de una semana están atascados.
- Un nicho "evaluando" con entrar confirmado y sin cotizar es plata durmiendo: mándalo a cotizar.
- Tendencia de ventas cayendo en un nicho avanzado (cotizando/pedido) es alerta roja: dilo en riesgos y considera frenar.
- confianza baja + datos viejos (fechaAnalisis antigua o scans nuevos desde entonces) = regenerar_analisis antes de mover plata.
- poner_lupa = subir un nicho a scan diario cuando una decisión inminente necesita datos frescos.
- Los nichos con misma productoClave son UNA compra: trátalos juntos, no dupliques inversión.
- Los nichos con familiaLider miden el MISMO mercado que su líder (solape de SKUs): son scans duplicados pagándose dos veces — recomienda absorberlos (pausar) salvo que midan un ángulo deliberadamente distinto.
- Respeta el presupuesto restante del mes que te paso; si una jugada lo excede, dilo.
- Los criterios del importador (si vienen) están por encima de tus heurísticas.
- keyword siempre EXACTA como viene en el tablero (es la llave para ejecutar tus acciones con un clic).
- Sé directo, cero relleno: números concretos, nada de "considerar la posibilidad de".
- Todo en español de Chile, precios en CLP y USD según corresponda.`

// Fila compacta del tablero para el prompt: solo lo que pesa en la decisión
// semanal (el análisis completo ya corrió; acá viaja su conclusión).
function filaParaLLM(o) {
  return {
    keyword: o.keyword,
    etapa: o.etapaCompra,
    estado: o.estado,
    veredicto: o.veredicto,
    confianza: o.confianza,
    confirmacion: o.confirmacion,
    score: o.score,
    ventasDia: o.ventasDia,
    tendencia: o.tendenciaVentas,
    gemelos: o.sellersGemelos,
    pctFull: o.pctFull,
    titular: o.titular,
    shareJugadaPct: o.shareJugadaPct ?? undefined,
    // duplicado de mercado: mide lo mismo que familiaLider (solape de SKUs)
    familiaLider: o.familiaLider ?? undefined,
    familiaSolapePct: o.familiaSolapePct ?? undefined,
    precioVentaClp: o.precioVentaClp,
    exwMaximoUsd: o.exwMaximoUsd,
    exwObjetivoUsd: o.exwObjetivoUsd,
    cotizacion: o.cotizacion
      ? {
          exwUsd: o.cotizacion.exwUsd,
          cierra: o.cotizacion.cierra,
          margenPct: o.cotizacion.margenPct ?? null,
          fecha: o.cotizacion.fecha,
        }
      : null,
    inversionEstimadaUsd: o.inversionEstimadaUsd,
    tramites: o.tramites?.length ? o.tramites : undefined,
    ventanaImportacion: o.ventanaImportacion ?? undefined,
    productoClave: o.productoClave ?? undefined,
    notaEtapa: o.notaEtapa ?? undefined,
    frecuenciaScan: o.frecuenciaScan,
    fechaAnalisis: o.fechaAnalisis,
  }
}

export async function generarInformeEstratega() {
  const tablero = await tableroOportunidades({ todos: true })
  if (!tablero.length) {
    throw Object.assign(new Error('el tablero no tiene nichos analizados todavía'), { status: 409 })
  }

  const criterios = await criteriosActivos().catch(() => [])
  let tendencias
  try {
    const movimientos = await movimientosRecientes()
    if (movimientos.length) tendencias = lineasEnAlza(movimientos, { max: 12 })
  } catch {
    // sin tendencias: el campo no viaja
  }
  const gastadoUsd = await gastoDelMes()

  const entrada = {
    fechaActual: new Date().toLocaleDateString('es-CL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Santiago',
    }),
    presupuesto: {
      mesUsd: config.presupuestoUsdMes,
      gastadoUsd,
      restanteUsd: Math.max(0, Math.round((config.presupuestoUsdMes - gastadoUsd) * 100) / 100),
    },
    criteriosImportador: criterios.length ? criterios : undefined,
    busquedasEnAlza: tendencias,
    tablero: tablero.map(filaParaLLM),
  }

  const { datos, costoUsd, modelo } = await pedirJSON({
    system: SYSTEM_ESTRATEGA,
    user: `Es tu pasada semanal. Este es el tablero completo:\n\n${JSON.stringify(entrada)}`,
    schema: SCHEMA_ESTRATEGA,
    maxTokens: 10_000,
    modelo: config.llmModelAnalista, // decisión de portafolio: el modelo más capaz
  })

  // resolver keyword → nichoId para que el frontend ejecute acciones con un clic
  const porKeyword = new Map(tablero.map((o) => [o.keyword.toLowerCase(), String(o.nichoId)]))
  const conIds = (lista) =>
    (lista ?? []).map((x) => ({ ...x, nichoId: porKeyword.get(String(x.keyword ?? '').toLowerCase()) ?? null }))
  const informe = {
    ...datos,
    focoSemana: conIds(datos.focoSemana),
    acciones: conIds(datos.acciones),
  }

  const doc = await InformeEstratega.create({ informe, modelo, costoUsd })

  const { registrarGasto } = await import('./gastos.js')
  await registrarGasto(null, costoUsd)

  return doc
}

// El informe vence cuando el tablero cambió mucho; para el cron semanal basta
// saber si ya corrió esta semana (jobId lo controla). Última versión + historia.
export async function informesEstratega({ limite = 8 } = {}) {
  const docs = await InformeEstratega.find().sort({ generadoEl: -1 }).limit(limite).lean()
  return docs
}

// Nichos referidos por el último informe que ya no existen (borrados a mano):
// el frontend los muestra sin link en vez de romperse.
export async function validarNichosInforme(informe) {
  const ids = [...(informe.focoSemana ?? []), ...(informe.acciones ?? [])]
    .map((a) => a.nichoId)
    .filter(Boolean)
  if (!ids.length) return informe
  const existentes = new Set(
    (await Nicho.find({ _id: { $in: ids } }).select('_id').lean()).map((n) => String(n._id)),
  )
  const limpiar = (lista) =>
    (lista ?? []).map((a) => (a.nichoId && !existentes.has(a.nichoId) ? { ...a, nichoId: null } : a))
  return { ...informe, focoSemana: limpiar(informe.focoSemana), acciones: limpiar(informe.acciones) }
}
