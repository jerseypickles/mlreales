import { Nicho } from '../models/Nicho.js'
import { TendenciaBusqueda } from '../models/TendenciaBusqueda.js'
import { sugerenciasReales, palabrasClave } from './busquedasReales.js'

// Verticales que el radar explora (espejo del prompt del sugeridor): el tracker
// vigila estos prefijos aunque el tablero aún no tenga nichos ahí, para que una
// búsqueda en alza se detecte antes de abrir el nicho.
export const SEMILLAS_VERTICALES = [
  'freidora',
  'hervidor',
  'ventilador',
  'humidificador',
  'plancha pelo',
  'masajeador',
  'organizador',
  'mochila',
  'termo',
  'fuente gato',
  'juguete perro',
  'lampara',
]

const MAX_PREFIJOS = 30

export function diaChile(fecha = new Date()) {
  // en-CA formatea YYYY-MM-DD
  return fecha.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
}

// El prefijo de un nicho es su primera palabra significativa: el autosuggest de
// "hervidor" muestra TODO lo que la gente busca alrededor del hervidor, no solo
// nuestra keyword.
export function prefijoDeKeyword(keyword) {
  return [...palabrasClave(keyword)][0] ?? null
}

export async function prefijosSemilla() {
  const nichos = await Nicho.find({ estado: 'activo' }).select('keyword').lean()
  const delTablero = nichos.map((n) => prefijoDeKeyword(n.keyword)).filter(Boolean)
  return [...new Set([...delTablero, ...SEMILLAS_VERTICALES])].slice(0, MAX_PREFIJOS)
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

// Pasada diaria: guarda el ranking del autocompletado por prefijo. Un 403 no
// aborta la pasada (el endpoint bloquea ráfagas): ese prefijo queda sin
// snapshot hoy y la comparación usará el último día que sí respondió.
export async function capturarTendencias({ pausaMs = 2000 } = {}) {
  const prefijos = await prefijosSemilla()
  const dia = diaChile()
  let consultados = 0
  let fallidos = 0
  for (const prefijo of prefijos) {
    if (consultados + fallidos > 0) await esperar(pausaMs)
    try {
      const sugerencias = await sugerenciasReales(prefijo)
      await TendenciaBusqueda.updateOne(
        { prefijo, dia },
        { $set: { sugerencias, fecha: new Date() } },
        { upsert: true },
      )
      consultados++
    } catch (err) {
      fallidos++
      console.error(`[tendencias] autosuggest falló para "${prefijo}": ${err.message}`)
    }
  }
  return { prefijos: prefijos.length, consultados, fallidos, dia }
}

// En alza = entró al ranking o subió posiciones. Las bajadas no interesan: el
// radar busca demanda subiendo. Pura para testear sin red ni Mongo.
export function calcularMovimientos(actual, anterior) {
  const posAntes = new Map(anterior.map((q, i) => [q, i + 1]))
  const movimientos = []
  actual.forEach((q, i) => {
    const posicion = i + 1
    const antes = posAntes.get(q) ?? null
    if (antes === null) movimientos.push({ q, posicion, antes, nueva: true })
    else if (antes > posicion) movimientos.push({ q, posicion, antes, nueva: false })
  })
  return movimientos
}

// Último snapshot de cada prefijo vs el de ~`dias` atrás (o el más antiguo
// disponible si la historia es corta). Sin historia previa → [].
export async function movimientosRecientes({ dias = 7 } = {}) {
  const ultimos = await TendenciaBusqueda.aggregate([
    { $sort: { prefijo: 1, dia: -1 } },
    { $group: { _id: '$prefijo', actual: { $first: '$$ROOT' } } },
  ])

  const resultado = []
  for (const { actual } of ultimos) {
    const diaLimite = diaChile(new Date(actual.fecha.getTime() - dias * 864e5))
    let base = await TendenciaBusqueda.findOne({ prefijo: actual.prefijo, dia: { $lte: diaLimite } })
      .sort({ dia: -1 })
      .lean()
    if (!base) {
      base = await TendenciaBusqueda.findOne({ prefijo: actual.prefijo, dia: { $lt: actual.dia } })
        .sort({ dia: 1 })
        .lean()
    }
    if (!base) continue
    for (const m of calcularMovimientos(actual.sugerencias, base.sugerencias)) {
      resultado.push({ prefijo: actual.prefijo, desde: base.dia, hasta: actual.dia, ...m })
    }
  }
  // lo más fuerte primero: nuevas en el ranking, luego las que más subieron
  return resultado.sort(
    (a, b) => b.nueva - a.nueva || ((b.antes - b.posicion) || 0) - ((a.antes - a.posicion) || 0),
  )
}

// Formato compacto para el prompt del sugeridor del radar.
export function lineasEnAlza(movimientos, { max = 15 } = {}) {
  return movimientos
    .slice(0, max)
    .map((m) =>
      m.nueva
        ? `"${m.q}" — entró al ranking de "${m.prefijo}" (puesto ${m.posicion})`
        : `"${m.q}" — subió ${m.antes}→${m.posicion} bajo "${m.prefijo}"`,
    )
}
