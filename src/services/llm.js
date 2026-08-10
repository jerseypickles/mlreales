import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config/env.js'
import { decodificarEscapes } from './texto.js'

let cliente = null

export function llmDisponible() {
  return Boolean(config.anthropicApiKey)
}

function obtenerCliente() {
  if (!config.anthropicApiKey) {
    const err = new Error('Falta ANTHROPIC_API_KEY: configúrala en el entorno para habilitar el análisis con IA')
    err.status = 503
    throw err
  }
  if (!cliente) cliente = new Anthropic({ apiKey: config.anthropicApiKey })
  return cliente
}

// US$ por millón de tokens [entrada, salida] según modelo, del tarifario
// oficial. Alimenta gastoDelMes y con eso el corte por presupuesto: un precio
// equivocado acá no se nota hasta que el mes cierra con el doble.
const PRECIOS = {
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-fable-5': [10, 50], // se conserva por si se vuelve con LLM_MODEL_ANALISTA
  'claude-sonnet-5': [3, 15], // tarifa desde el 1-sep-2026 (hasta ahí, 2/10)
}
const precioDe = (modelo) => PRECIOS[modelo] ?? PRECIOS['claude-opus-5']

function costoDe(respuesta, modelo) {
  const [entrada, salida] = precioDe(modelo)
  const uso = respuesta.usage ?? {}
  const costo =
    ((uso.input_tokens ?? 0) + (uso.cache_read_input_tokens ?? 0) * 0.1) * (entrada / 1e6) +
    (uso.output_tokens ?? 0) * (salida / 1e6)
  return Math.round(costo * 10000) / 10000
}

// Llamada con salida estructurada (JSON garantizado por output_config.format).
// `modelo` permite subir una llamada puntual a un modelo distinto del base; si
// ese modelo rechaza o falla, se reintenta solo con el base. Hoy análisis y
// base son el mismo Opus 5, así que estas ramas quedan inertes — se conservan
// porque LLM_MODEL_ANALISTA puede volver a separarlos sin tocar código.
export async function pedirJSON({ system, user, schema, maxTokens = 8000, modelo }) {
  const anthropic = obtenerCliente()
  const modeloPedido = modelo ?? config.llmModel

  const llamar = (m) =>
    anthropic.messages.create({
      model: m,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      system,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: user }],
    })

  let respuesta
  let modeloUsado = modeloPedido
  try {
    respuesta = await llamar(modeloPedido)
    // un modelo premium puede declinar contenido benigno (le pasaba a Fable 5
    // con nichos inofensivos): el modelo base responde la misma solicitud
    if (respuesta.stop_reason === 'refusal' && modeloPedido !== config.llmModel) {
      console.error(`[llm] ${modeloPedido} rechazó la solicitud: reintentando con ${config.llmModel}`)
      modeloUsado = config.llmModel
      respuesta = await llamar(config.llmModel)
    }
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      const e = new Error('Límite de tasa de la API de Anthropic; intenta de nuevo en unos segundos')
      e.status = 429
      throw e
    }
    if (err instanceof Anthropic.AuthenticationError) {
      const e = new Error('ANTHROPIC_API_KEY inválida')
      e.status = 503
      throw e
    }
    // modelo premium no disponible para la cuenta (404/403/400 de modelo):
    // degradar al modelo base en vez de botar el análisis
    if (
      modeloPedido !== config.llmModel &&
      (err instanceof Anthropic.NotFoundError ||
        err instanceof Anthropic.PermissionDeniedError ||
        err instanceof Anthropic.BadRequestError)
    ) {
      console.error(`[llm] ${modeloPedido} no disponible (${err.status}): usando ${config.llmModel}`)
      modeloUsado = config.llmModel
      respuesta = await llamar(config.llmModel)
    } else {
      throw err
    }
  }

  if (respuesta.stop_reason === 'refusal') {
    throw new Error('El modelo rechazó la solicitud')
  }
  if (respuesta.stop_reason === 'max_tokens') {
    throw new Error('Respuesta del modelo truncada (max_tokens); reintentar')
  }

  const bloqueTexto = respuesta.content.find((b) => b.type === 'text')
  if (!bloqueTexto) throw new Error('El modelo no devolvió contenido')

  // el modelo a veces doble-escapa unicode/saltos de línea dentro del JSON
  const datos = decodificarEscapes(JSON.parse(bloqueTexto.text))
  return { datos, costoUsd: costoDe(respuesta, modeloUsado), modelo: modeloUsado }
}
