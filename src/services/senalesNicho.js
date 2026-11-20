// LAS TRES SEÑALES DE DEMANDA, JUNTAS, Y EL VEREDICTO POR LO MEDIDO (20-nov-2026)
//
// Pedido del importador: «tenemos 3 cosas: Google, la búsqueda en ML y ahora la venta; se supone que hay veredicto
// que dar… necesito un flujo de 0 a 100 bien construido». Hasta ese día cada señal vivía en su rincón de la tarjeta
// y el veredicto lo escribía el analista (la IA) leyendo texto: casi todos los nichos salían «con condiciones» y
// uno sin venta en Mercado Libre podía salir «entrar».
//
// Acá cada señal se dice igual: cuánto (su lugar entre los nichos de la mesa, por tercios), hacia dónde va y qué tan
// firme es el dato. Con las tres se arma una lectura de demanda y, con ella más lo que ya se mide de entrada y de
// plata, un veredicto con reglas a la vista. La IA explica y propone el producto; no decide.
//
// Qué manda y por qué (medido ese día con la historia): la venta medida en Mercado Libre es lo único que anticipa
// la venta posterior de un nicho; las búsquedas de Google casi no la ordenan, y el autocompletado de ML distingue
// poco (la mayoría sale «alto»). Por eso la demanda se lee por la venta, y las búsquedas la explican o la
// reemplazan mientras todavía no hay venta medida.
//
// Sin varas a mano: «alto», «medio» y «bajo» son los tercios entre los nichos de la mesa. Lo único fijo es el ruido
// medido de la venta entre dos mediciones (FACTOR_RUIDO) y los cortes de temporada que ya usa el puntaje.
import { clasificarCrecimiento } from './atractivoNicho.js'
import { mismaBusqueda } from './busquedasReales.js'
import { PESO_TEMPORADA_PLENA, PESO_TEMPORADA_NULA, MIN_SCANS_VENTA } from './ml/puntajeSombra.js'

// Entre dos mediciones seguidas la venta de un mismo nicho cambia cerca de esto sin que haya pasado nada (medido el
// 20-nov-2026, docs/privado/scripts/fiabilidad-venta-ml.mjs): para decir que sube o baja, la mitad reciente tiene
// que alejarse más que eso de la mitad anterior.
export const FACTOR_RUIDO = 1.6
// CASI NO SE VENDE: menos de una reseña nueva al día entre todas las publicaciones medidas del nicho. Es el único
// corte fijo de la lectura, y está puesto donde los datos lo ponen (medido el 20-nov-2026 con la mesa real): los
// nichos donde ya hay ventas propias parten varias veces más arriba, y los pocos que quedan debajo son también los
// de primera página más floja. El tercio bajo NO alcanza para decir «no entrar»: el producto propio que más vende
// está en un nicho de ese tercio (se entró con un producto distinto).
export const VENTA_CASI_NULA = 1
// con menos mediciones no se parte la serie en dos mitades que digan algo
export const MIN_SERIE_TENDENCIA = 4
// con menos nichos medidos los tercios no dicen nada
const MIN_PARA_TERCIOS = 6

const mediana = (xs) => { const v = [...xs].sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null }

// Pura. El lugar de un valor entre los de la mesa: el tercio y de cada 100 nichos cuántos tienen menos.
export function nivelEntre(valor, valores) {
  const v = (valores ?? []).filter(Number.isFinite).sort((a, b) => a - b)
  if (!Number.isFinite(valor) || v.length < MIN_PARA_TERCIOS) return { nivel: null, lugar: null }
  const bajo = v[Math.floor(v.length / 3)], alto = v[Math.floor((v.length * 2) / 3)]
  return { nivel: valor >= alto ? 'alto' : valor < bajo ? 'bajo' : 'medio', lugar: Math.round((v.filter((x) => x < valor).length / v.length) * 100) }
}

// Pura. Hacia dónde va la venta: la mitad reciente de las mediciones contra la anterior.
export function tendenciaDeVenta(serie) {
  const v = (serie ?? []).filter(Number.isFinite)
  if (v.length < MIN_SERIE_TENDENCIA) return null
  const mitad = Math.floor(v.length / 2)
  const antes = mediana(v.slice(0, mitad)), ahora = mediana(v.slice(mitad))
  // el medio punto evita que pasar de 0,1 a 0,3 reseñas por día cuente como triplicarse
  const razon = (ahora + 0.5) / (antes + 0.5)
  return razon >= FACTOR_RUIDO ? 'sube' : razon <= 1 / FACTOR_RUIDO ? 'baja' : 'estable'
}

