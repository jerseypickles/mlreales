// QUÉ TEMPORADAS SE ALCANZAN SI SE PAGA HOY. Pura: recibe la fecha y devuelve
// el calendario ya resuelto, para que ni el radar ni la mesa tengan que sacar
// la cuenta —y sobre todo para que no la saque un LLM, que la saca mal.
//
// Lo pidió el importador el 17-sep-2026: "el radar debe seguir siendo
// inteligente: ya estamos en septiembre, aún queda tiempo para verano, después
// escolaridad… y no va a pedir Navidad cuando ya estamos dentro, porque los
// contenedores demoran y entran casi a mitad de noviembre y diciembre". El día
// anterior el radar había abierto "billetera hombre cuero" como regalo de
// Navidad y la mesa rotulaba el árbol de Navidad "último mes para pedir": la
// regla vieja contaba en MESES (pico − 2) y no distinguía una temporada que se
// acaba en una fecha de una que sigue dos meses más.
//
// El reloj, en días desde que se le paga al proveedor:
//   producción + mar + internación + ingreso a bodega ....... 45 días
//     (lo corrigió el importador el 17-sep-2026: "ojo, son 45 días"; la primera
//      versión suponía 50-70). Para las temporadas de fin duro se suman 10 días
//      de holgura por si el barco se atrasa: con 45 clavados, Navidad todavía
//      "alcanzaba" el 17-sep, y él mismo dijo que ya no se pide.
//   publicar, juntar las primeras ventas y ganar posición ... 15 días
// Una temporada de FIN DURO (Navidad, vuelta a clases, Halloween) exige el caso
// pesimista: si el barco se atrasa, el stock duerme un año. Una temporada larga
// (verano, invierno) tolera llegar con ella empezada, hasta un tercio adentro.

export const LEAD_DIAS_MIN = Number(process.env.LEAD_DIAS_MIN) || 45
export const LEAD_DIAS_MAX = Number(process.env.LEAD_DIAS_MAX) || 55
export const RAMPA_DIAS = Number(process.env.RAMPA_DIAS) || 15
// más lejos que esto no se propone todavía: comprar antes es capital dormido
const HORIZONTE_PROPUESTA_DIAS = 90
const DIA = 86400e3
const ORDEN = { justo: 0, 'a-tiempo': 0, 'todavia-no': 1, 'ya-no-llega': 2 }

// `pico`: desde cuándo el stock tiene que estar VENDIENDO. `fin`: cuándo se
// acaba. Fechas [mes, día]; si `fin` es anterior a `pico` en el calendario, la
// temporada cruza el año.
export const TEMPORADAS = [
  { id: 'verano', nombre: 'Verano', pico: [12, 20], fin: [2, 28], finDuro: false,
    productos: 'playa, piscina, camping, sol, ventilación y frío, terraza y asado, deportes de agua, viaje' },
  { id: 'navidad', nombre: 'Navidad y fin de año', pico: [11, 25], fin: [12, 24], finDuro: true,
    productos: 'adornos, luces, árboles, regalos típicos de Navidad, cotillón de año nuevo',
    palabras: /navidad|navide|pascuero|adviento|pesebre|a[nñ]o nuevo/i },
  { id: 'vuelta-a-clases', nombre: 'Vuelta a clases', pico: [2, 5], fin: [3, 15], finDuro: true,
    productos: 'mochilas, loncheras, estuches, útiles, organización de escritorio, botellas, uniformes genéricos',
    palabras: /escolar|colegio|[uú]tiles|lonchera|estuche|cotona/i },
  { id: 'san-valentin', nombre: 'San Valentín', pico: [2, 1], fin: [2, 14], finDuro: true,
    productos: 'regalos de pareja, peluches, flores eternas, joyería de fantasía',
    palabras: /san valent|enamorados/i },
  { id: 'dia-de-la-madre', nombre: 'Día de la madre', pico: [4, 25], fin: [5, 10], finDuro: true,
    productos: 'belleza, cuidado personal, cocina, joyería, bienestar',
    palabras: /d[ií]a de la madre|regalo mam/i },
  { id: 'invierno', nombre: 'Otoño e invierno', pico: [5, 15], fin: [8, 15], finDuro: false,
    productos: 'calefacción, frazadas y ropa térmica, lluvia, humedad, deshumidificador, secado de ropa' },
  { id: 'dia-del-padre', nombre: 'Día del padre', pico: [6, 1], fin: [6, 21], finDuro: true,
    productos: 'herramientas, asado, tecnología, cuidado masculino',
    palabras: /d[ií]a del padre|regalo pap/i },
  { id: 'dia-del-nino', nombre: 'Vacaciones de invierno y Día del niño', pico: [7, 10], fin: [8, 9], finDuro: true,
    productos: 'juguetes, juegos de mesa, entretención en casa',
    palabras: /d[ií]a del ni[nñ]o/i },
  { id: 'fiestas-patrias', nombre: 'Fiestas Patrias', pico: [8, 25], fin: [9, 19], finDuro: true,
    productos: 'asado y parrilla, decoración tricolor, vestuario típico, volantines',
    palabras: /fiestas patrias|dieciocho|huaso|cueca|volant[ií]n|tricolor/i },
  { id: 'halloween', nombre: 'Halloween', pico: [10, 10], fin: [10, 31], finDuro: true,
    productos: 'disfraces, decoración, cotillón',
    palabras: /halloween/i },
]

