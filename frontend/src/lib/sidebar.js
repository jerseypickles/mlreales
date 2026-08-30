// Cómo se ordena la lista de nichos. Puro y sin JSX: es la regla de negocio
// del sidebar, no su pintura.
//
// El criterio maestro es la URGENCIA DE COMPRA, no el score: un nicho con
// score 90 y la ventana cerrada no se puede comprar, y uno de 65 con la
// ventana abierta sí. Y antes de eso está la pregunta que faltaba — ¿alguien
// busca esta keyword? — porque un nicho que nadie busca no es oportunidad
// aunque el análisis diga "entrar" (medido 9-ago: 65 de 78 decían entrar).

const VENTANA_ABIERTA = new Set(['ahora', 'ultimo-mes', 'pronto'])
const DE_ENTRADA = new Set(['entrar', 'entrar_con_condiciones'])

// Un "no entrar" sobre una keyword que la gente SÍ busca no es un cierre: es
// una duda. El rechazo pudo venir de leer mal el listado (caso paleta
// maquillaje: no_entrar por dominancia de marca con 42% de tiendas oficiales,
// cuando la regla del importador dice que la marca sola nunca basta si el
// nicho se mueve). Queda pendiente de escaneo, no descartado.
const BUSQUEDA_VIVA = new Set(['alto', 'medio'])
export const rechazadoPeroSeBusca = (n) =>
  n.veredicto === 'no_entrar' && BUSQUEDA_VIVA.has(n.nivelBusqueda?.nivel)

// CUATRO GRUPOS, NO NUEVE.
//
// El sidebar llegó a nueve contenedores para 81 nichos, y siete tenían filas.
// El importador lo cortó en seco —"aquí hay mucho contenedor, mientras sea más
// sencillo está bien"— y tiene razón: ocho de esos grupos eran matices de la
// misma pregunta, y un matiz que necesita su propio acordeón cuesta más de lo
// que informa.
//
// Las distinciones no se pierden, bajan de rango: lo que era un contenedor
// entero ahora es una marca en la fila (tiene precio, se busca igual, vuelve tal
// fecha, nadie lo busca). Se leen en el mismo barrido en vez de exigir abrir y
// cerrar cajas.
//
// Quedan las cuatro preguntas que el importador se hace de verdad:
//   comprar   → esto se decide ahora
//   vendiendo → esto ya es operación, no apuesta
//   espera    → esto vuelve solo, no lo toques
//   fuera     → esto está descartado
export function clasificarNicho(n) {
  if ((n.misProductos ?? 0) > 0) return 'vendiendo'

  // Un "no entrar" sobre una keyword que la gente SÍ busca sigue siendo dudoso,
  // pero ya no ocupa un grupo propio: cae en `fuera` con su marca al lado.
  const fuera = n.veredicto === 'no_entrar' || n.estado === 'pausado' || n.etapaCompra === 'descartado'
  if (fuera) return n.estado === 'pausado' && n.revisarEl ? 'espera' : 'fuera'

  // nadie escribe esa búsqueda NI NADA PARECIDO: el listado que mide no lo ve
  // ningún comprador. Se marca y se baja, nunca se pausa solo — descartar es
  // del importador.
  // OJO: "renombrar" NO baja al nicho. El producto se busca, solo la keyword
  // está mal, así que sigue siendo comprable y se queda en su grupo con el
  // aviso al lado. Degradarlo escondió "manguera extensible" (score 92, ya
  // cotizada y en su último mes para pedir) — el error contrario al que se
  // quería evitar.
  if (n.nivelBusqueda?.nivel === 'nulo') return 'fuera'

  // sin veredicto firme, o con la ventana todavía cerrada: el sistema los
  // sigue midiendo o los despierta cuando toque. En los dos casos no hay nada
  // que hacer hoy, que es lo único que el grupo tiene que comunicar.
  if (!DE_ENTRADA.has(n.veredicto) || n.madurando) return 'espera'

  const v = n.ventana
  const abierta = !v || v.estado === 'sin-temporada' || VENTANA_ABIERTA.has(v.estado)
  return abierta ? 'comprar' : 'espera'
}

// Marcas de fila: lo que antes justificaba un contenedor propio.
export const tienePrecio = (n) => Number.isFinite(n.exwCotizadoUsd) || Number.isFinite(n.costoPuestoClp)
export const sinBusqueda = (n) => n.nivelBusqueda?.nivel === 'nulo'
export const madurando = (n) => Boolean(n.madurando) || !DE_ENTRADA.has(n.veredicto)

export const GRUPOS = [
  {
    id: 'comprar',
    titulo: 'Comprar',
    abierto: true,
    ayuda: 'Ventana abierta y veredicto de entrada: acá se decide. Los que ya tienen precio del proveedor van marcados y ordenados primero.',
  },
  {
    id: 'vendiendo',
    titulo: 'Vendiendo',
    abierto: true,
    ayuda: 'Nichos con producto propio publicado: son operación, no apuesta.',
  },
  {
    id: 'espera',
    titulo: 'En espera',
    abierto: false,
    ayuda: 'Midiendo, con la ventana todavía cerrada, o en cuarentena con fecha de regreso. El sistema los mueve solo: hoy no hay nada que hacer con ellos.',
  },
  {
    id: 'fuera',
    titulo: 'Fuera',
    abierto: false,
    ayuda: 'No entrar, pausados, descartados a mano o sin búsqueda viva. Los marcados "se busca igual" son rechazos dudosos: la gente sí escribe esa keyword y conviene re-escanearlos antes de darlos por muertos.',
  },
]