// Pura. Google: cuánto se busca al mes en Chile y cómo viene contra el año pasado (medido contra el resto del
// mercado cuando se puede: todas las búsquedas se mueven juntas y eso no es del producto).
export function senalGoogle(curva, todos) {
  const valor = Number.isFinite(curva?.busquedasMes) ? curva.busquedasMes : null
  const pct = Number.isFinite(curva?.variacionRelativaPct) ? curva.variacionRelativaPct : Number.isFinite(curva?.variacionInteranualPct) ? curva.variacionInteranualPct : null
  const t = clasificarCrecimiento(pct)
  return {
    ...nivelEntre(valor, todos), valor,
    tendencia: t === 'crece' ? 'sube' : t === 'cae' ? 'baja' : t === 'estable' ? 'estable' : null,
    variacionPct: pct, contraMercado: Number.isFinite(curva?.variacionRelativaPct),
    medidaCon: curva?.keywordMedida ?? null,
    // medida con otra frase (la familia o una corrección) es un dato más flojo que el de la frase exacta
    confianza: valor == null ? null : curva?.keywordMedida ? 'media' : 'alta',
  }
}

// Pura. La búsqueda dentro de Mercado Libre: si la gente escribe esa frase (el autocompletado) y si está en las
// tendencias de una categoría ancha (panoramaMl.terminosDeAnchas). `anchas`: { categorias, terminos } o null.
const GRUPOS_FUERTES = ['crecen', 'buscadas', 'suben', 'en-la-lista']
export function senalBusquedaMl(keyword, nivelBusqueda, anchas = null) {
  const nivel = { alto: 'alto', medio: 'medio', bajo: 'bajo', nulo: 'nulo', renombrar: 'otra-frase' }[nivelBusqueda?.nivel] ?? null
  const hallados = (anchas?.terminos ?? []).filter((t) => mismaBusqueda(keyword, t.termino))
    .sort((a, b) => GRUPOS_FUERTES.indexOf(a.grupo) - GRUPOS_FUERTES.indexOf(b.grupo) || b.semanas - a.semanas)
  const en = hallados[0] ?? null
  return {
    nivel, posicion: nivelBusqueda?.posicion ?? null, deCuantas: nivelBusqueda?.deCuantas ?? null, prefijo: nivelBusqueda?.prefijo ?? null,
    enTendencias: en ? { categoria: en.categoria, grupo: en.grupo, semanas: en.semanas, de: en.de, termino: en.termino } : null,
    // ¿hay con qué mirar? Sin capturas de categorías anchas, no aparecer no significa nada
    tendenciasMedidas: (anchas?.categorias ?? 0) > 0,
    tendencia: en ? (en.grupo === 'crecen' || en.grupo === 'suben' ? 'sube' : 'estable') : null,
    // el autocompletado dice si se escribe, no cuánto: solo, es un dato flojo
    confianza: nivel == null ? null : en ? 'media' : 'baja',
  }
}

// Pura. La venta medida en Mercado Libre: reseñas nuevas por día de las publicaciones del nicho (mediana de los
// scans de 45 días), llevada al nivel de un mes promedio con la curva del año. `todas`: las niveladas de la mesa.
export function ventaNivelada(reseniasDia, factorTemporada) {
  if (!Number.isFinite(reseniasDia)) return null
  return reseniasDia / Math.min(2, Math.max(0.5, Number.isFinite(factorTemporada) ? factorTemporada : 1))
}
export function senalVentaMl({ reseniasDia = null, scans = 0, factorTemporada = null, serie = null } = {}, todas = []) {
  const medida = Number.isFinite(reseniasDia) && scans >= MIN_SCANS_VENTA
  const nivelada = medida ? ventaNivelada(reseniasDia, factorTemporada) : null
  const temporada = !Number.isFinite(factorTemporada) ? null : factorTemporada <= PESO_TEMPORADA_NULA ? 'fuera' : factorTemporada < PESO_TEMPORADA_PLENA ? 'baja' : null
  return {
    ...nivelEntre(nivelada, todas), valor: medida ? reseniasDia : null, nivelada, scans, temporada,
    tendencia: medida ? tendenciaDeVenta(serie) : null,
    confianza: !medida ? null : scans >= MIN_SERIE_TENDENCIA ? 'alta' : 'media',
  }
}

