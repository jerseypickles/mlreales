// Score de oportunidad (0-100). Cada componente se normaliza a 0-100 y se pondera;
// la suma de pesos debe ser 1.
//
// REESCRITO EL 15-AGO PORQUE EL SCORE IBA AL REVÉS.
//
// Medido sobre los 44 nichos de la mesa: el score correlacionaba **−0,61** con
// el porcentaje del top que había vendido algo alguna vez. Los 10 mejores
// puntajes tenían 60% de despegue; los 10 peores, 92%. Premiaba sistemáticamente
// los nichos donde nadie vende.
//
// La causa no era un bug sino la doctrina vieja —"rating bajo + poco Full =
// nicho atacable"— y estaba en dos componentes:
//   · `calidad` (20%): premiaba rating promedio bajo como "espacio para
//     diferenciarse". Correlación −0,88. No distingue "productos malos con
//     clientes descontentos" de "productos que nadie compró".
//   · `full` (15%): era literalmente `100 − pctFull`, o sea premiaba la AUSENCIA
//     de vendedores en Full. Contradice la medición propia del importador: 105
//     visitas semanales dentro de Full contra 2 fuera. El respaldo de Full ya se
//     premia dentro del componente de demanda, así que sacarlo no pierde señal.
//
// Los dos se retiran y entran tres que responden preguntas de negocio reales:
//   · constancia — ¿vende todo el año o solo en su pico? Un estacional te deja
//     el capital dormido 10 meses y su stock sobrante paga bodega Full.
//   · entrada    — ¿puedo entrar? Muro del líder (vendidos acumulados del #1) y
//     cuánto del top es catálogo, donde todos comparten página y no hay forma
//     de diferenciarse con fotos ni descripción.
//   · economia   — ¿la contribución por venta paga el costo de comprar un
//     cliente? Medido en la cuenta propia: CAC $1.717. Bajo cierto ticket NO
//     existe configuración de publicidad que funcione.
//
// Resultado de la simulación: todo-el-año 62→72, estacional 70→62, y la
// correlación con el despegue pasa de −0,61 a +0,23.
export const scoring = {
  pesos: {
    demanda: 0.28, // búsqueda real en Google (Chile) + respaldo de vendedores en Full
    constancia: 0.2, // qué tan plano es el año (ratio del pico medido con Trends)
    entrada: 0.22, // muro del líder + espacio para diferenciarse (no catálogo)
    economia: 0.2, // contribución por venta contra el CAC de publicidad
    competencia: 0.1, // 100 - concentración del top 3 sellers
  },
  // ¿ALGUIEN BUSCA LA KEYWORD? (services/nivelBusqueda.js). El scorecard entero
  // describe el listado que devuelve ESA búsqueda: si nadie la escribe, mide un
  // escaparate que ningún comprador abre. No se anula el score —los datos del
  // listado son reales— se le descuenta la confianza, y el bruto queda a la
  // vista para poder auditarlo.
  confianzaBusqueda: {
    alto: 1, // la gente la escribe tal cual
    medio: 1,
    bajo: 0.9, // cola larga: existe, pero es una fracción de su búsqueda madre
    renombrar: 0.75, // el producto se busca con OTRA frase: hay que republicar apuntando allá
    nulo: 0.5, // ni la keyword ni nada parecido
  },

  umbrales: {
    ratingDiferenciacion: 4.4, // rating promedio >= umbral → componente calidad = 0
    ratingPiso: 3.5, // rating promedio <= piso → componente calidad = 100
    // items del top con dato de reseñas para que la demanda sea medible:
    // con menos que esto (detalle bloqueado a medias) mejor no medir que medir mal
    minItemsDemanda: 5,
    // items con rating para que el componente calidad sea creíble: 6 productos
    // con 5.0 de 2 reseñas no prueban que "no hay espacio" — bajo esto, neutro
    minItemsCalidad: 5,
  },
  escalas: {
    // respaldo de Full: con este número de vendedores distintos con stock
    // inmovilizado se considera evidencia plena de que el producto rota
    sellersFullPlenos: 12,
    // cuánto puede levantar ese respaldo al componente de demanda
    pesoRespaldoFull: 0.35,
    // demanda = min(100, factorLog * log10(1 + volumenVentasEstimado))
    // con factor 20: 10.000 ventas ≈ 80 pts; 100.000 ≈ 100 pts
    demandaFactorLog: 20,
    // CONSTANCIA. ratioPico = pico / promedio del año (Google Trends, 5 años).
    // Un ratio ≤ este vale 100 puntos: el año es plano y el capital rota.
    // "árbol de navidad" da 5,31 → 24 puntos; "sandwichera" da 1,31 → 99.
    ratioPlano: 1.3,
    // ENTRADA — muro del líder. Vendidos acumulados de la publicación más fuerte
    // del nicho (badge "+N vendidos"). Medido en la mesa: 19 de 44 nichos tienen
    // un líder con ≥10.000 unidades, y solo 2 por debajo de 1.000. El muro se
    // puntúa en escala log entre el balde mínimo de ML y el techo de acá.
    muroMinimo: 25, // el balde más chico que ML muestra
    muroTecho: 50_000, // líder inalcanzable sin capital de guerra
    // ECONOMÍA — costo de comprar un cliente con Product Ads, medido en la
    // cuenta propia (CAC = gasto / unidades atribuidas, con target ROAS 3,0x).
    // Recalibrar cuando haya más historia de campañas.
    cacClp: 1717,
    // cuántas veces el CAC tiene que caber en la contribución para valer 100
    cacVecesPlenas: 20,
  },
  // Depuración del delta de reseñas. Los items de catálogo muestran el AGREGADO
  // de todos los vendedores del producto: cuando ML consolida la familia, el
  // conteo salta de nivel sin venta alguna (mancuernas 30-jul: +672 en 6 días
  // sobre 811 acumuladas, +83% — imposible orgánico), y dos listings del mismo
  // catálogo repiten el mismo conteo (doble conteo). Sin esto, cada salto se
  // multiplica por el factor 25 y el nicho "vende" miles al día.
  depuracionDelta: {
    // delta creíble por item: max(pisoPorDia, maxPctDia × acumulado previo) × días
    maxPctDia: 0.02,
    pisoPorDia: 30,
    // dos SKUs con el mismo conteo antes→después y ≥ este acumulado comparten
    // el agregado del catálogo: se cuenta una sola vez
    dedupeMinConteo: 50,
    // ventana mínima del delta: contra el scan de ayer (cadencia diaria) una
    // sola reseña ya equivale a ~27 ventas/día — todo lo que venda menos sale
    // "0" por pura resolución. Comparar contra el scan de hace ≥N días baja el
    // piso de detección a ~25/N ventas/día y el cero vuelve a significar algo.
    ventanaMinDias: 3,
    // por debajo de esto no se publica tasa/día: un re-scan manual encima del
    // automático deja ventanas de minutos, y ahí tanto el 0 como el positivo
    // son ruido de resolución, no medición. Es un tope contra ventanas
    // degeneradas, no la resolución buena (esa la fija ventanaMinDias): medio
    // día deja holgura para que la cadencia diaria siga midiendo aunque el cron
    // corra unos minutos antes que el día anterior.
    ventanaMinTasaDias: 0.5,
  },
}