const fechaDe = (anio, [mes, dia]) => new Date(Date.UTC(anio, mes - 1, dia, 15)) // mediodía de Chile
const corta = (f) => f.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' }).replace('.', '')
const dias = (a, b) => Math.round((+a - +b) / DIA)

function ocurrencia(t, anio) {
  const pico = fechaDe(anio, t.pico)
  const cruza = t.fin[0] < t.pico[0] || (t.fin[0] === t.pico[0] && t.fin[1] < t.pico[1])
  const fin = fechaDe(cruza ? anio + 1 : anio, t.fin)
  return { pico, fin }
}

function evaluar(t, { pico, fin }, hoy) {
  const vendibleMin = new Date(+hoy + (LEAD_DIAS_MIN + RAMPA_DIAS) * DIA)
  const vendibleMax = new Date(+hoy + (LEAD_DIAS_MAX + RAMPA_DIAS) * DIA)
  // hasta dónde se puede llegar tarde: una temporada larga tolera un tercio adentro
  const tope = t.finDuro ? pico : new Date(+pico + (dias(fin, pico) / 3) * DIA)
  const plazoHolgado = new Date(+pico - (LEAD_DIAS_MAX + RAMPA_DIAS) * DIA)
  const plazoFinal = t.finDuro ? plazoHolgado : new Date(+tope - (LEAD_DIAS_MAX + RAMPA_DIAS) * DIA)
  let estado
  if (+vendibleMax <= +pico) estado = dias(plazoHolgado, hoy) > HORIZONTE_PROPUESTA_DIAS ? 'todavia-no' : 'a-tiempo'
  else if (+vendibleMax <= +tope) estado = 'justo'
  else estado = 'ya-no-llega'
  return { estado, pico, fin, plazoHolgado, plazoFinal, vendibleMin, vendibleMax, diasParaElPlazo: dias(estado === 'justo' ? plazoFinal : plazoHolgado, hoy) }
}

