// LA PUERTA DE ENTRADA DEL RADAR: ¿SE VENDE EN MERCADO LIBRE? (20-nov-2026)
//
// Hasta ese día un nicho nuevo se abría si Google medía 5.000 búsquedas al mes o más (decisión del 2-oct). Medido
// sobre los nichos activos: las búsquedas de Google casi no ordenan lo que después se vende en Mercado Libre. En
// cambio, lo que llevan vendido las primeras 50 publicaciones de la búsqueda, mirado el día en que se abrió cada
// nicho, ordena su venta posterior muy de cerca (docs/privado/scripts/calibrar-prueba-ml.mjs).
//
// Ese dato sale de UNA página de resultados. Antes de abrir un nicho el radar la pide, suma el cartel «+N vendidos»
// de las primeras 50 publicaciones que no son anuncio y lo compara con lo mismo de los nichos que ya se miden: lo
// que queda entre los más flojos no se abre. La vara no es un número elegido a mano: sale de los nichos activos
// cada vez, y con pocos nichos medidos no se aplica. Google sigue midiéndose, como dato de interés y de temporada.
//
// CUÁNTO CORTAR. Se probó el tercio más flojo y era demasiado: dejaba fuera dos nichos donde hoy hay ventas propias
// (se entró con un producto distinto en un nicho de poca venta). Con el 15% más flojo quedaban fuera casi solo
// nichos de venta baja, ninguno de venta alta y ninguno donde ya se vende; los nichos donde casi no se vende caen
// todos ahí. Es `RADAR_PRUEBA_FRACCION`: si la cartera cambia, se vuelve a medir con el mismo script.
//
// Ojo con lo que el cartel dice: es lo vendido en toda la vida de la publicación, en baldes. Ordena búsquedas entre
// sí; no es la venta de la semana ni cuenta unidades.
import { Reporte } from '../models/Reporte.js'
import { Nicho } from '../models/Nicho.js'
import { parsearNumero } from './normalizador.js'
import { config } from '../config/env.js'

const DIA = 86400e3
// las mismas 50 primeras que usa el scorecard de cada scan (metricas.vendidosHistoricos.pisoUnidades)
export const TOP_PRUEBA = 50
// con menos nichos medidos el tercio no dice nada: se abre sin vara, como antes de tenerla
export const MIN_NICHOS_VARA = 30

// Pura. Lo vendido por las primeras publicaciones de una página de resultados (las tarjetas de listadoMl.js).
export function leerPrueba(items, { top = TOP_PRUEBA } = {}) {
  const primeras = (items ?? []).filter((i) => i && i.esAnuncio !== true)
    .sort((a, b) => (a.itemPosition ?? Infinity) - (b.itemPosition ?? Infinity)).slice(0, top)
  const vendidos = primeras.map((i) => parsearNumero(i.cantidadVendida)).filter(Number.isFinite)
  return { vendidos: vendidos.reduce((a, b) => a + b, 0), conCartel: vendidos.length, publicaciones: primeras.length }
}

// Pura. La vara: el valor que deja debajo a la fracción más floja de los nichos medidos.
export function varaDe(valores, { fraccion = config.radarPruebaFraccion, minimo = MIN_NICHOS_VARA } = {}) {
  const v = (valores ?? []).filter(Number.isFinite).sort((a, b) => a - b)
  if (v.length < minimo) return null
  return { vara: v[Math.floor(v.length * fraccion)], nichos: v.length, fraccion }
}

// Pura. De cada 100 nichos medidos, cuántos tienen menos vendido en su primera página que este valor.
export function lugarEntre(valor, valores) {
  const v = (valores ?? []).filter(Number.isFinite)
  if (!v.length || !Number.isFinite(valor)) return null
  return Math.round((v.filter((x) => x < valor).length / v.length) * 100)
}

// Pura. ¿Pasa? Sin vara (pocos nichos medidos) pasa; sin medición no: un nicho abierto a ciegas son semanas de scans.
export function decidirPrueba(prueba, vara) {
  if (!prueba) return { pasa: false, motivo: 'sin-medir' }
  if (!vara) return { pasa: true, motivo: 'sin-vara' }
  return prueba.vendidos >= vara.vara ? { pasa: true, motivo: null } : { pasa: false, motivo: 'bajo-la-vara' }
}

// Pura. En qué orden se abren los que pasaron: primero los de fuentes que no vienen rindiendo mal y, dentro de eso,
// el que más lleva vendido. `flojas`: fuentes cuyos nichos, ya medidos, quedaron más veces entre los que menos venden
// que entre los que más (ml/fuentesRadar.js). Así el cupo del día va primero a lo que mejor viene resultando.
export function ordenarPorPrueba(candidatos, flojas = new Set()) {
  return [...(candidatos ?? [])].sort((a, b) =>
    Number(flojas.has(a.fuente)) - Number(flojas.has(b.fuente)) || (b.prueba?.vendidos ?? 0) - (a.prueba?.vendidos ?? 0))
}

// Lo vendido en la primera página de cada nicho activo, según su último scan (ya viene calculado en el scorecard).
export async function ventaDePrimeraPagina({ ahora = new Date(), dias = 60 } = {}) {
  const activos = await Nicho.find({ estado: 'activo' }).select('_id').lean()
  const filas = await Reporte.aggregate([
    { $match: { nichoId: { $in: activos.map((n) => n._id) }, fecha: { $gte: new Date(+ahora - dias * DIA) }, 'metricas.vendidosHistoricos.itemsDelScan': { $gte: 30 } } },
    { $project: { nichoId: 1, fecha: 1, v: '$metricas.vendidosHistoricos.pisoUnidades' } },
    { $sort: { fecha: -1 } },
    { $group: { _id: '$nichoId', v: { $first: '$v' } } },
  ])
  return filas.map((f) => f.v).filter(Number.isFinite)
}

export async function varaPruebaMl(opciones = {}) {
  const valores = await ventaDePrimeraPagina(opciones)
  return { ...(varaDe(valores) ?? { vara: null, nichos: valores.length, fraccion: config.radarPruebaFraccion }), valores }
}

// Una búsqueda, una página. `buscar` es el listado por Zyte, inyectable para probar sin red.
export async function probarEnMl(keyword, { buscar = null } = {}) {
  buscar ??= (await import('./listadoMl.js')).buscarNivel1Zyte
  const { items, costoUsd } = await buscar(keyword, { maxPaginas: 1 })
  return { ...leerPrueba(items), costoUsd: costoUsd ?? 0 }
}
