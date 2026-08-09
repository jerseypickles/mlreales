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

export function clasificarNicho(n) {
  if ((n.misProductos ?? 0) > 0) return 'vendiendo'

  if (rechazadoPeroSeBusca(n)) return 'revisar'

  const fuera = n.veredicto === 'no_entrar' || n.estado === 'pausado' || n.etapaCompra === 'descartado'
  if (fuera) return n.estado === 'pausado' && n.revisarEl ? 'vuelven' : 'fuera'

  // nadie escribe esa búsqueda NI NADA PARECIDO: el listado que mide no lo ve
  // ningún comprador. Se marca y se baja, nunca se pausa solo — descartar es
  // del importador.
  // OJO: "renombrar" NO baja al nicho. El producto se busca, solo la keyword
  // está mal, así que sigue siendo comprable y se queda en su grupo con el
  // aviso al lado. Degradarlo escondió "manguera extensible" (score 92, ya
  // cotizada y en su último mes para pedir) — el error contrario al que se
  // quería evitar.
  if (n.nivelBusqueda?.nivel === 'nulo') return 'sinBusqueda'

  if (!DE_ENTRADA.has(n.veredicto) || n.madurando) return 'midiendo'

  const v = n.ventana
  const abierta = !v || v.estado === 'sin-temporada' || VENTANA_ABIERTA.has(v.estado)
  if (!abierta) return 'aunNo'

  // ya hay precio del proveedor sobre la mesa: lo único que falta es decidir
  const cotizado = Number.isFinite(n.exwCotizadoUsd) || Number.isFinite(n.costoPuestoClp)
  return cotizado ? 'decidir' : 'comprar'
}

export const GRUPOS = [
  {
    id: 'decidir',
    titulo: '🔥 Con precio · decide',
    abierto: true,
    ayuda: 'Ventana de compra abierta y cotización del proveedor anotada: falta tu decisión.',
  },
  {
    id: 'comprar',
    titulo: '🎯 Comprar esta temporada',
    abierto: true,
    ayuda: 'Ventana de compra abierta y veredicto de entrada, pero todavía sin precio del proveedor.',
  },
  {
    id: 'vendiendo',
    titulo: '🛒 Vendiendo · mis nichos',
    abierto: true,
    ayuda: 'Nichos donde ya vendes con producto propio cableado: son operación, no apuesta.',
  },
  {
    id: 'midiendo',
    titulo: '⏳ Midiendo',
    abierto: false,
    ayuda: 'Sin veredicto firme todavía: el sistema los escanea solo hasta juntar la serie.',
  },
  {
    id: 'revisar',
    titulo: '🔁 Rechazados pero se buscan',
    abierto: false,
    ayuda: 'El analista dijo no entrar, pero la gente SÍ escribe esa búsqueda. El rechazo puede estar mal leído: quedan pendientes de un escaneo nuevo en vez de descartados.',
  },
  {
    id: 'aunNo',
    titulo: '📅 Aún no toca',
    abierto: false,
    ayuda: 'Buenos, pero su ventana de compra abre más adelante. Ordenados por cuánto falta.',
  },
  {
    id: 'sinBusqueda',
    titulo: '🔇 Nadie los busca',
    abierto: false,
    ayuda: 'Ni la keyword ni ninguna de sus palabras tiene búsquedas vivas en ML: aquí no hay producto que medir.',
  },
  {
    id: 'vuelven',
    titulo: '♻️ Vuelven solos',
    abierto: false,
    ayuda: 'Descartados por temporada con fecha de regreso: el sistema los reactiva solo.',
  },
  { id: 'fuera', titulo: '🗑 Fuera', abierto: false, ayuda: 'No entrar, pausados o descartados a mano.' },
]

// urgencia primero, score después
const ORDEN_VENTANA = { 'ultimo-mes': 0, ahora: 1, pronto: 2, 'sin-temporada': 3, futura: 4 }
const puntaje = (n) => n.ultimoReporte?.scoreOportunidad ?? -1
const urgencia = (n) => ORDEN_VENTANA[n.ventana?.estado] ?? 3

// ── El orden de la mesa de compra ──────────────────────────────────────────
// Primero LA BÚSQUEDA (si nadie escribe la keyword, el resto de las métricas
// describen un escaparate que no se abre), después EL MOMENTO (un nicho con la
// ventana cerrada no se puede comprar por bueno que sea) y recién ahí el score.
// Sin medir queda en el medio: no adelanta a una búsqueda alta ni cae al fondo.
const ORDEN_BUSQUEDA = { alto: 0, medio: 1, bajo: 2, renombrar: 3, nulo: 4 }
export const rangoBusqueda = (o) => ORDEN_BUSQUEDA[o?.nivelBusqueda?.nivel] ?? 1.5
export const rangoVentana = (o) => ORDEN_VENTANA[o?.ventana?.estado] ?? 3

export function compararOportunidades(a, b) {
  return (
    rangoBusqueda(a) - rangoBusqueda(b) ||
    rangoVentana(a) - rangoVentana(b) ||
    (b.score ?? -1) - (a.score ?? -1)
  )
}

// Devuelve Map<grupoId, nichos[]> ya ordenado dentro de cada grupo.
export function agruparNichos(nichos) {
  const porGrupo = new Map(GRUPOS.map((g) => [g.id, []]))
  for (const n of nichos) porGrupo.get(clasificarNicho(n))?.push(n)

  for (const [id, lista] of porGrupo) {
    if (id === 'vendiendo') lista.sort((a, b) => (b.misVentas30d ?? 0) - (a.misVentas30d ?? 0))
    else if (id === 'aunNo')
      lista.sort((a, b) => (a.ventana?.mesesAl ?? 99) - (b.ventana?.mesesAl ?? 99) || puntaje(b) - puntaje(a))
    else if (id === 'vuelven') lista.sort((a, b) => new Date(a.revisarEl) - new Date(b.revisarEl))
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