const NIVEL_G = { alto: 'se busca mucho', medio: 'se busca a un nivel medio', bajo: 'se busca poco' }

// Pura. LA LECTURA DE DEMANDA: una frase y un nivel que salen de las tres señales, con la regla dicha.
// Niveles: 'fuerte' (está entre los que más venden), 'media', 'debil' (entre los que menos), 'casi-nula' (casi no
// se vende) y 'sin-medir'. «Entre los que más» y «entre los que menos» son los tercios de la mesa.
export function lecturaDeDemanda({ google, busquedaMl, ventaMl }) {
  const g = google?.nivel ?? null
  const buscaEnGoogle = g ? `en Google ${NIVEL_G[g]}` : 'Google no tiene medición'
  const flecha = ventaMl?.tendencia === 'sube' ? ' La venta viene subiendo.' : ventaMl?.tendencia === 'baja' ? ' La venta viene bajando.' : ''
  const base = { tendencia: ventaMl?.tendencia ?? null, firme: ventaMl?.confianza === 'alta' }
  if (ventaMl?.temporada === 'fuera' && ventaMl?.valor != null) {
    return { ...base, nivel: 'sin-medir', caso: 'fuera-de-temporada', firme: false,
      frase: `Está fuera de su temporada: lo que se vende hoy no dice cuánto vende en su época. Mientras tanto manda la búsqueda: ${buscaEnGoogle}.` }
  }
  if (ventaMl?.valor == null) {
    const faltan = Math.max(0, MIN_SCANS_VENTA - (ventaMl?.scans ?? 0))
    return { ...base, nivel: 'sin-medir', caso: 'sin-venta-medida', firme: false,
      frase: `Todavía no hay venta medida en Mercado Libre${faltan ? ` (${faltan === 1 ? 'falta 1 medición' : `faltan ${faltan} mediciones`})` : ''}. Por ahora solo se sabe lo que se busca: ${buscaEnGoogle}${busquedaMl?.nivel === 'alto' ? ' y la gente lo escribe en Mercado Libre' : ''}.` }
  }
  const baja = ventaMl.temporada === 'baja' ? ' Está en la parte baja de su temporada: la venta medida se llevó al nivel de un mes promedio.' : ''
  if (Number.isFinite(ventaMl.nivelada) && ventaMl.nivelada < VENTA_CASI_NULA) {
    return { ...base, nivel: 'casi-nula', caso: g === 'alto' ? 'se-busca-no-se-vende' : 'casi-no-se-vende',
      frase: `${g === 'alto' ? 'En Google se busca mucho, pero en Mercado Libre casi no se vende: ese interés no se convierte en compra acá.' : 'Casi no se vende en Mercado Libre.'} Entre todas sus publicaciones no llega a una reseña nueva al día.${baja}` }
  }
  if (ventaMl.nivel === 'alto') {
    return { ...base, nivel: 'fuerte', caso: g === 'bajo' ? 'vende-sin-google' : 'vende-y-se-busca',
      frase: `${g === 'bajo' ? 'Está entre los nichos que más venden en Mercado Libre aunque en Google se busca poco: acá lo compran sin buscarlo antes en Google.' : `Está entre los nichos que más venden en Mercado Libre${g === 'alto' ? ' y también se busca mucho en Google' : ''}.`}${flecha}${baja}` }
  }
  if (ventaMl.nivel === 'bajo') {
    return { ...base, nivel: 'debil', caso: g === 'alto' ? 'se-busca-vende-poco' : 'vende-poco',
      frase: `${g === 'alto' ? 'En Google se busca mucho, pero en Mercado Libre está entre los nichos que menos venden: buena parte de ese interés no se compra acá.' : `Está entre los nichos que menos venden en Mercado Libre${g === 'bajo' ? ' y también se busca poco' : ''}.`}${flecha}${baja}` }
  }
  // con pocos nichos en la mesa no hay tercios: se dice la venta sin compararla
  return { ...base, nivel: 'media', caso: 'venta-media',
    frase: `${ventaMl.nivel === 'medio' ? 'Se vende a un ritmo medio entre los nichos que se miden.' : 'Tiene venta medida en Mercado Libre.'}${g === 'alto' ? ' En Google se busca mucho: hay interés que todavía no se nota entero en la venta.' : ''}${flecha}${baja}` }
}
export const REGLA_DEMANDA = 'La demanda se lee por la venta medida en Mercado Libre, que es lo que mejor anticipa lo que se vende después. Google y la búsqueda en Mercado Libre la explican, o la reemplazan mientras todavía no hay venta medida.'

