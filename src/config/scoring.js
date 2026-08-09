// Score de oportunidad (0-100). Cada componente se normaliza a 0-100 y se pondera;
// la suma de pesos debe ser 1. Interpretación: demanda alta + concentración baja +
// rating promedio bajo el umbral (espacio para diferenciarse) + poco Full = nicho atacable.
export const scoring = {
  pesos: {
    demanda: 0.4, // vendidos acumulados del top 50 (y ventas/día cuando hay ≥2 scans)
    competencia: 0.25, // 100 - concentración del top 3 sellers
    calidad: 0.2, // cuánto espacio deja el rating promedio bajo el umbral
    full: 0.15, // 100 - % de items con Full
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
    // demanda = min(100, factorLog * log10(1 + volumenVentasEstimado))
    // con factor 20: 10.000 ventas ≈ 80 pts; 100.000 ≈ 100 pts
    demandaFactorLog: 20,
    // ML no expone vendidos exactos (solo buckets congelados); la señal continua
    // es el conteo de reseñas: ~1 de cada N compradores reseña. Heurística ajustable.
    reviewsAVentasFactor: 25,
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
