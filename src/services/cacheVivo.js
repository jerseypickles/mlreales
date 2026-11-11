// UNA RESPUESTA CARA, GUARDADA Y SERVIDA AL TIRO (11-nov-2026).
//
// Pedido del importador: «varias interfaces cuesta mucho que carguen la
// información: Mis productos toma mucho tiempo». Medido ese día: la lista de
// Mis productos se rearmaba entera en cada visita y tardaba más de diez
// segundos, y el plan de campañas entre cinco y diez; ninguna de las dos cambia
// entre una visita y la siguiente, solo cuando termina una medición o el dueño
// edita algo.
//
// Es la misma idea que ya usaba la mesa de Oportunidades (tableroCache.js),
// suelta de la mesa para que cualquier respuesta cara la use:
//   - fresca: se entrega lo guardado.
//   - vieja (pasó `frescoMs` o alguien llamó `envejecer`): se entrega lo
//     guardado y se rearma detrás; la próxima visita ya trae lo nuevo.
//   - invalidada (el dueño cambió algo) o sin nada guardado: se espera el
//     cálculo, porque mostrarle lo de antes de su cambio sería mentirle.
// Un cálculo que partió antes de una invalidación no pisa al nuevo, y dos
// visitas a la vez comparten el mismo cálculo.

export function crearCacheVivo({
  calcular,
  nombre = 'cache',
  frescoMs = 5 * 60e3,
  viejoMs = 24 * 3600e3,
  ahora = () => Date.now(),
  alFallar = (err) => console.warn(`[${nombre}] rearmado en segundo plano falló: ${err.message}`),
} = {}) {
  let guardado = null // { valor, en, version, viejo }
  let enVuelo = null // { promesa, version }
  let version = 0

  function recalcular() {
    if (enVuelo && enVuelo.version === version) return enVuelo.promesa
    const ver = version
    const inicio = Date.now()
    const promesa = Promise.resolve()
      .then(() => calcular())
      .then((valor) => {
        const en = ahora()
        if (ver === version) guardado = { valor, en, version: ver, viejo: false }
        // lo que tarda cada rearmado queda en el log: es lo que hay que mirar para saber si vale la pena optimizarlo
        const ms = Date.now() - inicio
        if (ms >= 1000) console.log(`[${nombre}] rearmado en ${ms} ms`)
        return { valor, en }
      })
    const registro = { promesa, version: ver }
    enVuelo = registro
    promesa
      .catch(() => {})
      .finally(() => {
        if (enVuelo === registro) enVuelo = null
      })
    return promesa
  }

  // { valor, calculadoEl, refrescando }
  async function leer({ fresca = false } = {}) {
    const g = guardado
    if (!fresca && g && g.version === version) {
      const edad = ahora() - g.en
      if (!g.viejo && edad < frescoMs) return { valor: g.valor, calculadoEl: new Date(g.en), refrescando: false }
      if (edad < viejoMs) {
        recalcular().catch(alFallar)
        return { valor: g.valor, calculadoEl: new Date(g.en), refrescando: true }
      }
    }
    const { valor, en } = await recalcular()
    return { valor, calculadoEl: new Date(en), refrescando: false }
  }

  // el dueño cambió algo: lo guardado ya no vale y hay que esperar el nuevo
  function invalidar() {
    version++
  }

  // llegaron datos nuevos: lo guardado sirve mientras se rearma detrás
  function envejecer() {
    if (guardado) guardado.viejo = true
  }

  // deja el cálculo hecho sin que nadie lo pida (al arrancar, tras una medición)
  function calentar() {
    return leer().catch((err) => {
      alFallar(err)
      return null
    })
  }

  const cache = { leer, invalidar, envejecer, calentar }
  registro.set(nombre, cache)
  return cache
}

// Los cachés vivos del proceso, por nombre: quien trae datos nuevos (el ciclo
// de medición de productos propios) los envejece a todos sin conocerlos.
const registro = new Map()

// Llegaron datos nuevos: se sirven los guardados mientras se rearman detrás.
export function envejecerCachesVivos({ calentar = true } = {}) {
  for (const c of registro.values()) {
    c.envejecer()
    if (calentar) c.calentar()
  }
}

// Al arrancar: deja cada respuesta hecha, de a una, para que la primera visita
// después de un deploy no pague el cálculo entero.
export function calentarCachesVivos({ demoraMs = 20_000, pasoMs = 15_000 } = {}) {
  let i = 0
  for (const c of registro.values()) {
    const t = setTimeout(() => c.calentar(), demoraMs + i * pasoMs)
    t.unref?.()
    i++
  }
}
