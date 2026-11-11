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
//
// Cada caché dice con qué parte de la API cambia (`cambiaCon`): una escritura
// del dueño ahí lo invalida (`invalidarVivosAlEscribir`). Los que llevan nombre
// quedan anotados, y quien trae datos nuevos los envejece a todos sin conocerlos.

export function crearCacheVivo({
  calcular,
  nombre = null,
  frescoMs = 5 * 60e3,
  viejoMs = 24 * 3600e3,
  cambiaCon = [],
  ahora = () => Date.now(),
  alFallar = (err) => console.warn(`[${nombre ?? 'cache'}] rearmado en segundo plano falló: ${err.message}`),
} = {}) {
  let guardado = null // { valor, en, version, viejo }
  let enVuelo = null // { promesa, version }
  let version = 0
  // cada vez que llegan datos nuevos: un cálculo que venía en camino puede no traerlos
  let generacion = 0

  function recalcular() {
    if (enVuelo && enVuelo.version === version) return enVuelo.promesa
    const ver = version
    const gen = generacion
    const inicio = Date.now()
    const promesa = Promise.resolve()
      .then(() => calcular())
      .then((valor) => {
        const en = ahora()
        // si llegaron datos nuevos mientras se calculaba, se guarda ya viejo: la visita siguiente lo rearma
        if (ver === version) guardado = { valor, en, version: ver, viejo: gen !== generacion }
        // lo que tarda cada rearmado queda en el log: es lo que hay que mirar para saber si vale la pena optimizarlo
        const ms = Date.now() - inicio
        if (ms >= 1000) console.log(`[${nombre ?? 'cache'}] rearmado en ${ms} ms`)
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
  //   fresca: se pide un cálculo nuevo, que parte ahora (uno que ya venía en camino no sirve).
  //   soloFresca: lo guardado sirve solo si está fresco; si no, se espera el cálculo. Es para quien calcula con
  //   el dato; una pantalla sí puede mostrar el anterior mientras llega el nuevo.
  async function leer({ fresca = false, soloFresca = false } = {}) {
    if (fresca) version++
    const g = guardado
    if (g && g.version === version) {
      const edad = ahora() - g.en
      if (!g.viejo && edad < frescoMs) return { valor: g.valor, calculadoEl: new Date(g.en), refrescando: false }
      if (!soloFresca && edad < viejoMs) {
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
    generacion++
    if (guardado) guardado.viejo = true
  }

  // Deja el cálculo hecho sin que nadie lo pida (al arrancar, tras una medición).
  // Se resuelve cuando el cálculo terminó, para poder calentar varios de a uno.
  function calentar() {
    const g = guardado
    if (g && g.version === version && !g.viejo && ahora() - g.en < frescoMs) return Promise.resolve(g.valor)
    return recalcular().then(
      (r) => r.valor,
      (err) => {
        alFallar(err)
        return null
      },
    )
  }

  const cache = { leer, invalidar, envejecer, calentar, cambiaCon }
  if (nombre) registro.set(nombre, cache)
  return cache
}

// Los cachés vivos del proceso, por nombre: quien trae datos nuevos (el ciclo
// de medición de productos propios) los envejece a todos sin conocerlos.
const registro = new Map()

export const nombresCachesVivos = () => [...registro.keys()]

// De a uno: son cálculos pesados y todos a la vez se estorban (medido al
// arrancar el 11-nov-2026: uno que se cruzaba con otro tardó la mitad más).
async function calentarDeAUno(caches) {
  for (const c of caches) await c.calentar()
}

// Llegaron datos nuevos: lo guardado se sigue sirviendo mientras se rearman detrás.
// `solo`: los nombres de los que cambiaron, si no son todos.
export async function envejecerCachesVivos({ calentar = true, solo = null } = {}) {
  const todos = [...registro].filter(([nombre]) => !solo || solo.includes(nombre)).map(([, c]) => c)
  for (const c of todos) c.envejecer()
  if (calentar) await calentarDeAUno(todos)
}

// Al arrancar: deja cada respuesta hecha para que la primera visita después de
// un deploy no pague el cálculo entero. Calienta los que estén anotados cuando
// se cumple la demora.
export function calentarCachesVivos({ demoraMs = 20_000 } = {}) {
  const t = setTimeout(() => calentarDeAUno([...registro.values()]), demoraMs)
  t.unref?.()
}

// Middleware: una escritura del dueño que respondió bien invalida los cachés
// que dependen de esa parte de la API. Como en la mesa, se invalida al TERMINAR
// la respuesta: antes, un cálculo simultáneo guardaría lo viejo como nuevo.
export function invalidarVivosAlEscribir(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const ruta = req.originalUrl ?? req.url ?? ''
    res.on('finish', () => {
      if (res.statusCode >= 400) return
      for (const c of registro.values()) if (c.cambiaCon.some((prefijo) => ruta.startsWith(prefijo))) c.invalidar()
    })
  }
  next()
}
