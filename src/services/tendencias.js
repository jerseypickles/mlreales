import { Nicho } from '../models/Nicho.js'
import { TendenciaBusqueda } from '../models/TendenciaBusqueda.js'
import { sugerenciasReales, palabrasClave } from './busquedasReales.js'

// Verticales que el radar explora (espejo del prompt del sugeridor): el tracker
// vigila estos prefijos aunque el tablero aún no tenga nichos ahí, para que una
// búsqueda en alza se detecte antes de abrir el nicho.
// De estas raíces sale el autocompletado que el radar mira para saber qué está
// subiendo. Eran 12 y todas de hogar y belleza, así que el radar exploraba con
// los ojos puestos siempre en el mismo pasillo: de los 63 nichos del tablero,
// la mitad salieron de ahí. Se suman las verticales que faltaban —cocina,
// ferretería, computación, calzado genérico, salud— para que el tracker las
// vea de verdad y no por casualidad.
//
// Son PREFIJOS, no keywords: el autosuggest de "escurridor" muestra todo lo que
// la gente busca alrededor, no una frase sola.
export const SEMILLAS_VERTICALES = [
  // hogar y electrohogar
  'freidora',
  'hervidor',
  'ventilador',
  'humidificador',
  'organizador',
  'lampara',
  // cocina (destapado el 16-ago: "escurridor de platos" son 6.600/mes, plano,
  // 41% tiendas oficiales y deja $9.702 por venta — y el radar nunca lo miró)
  'escurridor',
  'sartenes',
  'dispensador',
  // ferretería y herramientas
  'taladro',
  'nivel laser',
  'destornillador',
  'extension electrica',
  // COMPUTACIÓN Y GAMING COMPLETOS, con marca y todo.
  //
  // Estaba acotado a "accesorios, nunca equipos" y sin nada de gaming, por el
  // prejuicio de que Logitech, Razer y HyperX no dejan espacio. El importador
  // lo corrigió el 25-ago y tiene sus propios criterios de respaldo: "marca
  // dominante NUNCA es no_entrar por sí sola" y "la publicidad compra la
  // posición que no se gana orgánicamente". Probado en brochas, donde entró
  // con 63% de Full y marcas arriba, y vende 35 u/semana ganando por precio.
  //
  // Los volúmenes justifican mirarlo: silla gamer 40.500/mes, webcam 27.100,
  // audífonos bluetooth 27.100, mouse inalámbrico 14.800 — más que casi todo
  // el tablero actual.
  'soporte notebook',
  'hub usb',
  'mouse gamer',
  'teclado gamer',
  'audifonos gamer',
  'silla gamer',
  'teclado mecanico',
  'webcam',
  'audifonos bluetooth',
  'mouse inalambrico',
  'cargador inalambrico',
  'parlante bluetooth',
  // calzado genérico: el que se compra por función y no por logo
  'pantuflas',
  'zuecos',
  // salud y bienestar
  'faja',
  'masajeador',
  'corrector postura',
  // MOBILIARIO QUE CABE EN FULL. La restricción manda sobre la categoría: ML
  // acepta hasta 20 kg, ningún lado sobre 120 cm y la suma de los tres bajo
  // 260 cm, y encima cobra el envío por peso VOLUMÉTRICO (4.000 cm³/kg), así
  // que un bulto liviano pero grande paga como si pesara mucho.
  //
  // Por eso las semillas son plegables, flotantes o de armar — no "mueble" a
  // secas, que traería sofás y camas que no entran ni al despacho ni al margen.
  'mesa auxiliar',
  'repisa flotante',
  'escritorio plegable',
  'zapatero',
  // belleza, mascotas, viaje
  'plancha pelo',
  'mochila',
  'termo',
  'fuente gato',
  'juguete perro',
]

// 25 semillas fijas + margen para que el tablero también aporte sus prefijos
// 40 → 55: con las semillas de computación y gaming las verticales solas ya
// ocupaban los 40 cupos y las keywords del propio tablero quedaban sin
// capturar. El autosuggest de ML es gratis; el costo de subirlo es tiempo y
// riesgo de bloqueo anti-ráfaga, que el job ya maneja con pausas.
const MAX_PREFIJOS = 55

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

// LAS SEMILLAS VAN PRIMERO, Y POR ESO EXISTEN.
//
// Iban después de los prefijos del tablero y todo se cortaba en 30. Con 63
// nichos activos el tablero solo llenaba el cupo, así que las semillas —que
// existen justamente para mirar donde el tablero NO tiene nada— casi nunca
// entraban. El tracker terminaba explorando el mismo pasillo del que ya venían
// los nichos, y el radar con él.
//
// Ahora las semillas se garantizan y el tablero llena el resto: descubrir
// verticales nuevas es el trabajo de esta función, seguir las conocidas es un
// beneficio secundario.
export async function prefijosSemilla() {
  const nichos = await Nicho.find({ estado: 'activo' }).select('keyword').lean()
  const delTablero = nichos.map((n) => prefijoDeKeyword(n.keyword)).filter(Boolean)
  return [...new Set([...SEMILLAS_VERTICALES, ...delTablero])].slice(0, MAX_PREFIJOS)
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
