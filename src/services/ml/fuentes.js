const DIA = 86400e3

export function frescuraFuente(ultima, { ahora = new Date(), maxDias = 7 } = {}) {
  const t = ultima ? +new Date(ultima) : NaN
  const diasSinDatos = Number.isFinite(t) && t <= +ahora ? Math.floor((+ahora - t) / DIA) : null
  return { ultima: diasSinDatos === null ? null : ultima, diasSinDatos, maxDias,
    estado: diasSinDatos === null ? 'sin-datos' : diasSinDatos > maxDias ? 'atrasada' : 'al-dia' }
}

// Pura. La más reciente de varias fechas; null si ninguna sirve.
export function masReciente(...fechas) {
  const t = fechas.map((f) => (f ? +new Date(f) : NaN)).filter(Number.isFinite)
  return t.length ? new Date(Math.max(...t)) : null
}

// La fecha del dato persiste aunque el servidor se reinicie. La ausencia de
// un error en memoria no significa que una fuente haya vuelto a entregar datos.
export async function saludFuentesMl({ ahora = new Date() } = {}) {
  const { Snapshot } = await import('../../models/Snapshot.js')
  const { LecturaResenia } = await import('../../models/LecturaResenia.js')
  const { RankingMasVendidos } = await import('../../models/RankingMasVendidos.js')
  const { SerieNichoMl } = await import('../../models/SerieNichoMl.js')
  const { CurvaEstacional } = await import('../../models/CurvaEstacional.js')
  const [api, diarias, ranking, fichas, series, curvas] = await Promise.all([
    Snapshot.findOne({ numReviewsApi: { $type: 'number' } }).sort({ fecha: -1 }).select('fecha').lean(),
    LecturaResenia.findOne().sort({ dia: -1 }).select('leidaEl').lean(),
    RankingMasVendidos.findOne().sort({ dia: -1 }).select('capturadoEl').lean(),
    Snapshot.findOne({ numReviews: { $type: 'number' } }).sort({ fecha: -1 }).select('fecha').lean(),
    SerieNichoMl.aggregate([{ $group: { _id: null, ultima: { $max: '$capturadoEl' } } }]),
    CurvaEstacional.aggregate([{ $group: { _id: null, ultima: { $max: '$medidoEl' } } }]),
  ])
  // LAS BÚSQUEDAS SON DE PAGO Y SE CORTAN SIN AVISAR. Medido el 10-nov-2026: el
  // proveedor llevaba tres días respondiendo "pago requerido" y nada lo decía;
  // mientras tanto los nichos nuevos quedaban sin curva (y sin puntaje), el radar
  // sin el volumen que decide qué entra y el modelo de demanda sin sus series.
  // Entra dato todos los días (series del aprendizaje o curvas refrescadas), así
  // que dos días en blanco ya son un corte y no un día flojo.
  const busquedas = masReciente(series[0]?.ultima, curvas[0]?.ultima)
  return [
    { id: 'busquedas', nombre: 'Búsquedas de Google', ...frescuraFuente(busquedas, { ahora, maxDias: 1 }), uso: 'Curvas de temporada, volumen para el radar y series del modelo de demanda. Es de pago y entra todos los días: si se atrasa, revisar el saldo del proveedor.' },
    { id: 'resenias-api', nombre: 'Reseñas de publicaciones por API', ...frescuraFuente(api?.fecha, { ahora, maxDias: 10 }), uso: 'Etiqueta del modelo de competidores.' },
    { id: 'resenias-diarias', nombre: 'Panel diario de reseñas', ...frescuraFuente(diarias?.leidaEl, { ahora, maxDias: 2 }), uso: 'Seguimiento diario; no reemplaza una lectura faltante por cero.' },
    { id: 'ranking', nombre: 'Ranking oficial de ML', ...frescuraFuente(ranking?.capturadoEl, { ahora, maxDias: 2 }), uso: 'Solo se compara con días y nichos efectivamente medidos.' },
    { id: 'resenias-ficha', nombre: 'Reseñas de fichas extraídas', ...frescuraFuente(fichas?.fecha, { ahora, maxDias: 10 }), uso: 'Fuente distinta: puede agrupar catálogos; no se mezcla con las reseñas por publicación.' },
  ]
}
