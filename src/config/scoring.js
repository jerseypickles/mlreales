// Pesos del score de oportunidad (0-100). Se aplican en Fase 2, cuando exista
// `vendidos` (nivel 2). Cada componente se normaliza a 0-100 antes de ponderar;
// la suma de pesos debe ser 1.
export const scoring = {
  pesos: {
    demanda: 0.4, // vendidos del top 50 + delta entre snapshots
    competencia: 0.25, // menos sellers únicos y menor concentración = más puntos
    calidad: 0.2, // rating promedio bajo el umbral = espacio para diferenciarse
    full: 0.15, // % de items con Full bajo = más puntos
  },
  umbrales: {
    ratingDiferenciacion: 4.4,
    pctFullBajo: 30,
  },
}