// Pura. EL VEREDICTO POR LO MEDIDO. Tres preguntas con su respuesta a la vista: ¿hay demanda?, ¿se puede entrar?,
// ¿deja plata? `entrada` y `economia` son los componentes del puntaje del último scan (0 a 100) y `todas*` los de
// la mesa, para decir «de los más difíciles» por tercios. Reglas:
//   · sin venta medida no hay veredicto: falta medir;
//   · casi no se vende, o una venta que al precio del nicho no paga ni su publicidad: no entrar;
//   · está entre los que más venden, sin trabas de entrada ni de plata: entrar;
//   · todo lo demás: entrar con condiciones, y las condiciones son las preguntas que no salieron bien.
// Vender menos que la mayoría no cierra la puerta (ver VENTA_CASI_NULA): pide un producto distinto.
export function veredictoMedido({ demanda, entrada = null, economia = null, muro = null, midiendo = false }, { todasEntrada = [], todasEconomia = [] } = {}) {
  const pasos = []
  const dEstado = { fuerte: 'bien', media: 'atencion', debil: 'atencion', 'casi-nula': 'problema' }[demanda?.nivel] ?? 'sin-dato'
  pasos.push({ id: 'demanda', pregunta: '¿Hay demanda?', estado: dEstado, frase: demanda?.frase ?? 'Sin lectura de demanda.' })

  const e = nivelEntre(entrada, todasEntrada)
  const eEstado = !Number.isFinite(entrada) ? 'sin-dato' : e.nivel === 'bajo' ? 'atencion' : 'bien'
  const lider = Number.isFinite(muro) ? `: la publicación que más vende lleva +${muro.toLocaleString('es-CL')} vendidos` : ''
  pasos.push({ id: 'entrada', pregunta: '¿Se puede entrar?', estado: eEstado, muro: Number.isFinite(muro) ? muro : null,
    frase: !Number.isFinite(entrada) ? 'Todavía no se midió qué tan difícil es entrar.'
      : e.nivel === 'bajo' ? `Es de los nichos más difíciles para entrar entre los que se miden${lider}.`
      : `No está entre los difíciles${lider}.` })

  const p = nivelEntre(economia, todasEconomia)
  const noPaga = economia === 0
  const pEstado = !Number.isFinite(economia) ? 'sin-dato' : noPaga ? 'problema' : p.nivel === 'bajo' ? 'atencion' : 'bien'
  pasos.push({ id: 'plata', pregunta: '¿Deja plata?', estado: pEstado,
    frase: !Number.isFinite(economia) ? 'Todavía no se midió lo que deja una venta.'
      : noPaga ? 'Al precio del nicho, lo que deja una venta después de la comisión y el envío no alcanza ni para la publicidad de esa venta.'
      : p.nivel === 'bajo' ? 'Al precio del nicho, una venta deja poco: está entre los que menos dejan por venta.'
      : 'Al precio del nicho, una venta deja para pagar la publicidad y ganar.' })

  const malas = pasos.filter((x) => x.estado === 'atencion').map((x) => x.id)
  let veredicto, porQue
  if (midiendo || dEstado === 'sin-dato') { veredicto = 'falta-medir'; porQue = demanda?.caso === 'fuera-de-temporada' ? 'Está fuera de temporada: la venta de hoy no alcanza para decidir.' : 'Todavía no hay venta medida en Mercado Libre.' }
  else if (dEstado === 'problema') { veredicto = 'no_entrar'; porQue = 'Casi no se vende en Mercado Libre.' }
  else if (pEstado === 'problema') { veredicto = 'no_entrar'; porQue = 'La venta no deja plata al precio del nicho.' }
  else if (dEstado === 'bien' && !malas.length) { veredicto = 'entrar'; porQue = 'Se vende, se puede entrar y deja plata.' }
  else {
    veredicto = 'entrar_con_condiciones'
    const condicion = {
      demanda: demanda?.nivel === 'debil' ? 'se vende menos que en la mayoría de los nichos (pide un producto distinto o una ventaja clara)' : 'la venta es media, no alta',
      entrada: 'entrar cuesta', plata: 'una venta deja poco' }
    porQue = `Con condiciones: ${malas.length ? malas.map((id) => condicion[id]).join('; ') : 'falta medir la entrada o la plata'}.`
  }
  return { veredicto, porQue, pasos }
}

