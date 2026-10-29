const DIA = 86400e3

export function frescuraFuente(ultima, { ahora = new Date(), maxDias = 7 } = {}) {
  const t = ultima ? +new Date(ultima) : NaN
  const diasSinDatos = Number.isFinite(t) && t <= +ahora ? Math.floor((+ahora - t) / DIA) : null
  return { ultima: diasSinDatos === null ? null : ultima, diasSinDatos, maxDias,
    estado: diasSinDatos === null ? 'sin-datos' : diasSinDatos > maxDias ? 'atrasada' : 'al-dia' }
}

// La fecha del dato persiste aunque el servidor se reinicie. La ausencia de
// un error en memoria no significa que una fuente haya vuelto a entregar datos.
export async function saludFuentesMl({ ahora = new Date() } = {}) {
  const { Snapshot } = await import('../../models/Snapshot.js')
  const { LecturaResenia } = await import('../../models/LecturaResenia.js')
  const { RankingMasVendidos } = await import('../../models/RankingMasVendidos.js')
  const [api, diarias, ranking, fichas] = await Promise.all([
    Snapshot.findOne({ numReviewsApi: { $type: 'number' } }).sort({ fecha: -1 }).select('fecha').lean(),
    LecturaResenia.findOne().sort({ dia: -1 }).select('leidaEl').lean(),
    RankingMasVendidos.findOne().sort({ dia: -1 }).select('capturadoEl').lean(),
    Snapshot.findOne({ numReviews: { $type: 'number' } }).sort({ fecha: -1 }).select('fecha').lean(),
  ])
  return [
    { id: 'resenias-api', nombre: 'Reseñas de publicaciones por API', ...frescuraFuente(api?.fecha, { ahora, maxDias: 10 }), uso: 'Etiqueta del modelo de competidores.' },
    { id: 'resenias-diarias', nombre: 'Panel diario de reseñas', ...frescuraFuente(diarias?.leidaEl, { ahora, maxDias: 2 }), uso: 'Seguimiento diario; no reemplaza una lectura faltante por cero.' },
    { id: 'ranking', nombre: 'Ranking oficial de ML', ...frescuraFuente(ranking?.capturadoEl, { ahora, maxDias: 2 }), uso: 'Solo se compara con días y nichos efectivamente medidos.' },
    { id: 'resenias-ficha', nombre: 'Reseñas de fichas extraídas', ...frescuraFuente(fichas?.fecha, { ahora, maxDias: 10 }), uso: 'Fuente distinta: puede agrupar catálogos; no se mezcla con las reseñas por publicación.' },
  ]
}
