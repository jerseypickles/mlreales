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

// Llamada con salida estructurada (JSON garantizado por output_config.format).
export async function pedirJSON({ system, user, schema, maxTokens = 8000 }) {
  const anthropic = obtenerCliente()

  let respuesta
  try {
    respuesta = await anthropic.messages.create({
      model: config.llmModel,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      system,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: user }],
    })
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
    throw err
  }

  if (respuesta.stop_reason === 'refusal') {
    throw new Error('El modelo rechazó la solicitud')
  }
  if (respuesta.stop_reason === 'max_tokens') {
    throw new Error('Respuesta del modelo truncada (max_tokens); reintentar')
  }

  const bloqueTexto = respuesta.content.find((b) => b.type === 'text')
  if (!bloqueTexto) throw new Error('El modelo no devolvió contenido')

  // costo real de la llamada (Opus 4.8: US$5/M entrada, US$25/M salida)
  const uso = respuesta.usage ?? {}
  const costoUsd =
    ((uso.input_tokens ?? 0) + (uso.cache_read_input_tokens ?? 0) * 0.1) * (5 / 1e6) +
    (uso.output_tokens ?? 0) * (25 / 1e6)

  return { datos: JSON.parse(bloqueTexto.text), costoUsd: Math.round(costoUsd * 10000) / 10000 }
}
