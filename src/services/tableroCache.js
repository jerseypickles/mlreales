import { tableroOportunidades } from './tablero.js'

// LA MESA SE ARMA UNA VEZ Y SE SIRVE MUCHAS (21-oct-2026).
//
// "Hay que ir arreglando los tiempos: cuando entramos a Oportunidades se demora
// tanto, igual que apretar cotizar o sacar el cotizar". Medido en producción:
// GET /api/oportunidades tardaba 6,5 a 16 s en CADA pedido (919 KB), aunque
// nada hubiera cambiado — ni el 304 se salvaba, porque el ETag sale del cuerpo
// ya armado —, y cotizar o quitar la marca volvía a pedir la mesa entera.
//
// Ahora el tablero armado se guarda en memoria:
// - fresco (menos de 10 min) se entrega tal cual;
// - más viejo, o marcado viejo porque un scan o un análisis cambió datos por
//   detrás, se entrega igual y se rearma atrás (`refrescando`: la pantalla
//   vuelve a pedirlo en unos segundos);
// - un cambio del importador (cotizar, etapa, costo…) lo INVALIDA: el pedido
//   siguiente espera el cálculo nuevo y nunca recibe la mesa de antes del cambio.
// Los cálculos se comparten: dos pedidos a la vez esperan el mismo.
//
// Desde el 11-nov-2026 solo invalida lo que el importador cambia en la mesa o
// en un nicho. Lo que cambia en sus productos o publicaciones (un costo, medir,
// importar, auditar) la ENVEJECE y la manda a rearmar al tiro: antes, después de
// trabajar en Mis productos, entrar a Oportunidades era esperar el cálculo
// entero («varias interfaces cuesta mucho que carguen la información»).
//
// El estratega y los demás consumidores siguen llamando a tableroOportunidades
// directo: esto es solo para la pantalla.
export const FRESCO_MS = 10 * 60e3
export const VIEJO_MS = 24 * 3600e3

export function crearCacheTablero({
  calcular = tableroOportunidades,
  ahora = () => Date.now(),
  frescoMs = FRESCO_MS,
  viejoMs = VIEJO_MS,
  alFallar = (err) => console.warn(`[tablero] rearmado en segundo plano falló: ${err.message}`),
} = {}) {
  const guardado = new Map() // 'activos' | 'todos' → { valor, en, version, viejo }
  const enVuelo = new Map() // misma clave → { promesa, version }
  let version = 0
  // cada vez que algo envejece la mesa: un cálculo que venía en camino puede no traer ese cambio
  let generacion = 0

  function recalcular(clave, todos) {
    const actual = enVuelo.get(clave)
    if (actual && actual.version === version) return actual.promesa
    const ver = version
    const gen = generacion
    const inicio = Date.now()
    const promesa = Promise.resolve()
      .then(() => calcular({ todos }))
      .then((valor) => {
        // lo que tarda armar la mesa queda en el log (11-nov-2026): es lo que hay que mirar para optimizarla
        const ms = Date.now() - inicio
        if (ms >= 1000) console.log(`[tablero] mesa (${clave}) rearmada en ${ms} ms`)
        const en = ahora()
        // si alguien invalidó mientras se calculaba, el resultado puede ser de
        // antes del cambio: se entrega a quien lo pidió, pero no se guarda
        // y si algo la envejeció entremedio, se guarda ya vieja: el pedido siguiente la vuelve a rearmar
        if (ver === version) guardado.set(clave, { valor, en, version: ver, viejo: gen !== generacion })
        return { valor, en }
      })
    const registro = { promesa, version: ver }
    enVuelo.set(clave, registro)
    promesa
      .catch(() => {})
      .finally(() => {
        if (enVuelo.get(clave) === registro) enVuelo.delete(clave)
      })
    return promesa
  }

  async function leer({ todos = false } = {}) {
    const clave = todos ? 'todos' : 'activos'
    const g = guardado.get(clave)
    if (g && g.version === version) {
      const edad = ahora() - g.en
      if (!g.viejo && edad < frescoMs) return { oportunidades: g.valor, calculadoEl: new Date(g.en), refrescando: false }
      if (edad < viejoMs) {
        recalcular(clave, todos).catch(alFallar)
        return { oportunidades: g.valor, calculadoEl: new Date(g.en), refrescando: true }
      }
    }
    const { valor, en } = await recalcular(clave, todos)
    return { oportunidades: valor, calculadoEl: new Date(en), refrescando: false }
  }

  // un cambio del importador: lo guardado ya no se entrega
  function invalidar() {
    version++
  }

  // datos que cambiaron por detrás (scan, análisis): lo guardado sirve mientras se rearma
  function envejecer() {
    generacion++
    for (const g of guardado.values()) g.viejo = true
  }

  // lo mismo, y además manda a rearmar al tiro lo que ya estaba guardado (lo que nadie ha pedido no se calcula)
  function rearmar() {
    envejecer()
    for (const [clave, g] of guardado) if (g.version === version) recalcular(clave, clave === 'todos').catch(alFallar)
  }

  return { leer, invalidar, envejecer, rearmar }
}

const cache = crearCacheTablero()
export const leerTablero = cache.leer
export const invalidarTablero = cache.invalidar
export const envejecerTablero = cache.envejecer
export const rearmarTablero = cache.rearmar

// Middleware: toda escritura que responde bien invalida la mesa. Se invalida al
// TERMINAR la respuesta y no al entrar: invalidar antes de que el cambio llegue
// a la base dejaba que un cálculo simultáneo guardara la mesa vieja como nueva.
export function crearInvalidador(invalidar) {
  return (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      res.on('finish', () => {
        if (res.statusCode < 400) invalidar()
      })
    }
    next()
  }
}
export const invalidarAlEscribir = crearInvalidador(invalidarTablero)
// Para lo que cambia por fuera de la mesa (productos propios, publicaciones): la guardada se sigue entregando y
// el rearmado parte al tiro, así que cuando el importador llega a Oportunidades suele estar lista.
export const envejecerAlEscribir = crearInvalidador(rearmarTablero)

// Arma la mesa una vez al arrancar, para que la primera visita tras un deploy
// no pague el cálculo entero.
export function calentarTablero({ demoraMs = 60_000 } = {}) {
  const t = setTimeout(() => {
    leerTablero().catch((err) => console.warn(`[tablero] precalentado falló: ${err.message}`))
  }, demoraMs)
  t.unref?.()
}
