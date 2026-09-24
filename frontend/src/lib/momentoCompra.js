// EL MOMENTO DE COMPRA DE CADA NICHO: una sola lista, mezclada.
//
// La mesa separaba "se venden todo el año" arriba y los de temporada abajo, y
// el importador terminó cotizando SOLO productos planos: "si te fijas lo que
// están cotizando son todos que se venden el año completo". Lo que pidió el
// 24-sep-2026: mezclado, a medida — "esto ir trayéndolo ahora por verano, este
// porque vende todo el año".
//
// Cada nicho recibe su momento (con el porqué en palabras) y un bono de
// urgencia que se suma a su puntaje: un verano con la ventana cerrándose sube
// sobre un plano de puntaje parecido, pero un plano claramente mejor sigue
// arriba. Lo que no toca hoy (temporadas lejanas) y lo que no está medido van
// aparte, plegados.

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const mesDe = (periodo) => (/^\d{4}-\d{2}/.test(periodo ?? '') ? MESES[Number(periodo.slice(5, 7)) - 1] : null)

// bono sobre el puntaje (0-100) por lo que se juega hoy
export const BONO = { 'ultimo-mes': 25, ahora: 15, 'prepara-pico': 10, 'todo-el-ano': 0 }
const PICO_QUE_SE_PREPARA = 1.5

const esPlano = (o) => ['todo-el-año', 'alza-suave'].includes(o?.curvaAnual?.clasificacion)

// Los de todo el año con un período fuerte medido (ej: calculadora, pico
// marzo-mayo) también tienen su "ahora": el stock debe estar vendiendo cuando
// arranca el pico, y pidiendo hoy llega en ~2 meses. Se prepara si el pico
// arranca dentro de 2 a 4 meses.
function picoAPreparar(o, mesHoy) {
  const picos = (o?.curvaAnual?.periodos?.picos ?? []).filter((p) => p.multiplicador >= PICO_QUE_SE_PREPARA)
  for (const p of picos) {
    const faltan = (p.meses[0] - 1 - mesHoy + 12) % 12
    if (faltan >= 2 && faltan <= 4) return { ...p, faltan }
  }
  return null
}

// Pura. {grupo, bono, etiqueta, motivo, clase}. grupo: 'ahora' | 'adelante' | 'sin-medir'
export function momentoDeCompra(o, hoy = new Date()) {
  const mesHoy = hoy.getMonth()
  if (o?.midiendo) return { grupo: 'sin-medir', bono: 0, etiqueta: 'midiendo', motivo: 'recién descubierto: se escanea a diario hasta juntar la serie', clase: 'medio' }
  if (o?.nivelBusqueda?.nivel === 'nulo') return { grupo: 'sin-medir', bono: 0, etiqueta: 'nadie lo busca', motivo: 'la búsqueda no existe en Mercado Libre', clase: 'medio' }
  const v = o?.ventana
  const porque = o?.curvaAnual?.periodos?.picos?.[0]?.porque?.nombre
  if (esPlano(o)) {
    const p = picoAPreparar(o, mesHoy)
    // un pico que ya no se alcanza no se "prepara": sigue siendo de todo el año
    if (p && !(p.calendario?.estado === 'ya-no-llega' && !(p.calendarioAlternativa && p.calendarioAlternativa.estado !== 'ya-no-llega'))) {
      return { grupo: 'ahora', bono: BONO['prepara-pico'], etiqueta: `prepara pico ${p.texto}`, clase: 'pico',
        motivo: `Se vende todo el año, y en ${p.texto} se busca ×${String(p.multiplicador).replace('.', ',')}${p.porque ? ` (${p.porque.nombre})` : ''}: pidiendo ahora el stock llega para el arranque del pico` }
    }
    return { grupo: 'ahora', bono: BONO['todo-el-ano'], etiqueta: 'todo el año', clase: 'plano', motivo: 'Se vende parejo: se puede traer cualquier mes y rota el capital varias veces al año' }
  }
  if (!o?.curvaAnual?.clasificacion) return { grupo: 'sin-medir', bono: 0, etiqueta: 'sin temporada medida', motivo: 'todavía sin curva de búsqueda', clase: 'medio' }
  const pico = mesDe(v?.pico)
  let temporada = porque ?? (pico ? `pico ${pico}` : 'temporada')
  // EL CALENDARIO MANDA SOBRE LA VENTANA VIEJA: la ventana sale del mes pico y
  // no sabe que Navidad tiene fin duro. Si la temporada ya no llega, no se pide;
  // si es "Navidad o verano" y solo verano llega, se pide por verano.
  const p0 = o?.curvaAnual?.periodos?.picos?.[0]
  const cal = p0?.calendario, alt = p0?.calendarioAlternativa
  if (cal?.estado === 'ya-no-llega') {
    if (alt && alt.estado !== 'ya-no-llega') temporada = `${alt.nombre.toLowerCase()} (${cal.nombre} ya no llega)`
    else return { grupo: 'adelante', bono: 0, etiqueta: `${cal.nombre} ya no llega`, clase: 'medio',
      motivo: `Pidiendo hoy el stock llega con ${cal.nombre} ya encima o terminada.${cal.proximoPlazo ? ` Para la próxima, pagar antes del ${new Date(cal.proximoPlazo).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}.` : ''}` }
  }
  if (cal?.estado === 'justo' && ['ahora', 'ultimo-mes'].includes(v?.estado)) {
    return { grupo: 'ahora', bono: BONO['ultimo-mes'], etiqueta: `último plazo · ${temporada}`, clase: 'urgente',
      motivo: `Solo llega pidiendo ya: último plazo para pagar ${cal.plazo ? new Date(cal.plazo).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : 'esta semana'}` }
  }
  if (v?.estado === 'ultimo-mes') return { grupo: 'ahora', bono: BONO['ultimo-mes'], etiqueta: `último mes · ${temporada}`, clase: 'urgente', motivo: `Pidiendo este mes el stock llega justo al arranque del pico${pico ? ` (${pico})` : ''}. El mes que viene ya no llega.` }
  if (v?.estado === 'ahora') return { grupo: 'ahora', bono: BONO.ahora, etiqueta: `pedir ahora · ${temporada}`, clase: 'temporada', motivo: `Ventana abierta hasta ${mesDe(v.hasta) ?? '—'}: pidiendo ahora el stock vende en el pico${pico ? ` de ${pico}` : ''}` }
  if (v?.estado === 'pronto') return { grupo: 'adelante', bono: 0, etiqueta: `pedir desde ${mesDe(v.desde) ?? '—'} · ${temporada}`, clase: 'medio', motivo: `Todavía no toca: la ventana abre en ${v.mesesAl} mes(es)` }
  return { grupo: 'adelante', bono: 0, etiqueta: `fuera de temporada · ${temporada}`, clase: 'medio', motivo: 'El pico está lejos: pedir hoy es capital dormido' }
}

// Pura. Orden de la lista mezclada: puntaje + bono, y a igualdad, más búsquedas.
export function compararPorMomento(a, b, hoy = new Date()) {
  const pa = (a.score ?? 0) + momentoDeCompra(a, hoy).bono
  const pb = (b.score ?? 0) + momentoDeCompra(b, hoy).bono
  return pb - pa || (b.curvaAnual?.busquedasMes ?? 0) - (a.curvaAnual?.busquedasMes ?? 0)
}
