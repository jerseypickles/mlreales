import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config/env.js'

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

// US$ por millón de tokens [entrada, salida] según modelo
const PRECIOS = {
  'claude-fable-5': [10, 50],
  'claude-opus-4-8': [5, 25],
}
const precioDe = (modelo) => PRECIOS[modelo] ?? PRECIOS['claude-opus-4-8']

function costoDe(respuesta, modelo) {
  const [entrada, salida] = precioDe(modelo)
  const uso = respuesta.usage ?? {}
  const costo =
    ((uso.input_tokens ?? 0) + (uso.cache_read_input_tokens ?? 0) * 0.1) * (entrada / 1e6) +
    (uso.output_tokens ?? 0) * (salida / 1e6)
  return Math.round(costo * 10000) / 10000
}

// Llamada con salida estructurada (JSON garantizado por output_config.format).
// `modelo` permite subir una llamada puntual (ej: el analista corre en Fable 5);
// si ese modelo rechaza o falla, se reintenta solo con el modelo base.
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
    // los clasificadores de Fable 5 pueden declinar contenido benigno: el
    // modelo base responde la misma solicitud
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

  return { datos: JSON.parse(bloqueTexto.text), costoUsd: costoDe(respuesta, modeloUsado), modelo: modeloUsado }
}