// Al leer la mesa: a cada oportunidad, sus tres señales, la lectura de demanda y el veredicto por lo medido.
// `resenas`: resenasPorNicho() ya leído por la mesa; `anchas`: tendenciasAnchas() (se pide acá si no viene).
export async function aplicarSenales(oportunidades, { resenas = null, anchas = undefined, factorTemporada = null } = {}) {
  if (anchas === undefined) anchas = await import('./panoramaMl.js').then((m) => m.tendenciasAnchas()).catch(() => null)
  factorTemporada ??= (await import('./demandaMlVsGoogle.js')).factorTemporada
  const ventas = new Map()
  for (const o of oportunidades) {
    const r = resenas?.get(String(o.nichoId))
    const factor = factorTemporada(o.curvaAnual?.curva, r?.meses)
    ventas.set(o.nichoId, { reseniasDia: r?.mediana ?? null, scans: r?.scans ?? 0, factorTemporada: factor, serie: r?.serie ?? null })
  }
  const todosGoogle = oportunidades.map((o) => o.curvaAnual?.busquedasMes)
  const todasVentas = [...ventas.values()].filter((v) => v.scans >= MIN_SCANS_VENTA).map((v) => ventaNivelada(v.reseniasDia, v.factorTemporada))
  const todasEntrada = oportunidades.map((o) => o.componentes?.entrada), todasEconomia = oportunidades.map((o) => o.componentes?.economia)
  const cuenta = { fuerte: 0, media: 0, debil: 0, 'casi-nula': 0, 'sin-medir': 0 }
  for (const o of oportunidades) {
    const senales = {
      google: senalGoogle(o.curvaAnual, todosGoogle),
      busquedaMl: senalBusquedaMl(o.keyword, o.nivelBusqueda, anchas),
      ventaMl: senalVentaMl(ventas.get(o.nichoId), todasVentas),
    }
    const demanda = lecturaDeDemanda(senales)
    cuenta[demanda.nivel]++
    o.senales = senales
    o.demanda = demanda
    o.veredictoMedido = veredictoMedido({ demanda, entrada: o.componentes?.entrada ?? null, economia: o.componentes?.economia ?? null,
      muro: o.vendidosHistoricos?.maximoPorItem ?? null, midiendo: Boolean(o.midiendo) }, { todasEntrada, todasEconomia })
  }
  return { nichos: oportunidades.length, demanda: cuenta, regla: REGLA_DEMANDA, categoriasAnchas: anchas?.categorias ?? 0 }
}

// LO MEDIDO, PARA EL ANALISTA. La lectura de demanda y el veredicto por lo medido de un nicho, tal como están en
// la mesa guardada (los tercios son contra los demás nichos, así que no se pueden calcular para uno solo). null si
// el nicho todavía no está en la mesa. `leer` es la mesa guardada, inyectable para probar.
export async function lecturaMedidaDeNicho(nichoId, { leer = null } = {}) {
  leer ??= (await import('./tableroCache.js')).leerTablero
  const { oportunidades } = await leer({ todos: true })
  const o = (oportunidades ?? []).find((x) => String(x.nichoId) === String(nichoId))
  if (!o?.demanda || !o.veredictoMedido) return null
  return {
    demanda: { nivel: o.demanda.nivel, lectura: o.demanda.frase, tendenciaDeLaVenta: o.demanda.tendencia ?? undefined, datoFirme: o.demanda.firme },
    veredicto: o.veredictoMedido.veredicto,
    porQue: o.veredictoMedido.porQue,
    preguntas: o.veredictoMedido.pasos.map((p) => ({ pregunta: p.pregunta, respuesta: p.estado, detalle: p.frase })),
    regla: REGLA_DEMANDA,
  }
}
