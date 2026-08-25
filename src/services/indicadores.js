import { importacion } from '../config/importacion.js'
import { Indicador } from '../models/Indicador.js'

// EL DÓLAR DE VERDAD, NO EL DEL ARCHIVO.
//
// `importacion.tipoCambioUsdClp` estaba fijo en 950 desde julio. El 25-ago-2026
// el dólar observado cerró en 914,64: un 3,7% de diferencia sobre TODO el
// costeo de importación —EXW, flete, seguro, arancel, IVA— justo cuando hay que
// cotizar contenedor. En una compra de US$20.000 son ~$700.000 de error, y
// siempre para el mismo lado: el modelo dice que cuesta más de lo que cuesta,
// así que mata nichos que sí daban.
//
// Ahora se lee de mindicador.cl (Banco Central, gratis, sin credenciales). El
// valor del archivo queda como RESPALDO: si la fuente no responde, el sistema
// sigue costeando con un número viejo antes que caerse — pero lo dice, y por
// eso `esRespaldo` viaja con el dato.

const FUENTE = 'https://mindicador.cl/api'
// el observado se publica una vez al día: pedirlo más seguido es ruido
const VIGENCIA_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 15_000

// caché en memoria: Render corre una instancia y el dato vale un día entero,
// así que no amerita colección propia en Mongo
// caché en memoria por delante de Mongo: Render corre una instancia
const cache = new Map()
// refrescos en vuelo, para no disparar diez fetch si llegan diez requests
const enVuelo = new Map()

async function pedirIndicador(codigo) {
  const control = new AbortController()
  const t = setTimeout(() => control.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(`${FUENTE}/${codigo}`, { signal: control.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json()
    const ultimo = j?.serie?.[0]
    if (!Number.isFinite(ultimo?.valor)) throw new Error('la serie vino sin valor')
    return { valor: ultimo.valor, fecha: new Date(ultimo.fecha) }
  } finally {
    clearTimeout(t)
  }
}

// Pura: decide si un valor cacheado sigue sirviendo. Separada para poder
// probar el vencimiento sin tocar la red ni el reloj global.
export function cacheVigente(entrada, ahora = Date.now(), vigenciaMs = VIGENCIA_MS) {
  if (!entrada?.leidoEl) return false
  return ahora - new Date(entrada.leidoEl).getTime() < vigenciaMs
}

// NUNCA BLOQUEA. mindicador.cl tarda entre 6 y 15 segundos —medido— y esto lo
// llama el simulador en cada carga. Así que se devuelve lo mejor que se tenga
// (memoria → Mongo → la constante del archivo) y el refresco corre por detrás
// para la próxima. La alternativa era una pantalla colgada 15 segundos para
// mejorar un número en 3,7%.
function refrescar(codigo) {
  if (enVuelo.has(codigo)) return enVuelo.get(codigo)
  const tarea = pedirIndicador(codigo)
    .then(async ({ valor, fecha }) => {
      const dato = { valor, fecha, fuente: 'mindicador.cl', esRespaldo: false }
      cache.set(codigo, { dato, leidoEl: Date.now() })
      try {
        await Indicador.findOneAndUpdate(
          { codigo },
          { $set: { valor, fecha, fuente: 'mindicador.cl', leidoEl: new Date() } },
          { upsert: true },
        )
      } catch {
        // sin Mongo el valor igual sirve en memoria; no vale tirar la petición
      }
      return dato
    })
    .catch((err) => {
      console.warn(`[indicadores] ${codigo} no se pudo refrescar: ${err.message}`)
      return null
    })
    .finally(() => enVuelo.delete(codigo))
  enVuelo.set(codigo, tarea)
  return tarea
}

async function indicador(codigo, respaldo) {
  const guardado = cache.get(codigo)
  if (cacheVigente(guardado)) return guardado.dato

  // lo que dejó la última corrida, aunque esté vencido: es infinitamente mejor
  // que la constante del archivo
  let deMongo = null
  try {
    deMongo = await Indicador.findOne({ codigo }).lean()
  } catch {
    // sin conexión a Mongo se sigue con lo que haya
  }
  if (deMongo) {
    const dato = {
      valor: deMongo.valor,
      fecha: deMongo.fecha,
      fuente: deMongo.fuente,
      esRespaldo: !cacheVigente(deMongo),
    }
    cache.set(codigo, { dato, leidoEl: new Date(deMongo.leidoEl).getTime() })
    if (dato.esRespaldo) refrescar(codigo) // por detrás, sin esperar
    return dato
  }

  // primera vez de la vida: acá sí conviene esperar, porque la alternativa es
  // costear con un número de julio
  const fresco = await refrescar(codigo)
  if (fresco) return fresco
  return { valor: respaldo, fecha: null, fuente: 'config/importacion.js', esRespaldo: true }
}

export function dolarObservado() {
  return indicador('dolar', importacion.tipoCambioUsdClp)
}

// La UF no la usa el costeo todavía, pero sí los precios en UF que aparecen al
// evaluar proveedores y servicios (SimpleAPI cobra 3 UF/año, por ejemplo).
export function uf() {
  return indicador('uf', null)
}

// Los parámetros de importación con el dólar del día ya puesto. Los servicios
// de margen siguen siendo puros y sincrónicos: quien los llama resuelve el
// tipo de cambio antes y se lo pasa como override.
export async function parametrosVigentes() {
  const dolar = await dolarObservado()
  return {
    ...importacion,
    tipoCambioUsdClp: Math.round(dolar.valor),
    tipoCambio: {
      valor: dolar.valor,
      fecha: dolar.fecha,
      fuente: dolar.fuente,
      esRespaldo: dolar.esRespaldo,
    },
  }
}

// para los tests: dejar la caché limpia entre casos
export function _limpiarCache() {
  cache.clear()
}
