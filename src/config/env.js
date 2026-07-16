import 'dotenv/config'

const REQUERIDAS = ['MONGO_URI', 'REDIS_URL', 'APIFY_TOKEN']

export function validarEnv() {
  const faltantes = REQUERIDAS.filter((clave) => !process.env[clave])
  if (faltantes.length) {
    throw new Error(`Faltan variables de entorno: ${faltantes.join(', ')} (ver .env.example)`)
  }
}

export const config = {
  mongoUri: process.env.MONGO_URI,
  redisUrl: process.env.REDIS_URL,
  apifyToken: process.env.APIFY_TOKEN,
  actorSearch: process.env.APIFY_ACTOR_SEARCH || 'karamelo~mercadolibre-scraper-espanol-castellano',
  actorDetails: process.env.APIFY_ACTOR_DETAILS || 'ecomscrape~mercadolibre-product-details-scraper',
  maxPagesBusqueda: Number(process.env.APIFY_SEARCH_MAX_PAGES) || 2,
  nivel2Activo: process.env.NIVEL2_ACTIVO !== 'false',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  llmModel: process.env.LLM_MODEL || 'claude-opus-4-8',
  detalleTopN: Number(process.env.DETALLE_TOP_N) || 50,
  detalleBatch: Number(process.env.DETALLE_BATCH) || 15,
  port: Number(process.env.PORT) || 3000,
}
