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
  llmModel: process.env.LLM_MODEL || 'claude-opus-5',
  // El analista decide dónde va la plata, así que corre en el modelo más
  // capaz. Desde el 10-ago-2026 es el mismo Opus 5 que el resto del proyecto:
  // antes era Fable 5, que cuesta el doble por token ($10/$50 por millón
  // contra $5/$25) y cuyos clasificadores a veces declinaban nichos benignos.
  // Se mantiene como variable aparte para poder subir SOLO el análisis a otro
  // modelo sin tocar el resto (LLM_MODEL_ANALISTA); si difiere del base,
  // llm.js degrada solo cuando el premium no está disponible.
  llmModelAnalista: process.env.LLM_MODEL_ANALISTA || 'claude-opus-5',
  // % del EXW máximo que se muestra al proveedor como precio objetivo (ancla)
  exwObjetivoPct: Number(process.env.EXW_OBJETIVO_PCT) || 80,
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
  // nivel de búsqueda de la keyword de cada nicho contra el autocompletado
  // ($0, ni Apify ni LLM). Corre DESPUÉS de la captura de tendencias: reusa
  // los snapshots del día como respaldo cuando el WAF de ML bloquea.
  nivelBusquedaActivo: process.env.NIVEL_BUSQUEDA_ACTIVO !== 'false',
  nivelBusquedaCron: process.env.NIVEL_BUSQUEDA_CRON || '0 9 * * *',
  // cada cuánto se re-mide un nicho ya medido (la demanda de una búsqueda se
  // mueve de a semanas, no de a días)
  nivelBusquedaDias: Number(process.env.NIVEL_BUSQUEDA_DIAS) || 14,
  nivelBusquedaMax: Number(process.env.NIVEL_BUSQUEDA_MAX) || 40,
  analisisAuto: process.env.ANALISIS_AUTO !== 'false',
  // estratega semanal: retirado del dashboard el 29-jul ("no me sirve") — el
  // cron queda APAGADO por defecto; ESTRATEGA_ACTIVO=true lo revive si algún
  // día vuelve a interesar (el servicio, las rutas y los informes siguen ahí)
  estrategaActivo: process.env.ESTRATEGA_ACTIVO === 'true',
  estrategaCron: process.env.ESTRATEGA_CRON || '45 8 * * 1',
  // optimizador de Mis productos: re-audita listings solo (martes 09:15 Chile,
  // después del scan diario de propios para comparar contra datos frescos)
  optimizadorActivo: process.env.OPTIMIZADOR_ACTIVO !== 'false',
  optimizadorCron: process.env.OPTIMIZADOR_CRON || '15 9 * * 2',
  // maduración de cartera: un nicho con veredicto de entrada corre a scan
  // diario hasta juntar N reportes con demanda medida (la película, no la foto)
  maduracionScans: Number(process.env.MADURACION_SCANS) || 5,
  // cupo de nichos madurando a diario a la vez (los de mayor score primero):
  // el resto entra a medida que los confirmados liberan lugar
  maduracionMax: Number(process.env.MADURACION_MAX) || 8,
  // ciclo frecuente de Mis productos: solo API oficial ($0) — una venta se ve
  // en minutos, no al día siguiente. La pasada completa (con actor) sigue diaria.
  propiosFrecuenciaMin: Number(process.env.PROPIOS_FRECUENCIA_MIN) || 45,
  detalleTopN: Number(process.env.DETALLE_TOP_N) || 50,
  // detalle recortado para el mantenimiento semanal de graduados (~33% menos actor)
  detalleTopNMantenimiento: Number(process.env.DETALLE_TOP_N_MANTENIMIENTO) || 20,
  detalleBatch: Number(process.env.DETALLE_BATCH) || 15,
  // embudo del radar: screening barato (top-10) y score mínimo para ganarse el detalle completo
  detalleScreeningN: Number(process.env.DETALLE_SCREENING_N) || 10,
  screeningScoreMin: Number(process.env.SCREENING_SCORE_MIN) || 45,
  // techo de gasto mensual (Apify + LLM): al alcanzarlo, programador y radar dejan de encolar
  presupuestoUsdMes: Number(process.env.PRESUPUESTO_USD_MES) || 40,
  // Techo de scans en una ventana móvil de 24 h. Los nichos maduran en manada
  // y por eso vencen en manada: el 10-ago había 46 de 50 cayendo en 3 días,
  // los últimos del ciclo de Apify y con US$36 de margen. Esto la reparte —
  // un nicho semanal escaneado el día 8 en vez del 7 no cambia ninguna
  // decisión de compra, y el tope de Apify sí.
  scansMaxDia: Number(process.env.SCANS_MAX_DIA) || 12,
  // API oficial de ML (OAuth, cuenta del propio vendedor) — opcionales: sin
  // ellas el resto del sistema funciona y /api/meli/conectar responde 503
  meliAppId: process.env.MELI_APP_ID || null,
  meliAppSecret: process.env.MELI_APP_SECRET || null,
  meliRedirectUri: process.env.MELI_REDIRECT_URI || null,
  port: Number(process.env.PORT) || 3000,
}
