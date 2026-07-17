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
  // sourabhbgp desde 2026-07-17: pasó el muro nocturno de ML 10/10 donde ecomscrape
  // daba 0/30, cuesta ~US$0.05/10 urls sin arriendo y entrega seller+reputación+IDs.
  // Rollback: APIFY_ACTOR_DETAILS=ecomscrape~mercadolibre-product-details-scraper
  actorDetails: process.env.APIFY_ACTOR_DETAILS || 'sourabhbgp~mercadolibre-scraper',
  maxPagesBusqueda: Number(process.env.APIFY_SEARCH_MAX_PAGES) || 2,
  nivel2Activo: process.env.NIVEL2_ACTIVO !== 'false',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  llmModel: process.env.LLM_MODEL || 'claude-opus-4-8',
  // radar autónomo: descubre nichos por temporada/tendencia y los escanea solo
  radarActivo: process.env.RADAR_ACTIVO !== 'false',
  radarCron: process.env.RADAR_CRON || '0 8 * * *', // diario 08:00 Chile
  radarMaxNichos: Number(process.env.RADAR_MAX_NICHOS) || 5,
  radarMaxActivos: Number(process.env.RADAR_MAX_ACTIVOS) || 15, // techo de nichos activos (control de costos)
  programadorCron: process.env.PROGRAMADOR_CRON || '*/30 * * * *',
  // tendencias de búsqueda: snapshot diario del autocompletado de ML. Corre
  // DESPUÉS del radar: sus ~30 consultas pueden gatillar el bloqueo anti-ráfaga
  // y dejarían al radar sin canonización de keywords si corriera antes.
  tendenciasActivo: process.env.TENDENCIAS_ACTIVO !== 'false',
  tendenciasCron: process.env.TENDENCIAS_CRON || '30 8 * * *',
  analisisAuto: process.env.ANALISIS_AUTO !== 'false',
  detalleTopN: Number(process.env.DETALLE_TOP_N) || 50,
  detalleBatch: Number(process.env.DETALLE_BATCH) || 15,
  // embudo del radar: screening barato (top-10) y score mínimo para ganarse el detalle completo
  detalleScreeningN: Number(process.env.DETALLE_SCREENING_N) || 10,
  screeningScoreMin: Number(process.env.SCREENING_SCORE_MIN) || 45,
  // techo de gasto mensual (Apify + LLM): al alcanzarlo, programador y radar dejan de encolar
  presupuestoUsdMes: Number(process.env.PRESUPUESTO_USD_MES) || 40,
  port: Number(process.env.PORT) || 3000,
}