// urgencia primero, score después
const ORDEN_VENTANA = { 'ultimo-mes': 0, ahora: 1, pronto: 2, 'sin-temporada': 3, futura: 4 }
const puntaje = (n) => n.ultimoReporte?.scoreOportunidad ?? -1
const urgencia = (n) => ORDEN_VENTANA[n.ventana?.estado] ?? 3

// ── El orden de la mesa de compra ──────────────────────────────────────────
// Primero LA BÚSQUEDA (si nadie escribe la keyword, el resto de las métricas
// describen un escaparate que no se abre), después EL MOMENTO (un nicho con la
// ventana cerrada no se puede comprar por bueno que sea) y recién ahí el score.
//
// EL NIVEL NO ES EL VOLUMEN, Y ORDENAR POR NIVEL ERA EL BUG.
//
// `nivelBusqueda.nivel` mide la posición de la keyword en el autocompletado de
// ML DENTRO DE SU PREFIJO: es relativo, no absoluto. "maquina coser" puede ser
// la primera de su prefijo —y salir "alto"— con 1.000 búsquedas al mes, y
// "waflera electrica" ser "medio" con 22.200.
//
// Medido el 30-ago-2026 sobre los 76 nichos de la mesa:
//   · dentro de "alto" el volumen va de 140 a 49.500 — 354 veces
//   · waflera (22.200, medio) quedaba DEBAJO de un "alto" de 140
//   · los 76 tienen volumen de Google Ads medido: no hace falta el proxy
//
// Así que ordena el volumen ABSOLUTO, que es comparable entre nichos. Va en
// BANDAS y no en el número crudo: 8.100 y 8.200 son la misma decisión, y
// reordenar la mesa por esa diferencia solo hace perder el hilo entre visitas.
const BANDAS_BUSQUEDA = [20_000, 8_000, 3_000, 1_000, 300]

// Sin volumen medido el nivel del autocompletado sigue siendo el mejor dato que
// hay: es peor que el número, pero mucho mejor que nada. Se mapea a la misma
// escala, en medias bandas, para que un volumen MEDIDO de 25.000 gane siempre a
// un "alto" sin medir, y ese "alto" gane a un "medio" sin medir.
const NIVEL_SIN_VOLUMEN = { alto: 1.5, medio: 2.5, bajo: 3.5, renombrar: 2.5 }

export function bandaBusqueda(o) {
  // "nadie la busca" no es un volumen bajo: es otra cosa. Va al fondo aunque
  // Google le mida tráfico, porque en ML ese escaparate no se abre.
  if (o?.nivelBusqueda?.nivel === 'nulo') return 9
  const v = o?.curvaAnual?.busquedasMes
  if (!Number.isFinite(v)) return NIVEL_SIN_VOLUMEN[o?.nivelBusqueda?.nivel] ?? 2.5
  const i = BANDAS_BUSQUEDA.findIndex((corte) => v >= corte)
  return i === -1 ? BANDAS_BUSQUEDA.length : i
}

export const rangoVentana = (o) => ORDEN_VENTANA[o?.ventana?.estado] ?? 3

export function compararOportunidades(a, b) {
  return (
    bandaBusqueda(a) - bandaBusqueda(b) ||
    rangoVentana(a) - rangoVentana(b) ||
    (b.score ?? -1) - (a.score ?? -1) ||
    // dentro de la banda y con el mismo score manda el volumen real, para que
    // el orden sea estable entre cargas
    ((b.curvaAnual?.busquedasMes ?? 0) - (a.curvaAnual?.busquedasMes ?? 0))
  )
}

// Devuelve Map<grupoId, nichos[]> ya ordenado dentro de cada grupo.
export function agruparNichos(nichos) {
  const porGrupo = new Map(GRUPOS.map((g) => [g.id, []]))
  for (const n of nichos) porGrupo.get(clasificarNicho(n))?.push(n)

  for (const [id, lista] of porGrupo) {
    if (id === 'vendiendo') lista.sort((a, b) => (b.misVentas30d ?? 0) - (a.misVentas30d ?? 0))
    // en "comprar" manda tener precio sobre la mesa: eso era un grupo propio y
    // ahora es lo primero del orden, que es donde de verdad se nota
    else if (id === 'comprar')
      lista.sort(
        (a, b) =>
          Number(tienePrecio(b)) - Number(tienePrecio(a)) ||
          urgencia(a) - urgencia(b) ||
          puntaje(b) - puntaje(a),
      )
    // "en espera" junta cosas que vuelven por caminos distintos: primero las
    // que tienen fecha de regreso, después por cuánto falta para su ventana
    else if (id === 'espera')
      lista.sort(
        (a, b) =>
          (a.ventana?.mesesAl ?? (a.revisarEl ? 99 : 50)) - (b.ventana?.mesesAl ?? (b.revisarEl ? 99 : 50)) ||
          puntaje(b) - puntaje(a),
      )
    else lista.sort((a, b) => urgencia(a) - urgencia(b) || puntaje(b) - puntaje(a))
  }
  return porGrupo
}

// Los que miden el mismo mercado se anidan bajo su líder cuando ambos caen en
// el mismo grupo; si el líder vive en otro, la fila queda suelta.
export function anidarFamilias(lista) {
  const enGrupo = new Set(lista.map((n) => n.keyword))
  const hijosDe = new Map()
  const raices = []
  for (const n of lista) {
    if (n.familiaLider && enGrupo.has(n.familiaLider)) {
      if (!hijosDe.has(n.familiaLider)) hijosDe.set(n.familiaLider, [])
      hijosDe.get(n.familiaLider).push(n)
    } else {
      raices.push(n)
    }
  }
  return raices.map((n) => ({ nicho: n, hijos: hijosDe.get(n.keyword) ?? [] }))
}
