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
  },
  escalas: {
    // demanda = min(100, factorLog * log10(1 + vendidosTop50))
    // con factor 20: 10.000 vendidos ≈ 80 pts; 100.000 ≈ 100 pts
    demandaFactorLog: 20,
  },
}
