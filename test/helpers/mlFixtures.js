import { periodoMes } from '../../src/services/ml/series.js'

// Datos SINTÉTICOS para comprobar el algoritmo, no evidencia del negocio.
export function seriesSinteticas({ n = 5, meses = 48, crecimiento = 0.025 } = {}) {
  return Array.from({ length: n }, (_, k) => ({ keyword: `sintetica-${k}`,
    meses: Array.from({ length: meses }, (_, i) => ({ periodo: periodoMes(2022 * 12 + i),
      valor: Math.round((1000 + k * 200) * Math.exp(i * crecimiento) * (1 + 0.5 * Math.sin(i / 12 * 2 * Math.PI))) })) }))
}

export function comercialesSinteticas({ productos = 32, semanas = 20 } = {}) {
  return Array.from({ length: productos }, (_, i) => Array.from({ length: semanas }, (_, w) => {
    const desde = new Date(Date.UTC(2025, 0, 1 + w * 7))
    const precio = 5000 + i * 500
    const full = i % 2 === 0
    const categoria = `categoria-${i % 2}`
    const unidades = Math.round(Math.expm1(0.5 + Math.log(precio) * 0.1 + Number(full) * 0.2) * 10)
    return { itemId: `producto-${i}`, titulo: `Sintético ${i}`, categoria,
      desde, hasta: new Date(+desde + 7 * 86400e3), visitas: 1000, unidades, precio, full }
  })).flat()
}
