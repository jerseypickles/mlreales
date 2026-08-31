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
  // Zyte pasa el bloqueo de ML en la ficha donde el actor de detalle no; ver
  // la cabecera de src/services/detalleMl.js para las trampas medidas.
  zyteApiKey: process.env.ZYTE_API_KEY,
  // Estimados hasta tener factura: Zyte cobra por request de navegador según
  // lo protegido que sea el sitio (US$1,01–16,08 por 1.000). Se registran como
  // gasto para poder comparar contra Apify y calibrar con el cobro real.
  zyteCostoListadoUsd: Number(process.env.ZYTE_COSTO_LISTADO_USD) || 0.008,
  zyteCostoFichaUsd: Number(process.env.ZYTE_COSTO_FICHA_USD) || 0.006,
  // 'zyte' | 'apify' — permite correr ambos en paralelo y comparar antes de apagar
  scraperListado: process.env.SCRAPER_LISTADO || 'apify',
  scraperDetalle: process.env.SCRAPER_DETALLE || 'apify',
  actorSearch: process.env.APIFY_ACTOR_SEARCH || 'karamelo~mercadolibre-scraper-espanol-castellano',
  // sourabhbgp desde 2026-07-17: pasó el muro nocturno de ML 10/10 donde ecomscrape
  // daba 0/30, cuesta ~US$0.05/10 urls sin arriendo y entrega seller+reputación+IDs.
  // Rollback: APIFY_ACTOR_DETAILS=ecomscrape~mercadolibre-product-details-scraper
  actorDetails: process.env.APIFY_ACTOR_DETAILS || 'sourabhbgp~mercadolibre-scraper',
  maxPagesBusqueda: Number(process.env.APIFY_SEARCH_MAX_PAGES) || 2,
  // Volumen de búsqueda absoluto de Google Ads (services/volumenBusqueda.js).
  // El password es la clave de API de DataForSEO, no la del panel.
  dataForSeoLogin: process.env.DATAFORSEO_LOGIN || null,
  dataForSeoPassword: process.env.DATAFORSEO_PASSWORD || null,
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
  // El analista de PUBLICIDAD. Nació en Fable el 22-ago y volvió a Opus 5 el
  // 24-ago por decisión del importador: quiere un solo motor en todo el
  // sistema. De paso cuesta la mitad — Fable son US$10/US$50 por millón contra
  // US$5/US$25 de Opus — y en las 7 corridas de prueba no mostró una ventaja
  // que justificara el doble de precio.
  llmModelAds: process.env.LLM_MODEL_ADS || 'claude-opus-5',
  // cada cuánto opina sobre la publicidad (viernes 09:00 Chile: la semana ya
  // corrió y hay serie que leer, y queda tiempo de aplicar antes del fin de semana)
  adsAnalistaCron: process.env.ADS_ANALISTA_CRON || '0 9 * * 5',
  adsAnalistaActivo: process.env.ADS_ANALISTA_ACTIVO !== 'false',
  // autochequeos: corren temprano, antes de que nadie mire el tablero, para que
  // una invariante rota se sepa ANTES de tomar una decisión con ese número
  invariantesActivo: process.env.INVARIANTES_ACTIVO !== 'false',
  invariantesCron: process.env.INVARIANTES_CRON || '0 7 * * *',
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
  // Refresco de la curva de búsqueda. Corre a diario y solo toca las que
  // pasaron los 30 días, así que en régimen re-mide unas pocas por día en vez
  // de barrer la mesa de golpe. Cuesta una llamada de US$0,09 por pasada:
  // DataForSEO cobra por REQUEST y no por keyword.
  refrescoCurvasCron: process.env.REFRESCO_CURVAS_CRON || '15 9 * * *',
  refrescoCurvasDias: Number(process.env.REFRESCO_CURVAS_DIAS) || 30,
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
  //
  // 5 → 3 el 18-ago-2026, con la medición al lado. Sobre los 12 nichos con 8+
  // scans, leyendo el PROMEDIO de la serie el veredicto acierta 81% tanto con 3
  // como con 5 mediciones; el score no converge nunca (oscila ±5 pts para
  // siempre), así que el 4° y el 5° scan no compraban precisión — compraban
  // cinco días de demora y bloqueaban el radar por el tope de madurando. La
  // condición para que 3 alcance es leer el nivel, no el último valor: eso está
  // en nivelScore() de services/tablero.js, donde está el detalle.
  maduracionScans: Number(process.env.MADURACION_SCANS) || 3,
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
  // Sube de 12 a 16 el 30-ago-2026. El 12 se calibró contra el costo de Apify;
  // con Zyte el listado cuesta US$0,016 contra US$0,060 de karamelo —casi
  // cuatro veces menos— y el techo había quedado atado a un precio que ya no
  // existe: 37 nichos vencidos esperando turno con cupo de 12.
  //
  // La demanda en régimen es ~17,4/día (25 madurando cada 3 días = 8,3 más 59
  // semanales cada 6,5 = 9,1). Con 16 queda apenas por debajo, y es a
  // propósito: la cola se drena sola porque cada nicho que llega a sus 5 scans
  // pasa de 3 días a 6,5, así que la carga de maduración baja con el tiempo.
  scansMaxDia: Number(process.env.SCANS_MAX_DIA) || 16,
  // CADA CUÁNTO SE MIDE UN NICHO QUE MADURA.
  //
  // Era diario (umbral de 20 h) y no servía: la señal de demanda es el DELTA de
  // reseñas, y en 24 h ese delta es casi todo ruido. Medido el 30-ago-2026
  // sobre la mesa real —los tres nichos escaneados dos veces el mismo día
  // dieron ventana de 0,04 días y CERO reseñas nuevas, resolución 25/día—
  // mientras los de ventana ~3 días traían entre 16 y 135 reseñas nuevas.
  //
  // Además la ventana efectiva YA era de 2 a 8 días (mediana 8,3), porque el
  // delta se calcula contra el scan anterior CON reseñas y el nivel 2 no corre
  // en todos. O sea que escanear a diario no producía una señal diaria:
  // producía el mismo dato pagando el doble.
  //
  // Se elige 68 h (~3 días) y no 48 porque la propia mesa lo muestra: los
  // nichos con ventana de 2,21 días traían 5 a 35 reseñas nuevas, y los de
  // 3,06 días entre 16 y 135. Tres días es donde la señal deja de ser ruido.
  //
  // De paso libera el cupo diario para los semanales atrasados —había 37
  // vencidos con techo de 12— y baja el gasto de scraping a un tercio en la
  // mitad de la mesa.
  maduracionHoras: Number(process.env.MADURACION_HORAS) || 68,
  // API oficial de ML (OAuth, cuenta del propio vendedor) — opcionales: sin
  // ellas el resto del sistema funciona y /api/meli/conectar responde 503
  meliAppId: process.env.MELI_APP_ID || null,
  meliAppSecret: process.env.MELI_APP_SECRET || null,
  meliRedirectUri: process.env.MELI_REDIRECT_URI || null,
  port: Number(process.env.PORT) || 3000,
}