// El calendario resuelto a la fecha. Por temporada devuelve la próxima
// ocurrencia QUE TODAVÍA NO TERMINA; si esa ya no se alcanza, lo dice y agrega
// cuándo se pide la del año siguiente.
export function calendarioTemporadas(hoy = new Date()) {
  const anio = Number(hoy.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }).slice(0, 4))
  return TEMPORADAS.map((t) => {
    // hasta dos años adelante: San Valentín perdido en noviembre tiene su próxima en 15 meses
    const candidatas = [anio - 1, anio, anio + 1, anio + 2].map((a) => ocurrencia(t, a)).filter((o) => +o.fin > +hoy)
    const actual = evaluar(t, candidatas[0], hoy)
    const siguiente = actual.estado === 'ya-no-llega' ? evaluar(t, candidatas[1], hoy) : null
    return { id: t.id, nombre: t.nombre, productos: t.productos, finDuro: t.finDuro, palabras: t.palabras ?? null, ...actual,
      proximoPlazo: siguiente?.plazoHolgado ?? null }
  // primero lo que se puede pedir, por urgencia; lo perdido al final
  }).sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.diasParaElPlazo - b.diasParaElPlazo)
}

// El bloque que lee el radar. Las cuentas van hechas: el modelo elige productos,
// no calcula fechas.
export function calendarioParaPrompt(hoy = new Date()) {
  const cal = calendarioTemporadas(hoy)
  const r = cal[0]
  const lineas = [
    `CALENDARIO DE IMPORTACIÓN — calculado por el sistema al ${hoy.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' })}. NO lo recalcules.`,
    `Un pedido pagado hoy llega a bodega entre el ${corta(new Date(+hoy + LEAD_DIAS_MIN * DIA))} y el ${corta(new Date(+hoy + LEAD_DIAS_MAX * DIA))}, y recién vende con posición entre el ${corta(r.vendibleMin)} y el ${corta(r.vendibleMax)}.`,
  ]
  const bloque = (titulo, filas, fn) => { if (filas.length) lineas.push(titulo, ...filas.map(fn)) }
  bloque('SE ALCANZAN (de acá salen los estacionales, en este orden de urgencia):', cal.filter((t) => t.estado === 'a-tiempo' || t.estado === 'justo'), (t) =>
    `- ${t.nombre.toUpperCase()} — ${t.estado === 'justo' ? 'JUSTO: solo pidiendo ya' : 'A TIEMPO'}. Tiene que estar vendiendo el ${corta(t.pico)} y termina el ${corta(t.fin)}. ${t.estado === 'justo' ? `Último plazo para pagar: ${corta(t.plazoFinal)}` : `Pagar antes del ${corta(t.plazoHolgado)} (quedan ${t.diasParaElPlazo} días)${t.finDuro ? '' : `; con la temporada ya empezada, último plazo ${corta(t.plazoFinal)}`}`}. Productos: ${t.productos}.`)
  bloque('YA NO SE ALCANZAN — PROHIBIDO proponer productos de estas temporadas:', cal.filter((t) => t.estado === 'ya-no-llega'), (t) =>
    `- ${t.nombre.toUpperCase()}: el stock quedaría vendible después del ${corta(t.vendibleMin)} y la temporada ${t.finDuro ? `termina el ${corta(t.fin)}` : `ya va avanzada`}. La próxima se paga antes del ${corta(t.proximoPlazo)}. (${t.productos})`)
  bloque('TODAVÍA NO TOCA (comprar ahora sería capital dormido — no proponer):', cal.filter((t) => t.estado === 'todavia-no'), (t) =>
    `- ${t.nombre}: se paga antes del ${corta(t.plazoHolgado)}.`)
  return lineas.join('\n')
}

// Guarda en código: el modelo puede saltarse la prohibición; una keyword que
// nombra una temporada que no se alcanza no entra al tablero.
export function temporadaInalcanzableDe(keyword, hoy = new Date()) {
  return calendarioTemporadas(hoy).find((t) => t.palabras?.test(String(keyword ?? '')) && t.estado !== 'a-tiempo' && t.estado !== 'justo') ?? null
}

// Para la mesa: una temporada de fin duro que ya no se alcanza no puede seguir
// diciendo "último mes para pedir" porque su pico cae a dos meses.
export function temporadaDuraPerdida(keyword, hoy = new Date()) {
  const t = calendarioTemporadas(hoy).find((x) => x.finDuro && x.palabras?.test(String(keyword ?? '')))
  return t?.estado === 'ya-no-llega' ? t : null
}
