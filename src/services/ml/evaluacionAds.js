import { createHash } from 'node:crypto'

const DIA = 86400e3
const fecha = (dia, dias = 0) => new Date(+new Date(`${dia}T12:00:00Z`) + dias * DIA).toISOString().slice(0, 10)
const diaChile = (valor) => new Date(valor).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function lecturaCompletaAds(respuesta, limite = 50) {
  if (!Array.isArray(respuesta?.results)) return false
  const total = respuesta.paging?.total ?? respuesta.total
  return Number.isFinite(total) ? total >= 0 && respuesta.results.length >= total : respuesta.results.length < limite
}

export function economiaCompleta(eco) {
  return !!eco && !eco.esTecho && !eco.incompleta && !eco.envioSupuesto &&
    ['costo', 'envio', 'comisionPct', 'cargoFijo'].every(k => Number.isFinite(eco[k]) && eco[k] >= 0) && eco.comisionPct <= 100
}

export function configuracionCampana(campana, porItem = {}) {
  return {
    estado: campana.estado ?? null,
    presupuestoDiario: campana.presupuestoDiario ?? null,
    roasObjetivo: campana.roasObjetivo ?? null,
    estrategia: campana.estrategia ?? null,
    anuncios: Object.entries(porItem).filter(([, a]) => a.campanaId === campana.id)
      .map(([itemId, a]) => ({ itemId, estado: a.estado ?? null })).sort((a, b) => a.itemId.localeCompare(b.itemId)),
  }
}

// Cada transición conserva ambos estados. Repetir una lectura no crea otra prueba.
export function cambioDeConfiguracion(campanaId, despues, anterior, ahora) {
  if (anterior && igual(anterior.despues, despues)) return null
  const clave = createHash('sha256').update(JSON.stringify([campanaId, anterior?.clave ?? null, despues])).digest('hex')
  return { clave, campanaId, observadoEl: ahora, ultimaVistaEl: ahora,
    anteriorVistaEl: anterior?.ultimaVistaEl ?? null, anteriorDesde: anterior?.observadoEl ?? null,
    antes: anterior?.despues ?? null, despues }
}

export async function registrarConfiguracionesAds(campanas, porItem, { ahora = new Date() } = {}) {
  const { CambioCampanaMl } = await import('../../models/CambioCampanaMl.js')
  let cambios = 0
  for (const c of campanas) {
    const anterior = await CambioCampanaMl.findOne({ campanaId: c.id }).sort({ observadoEl: -1, _id: -1 }).lean()
    if (anterior && +new Date(anterior.ultimaVistaEl) > +ahora) continue
    const cambio = cambioDeConfiguracion(c.id, configuracionCampana(c, porItem), anterior, ahora)
    if (cambio) {
      // El plan de hoy puede recalcularse: conservar la versión disponible
      // ANTES de observar el ajuste, no la que se genere después de él.
      if (cambio.antes) {
        const { RecomendacionAds } = await import('./planCampanas.js')
        cambio.recomendaciones = await RecomendacionAds.find({ campanaId: c.id,
          calculadoEl: { $lt: ahora, $gte: new Date(+ahora - 7 * DIA) } })
          .select('itemId dia accion budgetDiario roasObjetivo campanaId configuracion calculadoEl metricas.economia -_id').lean()
      }
      const r = await CambioCampanaMl.updateOne({ clave: cambio.clave }, { $setOnInsert: cambio }, { upsert: true })
      if (cambio.antes && r.upsertedCount) cambios++
    } else await CambioCampanaMl.updateOne({ _id: anterior._id }, { $max: { ultimaVistaEl: ahora } })
  }
  return { cambios }
}

function coincideRecomendacion(r, c) {
  if (r.campanaId !== c.campanaId || !igual(r.configuracion, c.antes)) return false
  const a = c.antes, b = c.despues
  if (!a || !b || !a.anuncios.some(x => x.itemId === r.itemId)) return false
  // Un ajuste con cambios simultáneos no permite separar el efecto de cada dial.
  if (['subir', 'bajar'].includes(r.accion)) {
    return a.estado === 'active' && b.estado === 'active' && igual(a.anuncios, b.anuncios) &&
      a.roasObjetivo === b.roasObjetivo && a.estrategia === b.estrategia &&
      Number.isFinite(a.presupuestoDiario) && Number.isFinite(b.presupuestoDiario) && Number.isFinite(r.budgetDiario) && Math.abs(b.presupuestoDiario - r.budgetDiario) <= 1 &&
      (r.accion === 'subir' ? b.presupuestoDiario > a.presupuestoDiario : b.presupuestoDiario < a.presupuestoDiario)
  }
  if (r.accion === 'subir-roas') return a.estado === 'active' && b.estado === 'active' &&
    igual(a.anuncios, b.anuncios) && a.presupuestoDiario === b.presupuestoDiario && a.estrategia === b.estrategia &&
    Number.isFinite(r.roasObjetivo) && Math.abs(b.roasObjetivo - r.roasObjetivo) < 0.01 && b.roasObjetivo > a.roasObjetivo
  if (r.accion === 'apagar') return a.estado === 'active' && b.estado === 'paused' &&
    igual(a.anuncios, b.anuncios) && a.presupuestoDiario === b.presupuestoDiario && a.roasObjetivo === b.roasObjetivo
  return false
}

// Evaluación observacional, no causal. Un caso por ajuste, con días completos
// separados y costos congelados al recomendar; jamás inferir adopción por gasto.
export function evaluarAjustesAds(recs, diasPorItem, ecoPorItem, { hoy, cambios = [] } = {}) {
  const excluidas = {}, detalle = [], pendientes = [], ocupados = new Map()
  const excluir = (motivo) => { excluidas[motivo] = (excluidas[motivo] ?? 0) + 1 }
  for (const r of recs) {
    if (!economiaCompleta(r.metricas?.economia)) excluir('sin-costos-al-recomendar')
    else if (!r.configuracion || !r.calculadoEl) excluir('sin-registro-configuracion')
  }
  const orden = [...cambios].sort((a, b) => +new Date(a.observadoEl) - +new Date(b.observadoEl))
  for (const c of orden) {
    if (!c.antes) continue
    const t = +new Date(c.observadoEl), dia = diaChile(c.observadoEl)
    const candidatas = [...(c.recomendaciones ?? []), ...recs].filter(r => r.calculadoEl && +new Date(r.calculadoEl) < t && t - +new Date(r.calculadoEl) <= 7 * DIA && coincideRecomendacion(r, c))
      .sort((a, b) => +new Date(b.calculadoEl) - +new Date(a.calculadoEl))
    const r = candidatas[0]
    if (!r) { excluir('sin-recomendacion-coincidente'); continue }
    const eco = r.metricas?.economia, actual = ecoPorItem.get(r.itemId)
    if (!economiaCompleta(eco)) continue
    if (!economiaCompleta(actual) || ['costo', 'envio', 'comisionPct', 'cargoFijo'].some(k => eco[k] !== actual[k])) { excluir('economia-cambio'); continue }
    // En campañas compartidas el presupuesto afecta a todos: no contar una
    // recomendación de un producto como una prueba independiente de la campaña.
    if (c.antes.anuncios.filter(a => a.estado === 'active').length !== 1 || c.antes.anuncios.find(a => a.itemId === r.itemId)?.estado !== 'active') { excluir('campana-compartida'); continue }
    const desde = fecha(dia, -7), hasta = fecha(dia, 7)
    if (eco.costoVigenteDesde && desde <= eco.costoVigenteDesde) { excluir('costo-recien-registrado'); continue }
    if (!c.anteriorVistaEl || t - +new Date(c.anteriorVistaEl) > 2 * DIA || !c.anteriorDesde || diaChile(c.anteriorDesde) > desde) { excluir('historia-configuracion-insuficiente'); continue }
    if (hasta >= hoy) { pendientes.push({ itemId: r.itemId, dia: r.dia, cambioId: c.clave, ajusteEl: c.observadoEl, evaluarDesde: fecha(hasta, 1) }); continue }
    if (orden.some(x => x.campanaId === c.campanaId && +new Date(x.observadoEl) > t && diaChile(x.observadoEl) <= hasta)) { excluir('otro-cambio-en-ventana'); continue }
    if (!c.ultimaVistaEl || diaChile(c.ultimaVistaEl) <= hasta) { excluir('seguimiento-configuracion-incompleto'); continue }
    const filas = new Map((diasPorItem.get(r.itemId) ?? []).map(d => [d.dia, d]))
    const antes = Array.from({ length: 7 }, (_, i) => filas.get(fecha(dia, i - 7)))
    const despues = Array.from({ length: 7 }, (_, i) => filas.get(fecha(dia, i + 1)))
    const todas = [...antes, ...despues]
    if (todas.some(d => !d || !d.adsMedido || !Number.isFinite(d.ingresosClp) || !Number.isFinite(d.unidades) || !Number.isFinite(d.gasto))) { excluir('dias-incompletos'); continue }
    if (todas.some(d => d.evento || d.stockFraccion !== 1 || d.cambioLogistica)) { excluir('evento-stock-logistica'); continue }
    const precios = todas.map(d => d.precio)
    if (precios.some(p => !(p > 0)) || Math.max(...precios) / Math.min(...precios) > 1.05 || new Set(todas.map(d => d.promo ?? null)).size > 1) { excluir('precio-o-promocion-cambio'); continue }
    if ((ocupados.get(r.itemId) ?? []).some(w => desde <= w.hasta && hasta >= w.desde)) { excluir('ventanas-solapadas'); continue }
    const plata = ds => ds.reduce((s, d) => s + d.ingresosClp * (1 - eco.comisionPct / 100) - d.unidades * (eco.costo + eco.envio + eco.cargoFijo) - d.gasto, 0)
    const plataAntes = Math.round(plata(antes)), plataDespues = Math.round(plata(despues))
    detalle.push({ itemId: r.itemId, dia: r.dia, accion: r.accion, cambioId: c.clave, ajusteEl: c.observadoEl,
      desde, hasta, siguio: true, coincidencia: 'configuracion-observada', plataAntes, plataDespues, mejoro: plataDespues > plataAntes,
      economia: eco, alcance: 'contribucion-estimada-despues-de-costos-y-publicidad' })
    ocupados.set(r.itemId, [...(ocupados.get(r.itemId) ?? []), { desde, hasta }])
  }
  const aciertos = detalle.filter(d => d.mejoro).length
  return { version: 2, tipo: 'observacional-por-configuracion', evaluadas: detalle.length, seguidas: detalle.length, aciertos,
    tasaAcierto: detalle.length ? Math.round(aciertos / detalle.length * 100) : null, tasaSinSeguir: null,
    sinEvaluarPorEvento: excluidas['evento-stock-logistica'] ?? 0, excluidas, pendientes, detalle: detalle.slice(-20),
    nota: 'Cambios observados compatibles con una recomendación; no confirma quién los hizo ni prueba causalidad. Ventanas sin solapamiento y con costos completos.' }
}

// ─── NOTA POR HECHOS, CAMPAÑA POR CAMPAÑA (17-nov-2026) ─────────────────────
//
// evaluarAjustesAds exige que el cambio calce exacto con una recomendación
// (el presupuesto al peso, un solo dial a la vez, un solo anuncio en la campaña
// y siete días limpios a cada lado). Medido el 17-nov-2026 sobre toda la
// historia: de los cambios que el dueño hizo en sus campañas ninguno pasó, y la
// regla de cuándo subir el gasto tenía cero casos. La operación real cambia
// presupuesto y ROAS juntos y tiene campañas de dos o tres anuncios. Un
// aprendizaje que solo acepta el caso perfecto no aprende.
//
// Acá la pregunta es la del dueño: «¿me fue mejor o peor después de lo que
// cambié?». Por cada decisión sobre una campaña se compara lo que dejaron sus
// ventas por anuncio menos el gasto, por día, en los días anteriores y en los
// siguientes. No dice que el cambio CAUSÓ la diferencia (para eso está la
// evaluación estricta): deja el hecho a la vista y lleva la cuenta.
const BANDA_PLATA_DIA = 500 // diferencias menores por día se leen como «parecido»
const pesos = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CL')}`
const activos = (config) => (config?.anuncios ?? []).filter((a) => a.estado === 'active').map((a) => a.itemId)

// Pura. Qué decidió el dueño entre dos configuraciones de una campaña, en
// palabras. Un anuncio que entra o sale de 'hold' lo mueve Mercado Libre por
// stock: no es una decisión y no cuenta.
export function describirCambio(antes, despues) {
  const partes = []
  if (!antes || !despues) return { partes, texto: '' }
  if (antes.estado !== despues.estado && [antes.estado, despues.estado].every((e) => e === 'active' || e === 'paused')) {
    partes.push({ dial: 'estado', antes: antes.estado, despues: despues.estado, sentido: despues.estado === 'active' ? 'sube' : 'baja',
      texto: despues.estado === 'paused' ? 'pausaste la campaña' : 'reactivaste la campaña' })
  }
  const numero = (dial, a, b, texto) => {
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return
    partes.push({ dial, antes: a, despues: b, sentido: b > a ? 'sube' : 'baja', texto: texto(b > a ? 'subiste' : 'bajaste') })
  }
  numero('presupuesto', antes.presupuestoDiario, despues.presupuestoDiario, (v) => `${v} el presupuesto de ${pesos(antes.presupuestoDiario)} a ${pesos(despues.presupuestoDiario)} al día`)
  numero('roas', antes.roasObjetivo, despues.roasObjetivo, (v) => `${v} el ROAS objetivo de ${String(antes.roasObjetivo).replace('.', ',')} a ${String(despues.roasObjetivo).replace('.', ',')}`)
  const estadoDe = (config) => new Map((config.anuncios ?? []).map((a) => [a.itemId, a.estado]))
  const ea = estadoDe(antes), ed = estadoDe(despues)
  // salió: estaba activo y quedó pausado o fuera de la campaña; entró: al revés
  const salieron = [...ea].filter(([id, e]) => e === 'active' && (!ed.has(id) || ed.get(id) === 'paused')).map(([id]) => id)
  const entraron = [...ed].filter(([id, e]) => e === 'active' && (!ea.has(id) || ea.get(id) === 'paused')).map(([id]) => id)
  const cuantos = (n) => (n === 1 ? 'un anuncio' : `${n} anuncios`)
  if (salieron.length) partes.push({ dial: 'anuncios', sentido: 'baja', salieron, texto: `sacaste ${cuantos(salieron.length)}` })
  if (entraron.length) partes.push({ dial: 'anuncios', sentido: 'sube', entraron, texto: `sumaste ${cuantos(entraron.length)}` })
  if (antes.estrategia !== despues.estrategia && antes.estrategia && despues.estrategia) partes.push({ dial: 'estrategia', antes: antes.estrategia, despues: despues.estrategia, sentido: null, texto: 'cambiaste la estrategia' })
  const frases = partes.map((p) => p.texto)
  const texto = frases.length > 1 ? `${frases.slice(0, -1).join(', ')} y ${frases.at(-1)}` : frases[0] ?? ''
  return { partes, texto: texto ? texto[0].toUpperCase() + texto.slice(1) : '' }
}

// Pura. ¿El plan decía algo en esa dirección? null si no hay recomendación guardada.
function planDecia(partes, recomendaciones) {
  const ultimas = new Map()
  for (const r of [...(recomendaciones ?? [])].sort((a, b) => +new Date(a.calculadoEl) - +new Date(b.calculadoEl))) ultimas.set(r.itemId, r.accion)
  const acciones = [...new Set(ultimas.values())]
  if (!acciones.length) return { acciones, seguia: null }
  const bajar = ['bajar', 'apagar', 'no-anunciar', 'organico']
  const calza = (p) => (p.dial === 'presupuesto' ? (p.sentido === 'sube' ? acciones.includes('subir') : acciones.some((a) => bajar.includes(a)))
    : p.dial === 'roas' ? (p.sentido === 'sube' ? acciones.some((a) => a === 'subir-roas' || bajar.includes(a)) : acciones.includes('subir'))
      : p.dial === 'estado' || p.dial === 'anuncios' ? (p.sentido === 'baja' ? acciones.some((a) => bajar.includes(a)) : acciones.includes('subir'))
        : false)
  return { acciones, seguia: partes.some(calza) }
}

// Pura. Una nota por cada decisión del dueño sobre una campaña.
//   cambios:      CambioCampanaMl ({ clave, campanaId, observadoEl, antes, despues, recomendaciones })
//   diasPorItem:  Map itemId → [{ dia, evento, gasto, unidadesAds, ventaAds, adsMedido, stockFraccion }]
//   ecoPorItem:   Map itemId → economía de una venta ({ comisionPct, envio, costo, cargoFijo, esTecho })
export function notasPorCambio(cambios, diasPorItem, ecoPorItem, { hoy, ventana = 7, minimo = 5, alcance = 14, nombreDe = () => null } = {}) {
  const filas = new Map([...diasPorItem].map(([id, dias]) => [id, new Map(dias.map((d) => [d.dia, d]))]))
  const decisiones = [...(cambios ?? [])].filter((c) => c.antes && c.despues).map((c) => ({ c, dia: diaChile(c.observadoEl), ...describirCambio(c.antes, c.despues) }))
    .filter((x) => x.partes.length).sort((a, b) => +new Date(a.c.observadoEl) - +new Date(b.c.observadoEl))
  // la plata de la campaña en un día: lo que dejaron sus ventas por anuncio menos lo que gastó
  const plataDelDia = (items, dia) => {
    let plata = 0, gasto = 0, ventas = 0, conStock = false, sinCosto = false
    for (const id of items) {
      const d = filas.get(id)?.get(dia), eco = ecoPorItem.get(id)
      if (!d) continue
      if (d.evento || d.adsMedido === false) return null
      if (d.stockFraccion == null || d.stockFraccion >= 0.5) conStock = true
      if ((d.unidadesAds ?? 0) > 0) {
        if (!eco || !Number.isFinite(eco.comisionPct)) return null
        if (!Number.isFinite(eco.costo) || eco.esTecho) sinCosto = true
        plata += (d.ventaAds ?? 0) * (1 - eco.comisionPct / 100) - d.unidadesAds * ((eco.envio ?? 0) + (Number.isFinite(eco.costo) ? eco.costo : 0) + (eco.cargoFijo ?? 0))
        ventas += d.unidadesAds
      }
      plata -= d.gasto ?? 0
      gasto += d.gasto ?? 0
    }
    return conStock ? { plata, gasto, ventas, sinCosto } : null
  }
  // hasta `ventana` días limpios, los más cercanos al cambio, sin pasar de `alcance` días ni de otra decisión:
  // con quiebres de stock entremedio una semana corrida casi nunca junta sus días
  const medir = (items, dias) => {
    const limpios = []
    for (const d of dias) { if (limpios.length >= ventana) break; const x = plataDelDia(items, d); if (x) limpios.push(x) }
    const suma = (k) => limpios.reduce((a, x) => a + x[k], 0)
    return { dias: limpios.length, plataDia: limpios.length ? Math.round(suma('plata') / limpios.length) : null, gastoDia: limpios.length ? Math.round(suma('gasto') / limpios.length) : null,
      ventasDia: limpios.length ? Math.round((suma('ventas') / limpios.length) * 100) / 100 : null, sinCosto: limpios.some((x) => x.sinCosto) }
  }
  const casos = []
  for (const x of decisiones) {
    const { c, dia } = x
    const otras = decisiones.filter((o) => o.c.campanaId === c.campanaId && o !== x)
    // dos decisiones el mismo día sobre la misma campaña: vale la última
    if (otras.some((o) => o.dia === dia && +new Date(o.c.observadoEl) > +new Date(c.observadoEl))) continue
    const previa = otras.map((o) => o.dia).filter((d) => d < dia).sort().at(-1) ?? null
    const siguiente = otras.map((o) => o.dia).filter((d) => d > dia).sort()[0] ?? null
    const haciaAtras = Array.from({ length: alcance }, (_, i) => fecha(dia, -(i + 1))).filter((d) => !previa || d > previa)
    const haciaAdelante = Array.from({ length: alcance }, (_, i) => fecha(dia, i + 1)).filter((d) => d < hoy && (!siguiente || d < siguiente))
    const antes = medir(activos(c.antes), haciaAtras)
    const despues = medir(activos(c.despues), haciaAdelante)
    const plan = planDecia(x.partes, c.recomendaciones)
    const caso = { clave: c.clave, campanaId: c.campanaId, campana: nombreDe(c.campanaId), dia, cambio: x.texto, partes: x.partes.map(({ texto, ...p }) => p),
      antes, despues, planDecia: plan.acciones, seguiaElPlan: plan.seguia, sinCosto: antes.sinCosto || despues.sinCosto }
    if (antes.dias < minimo) Object.assign(caso, { estado: 'sin-base', lectura: `No hay ${minimo} días limpios antes del cambio para comparar.` })
    else if (despues.dias >= minimo) {
      const diferencia = despues.plataDia - antes.plataDia
      const resultado = diferencia > BANDA_PLATA_DIA ? 'mejoro' : diferencia < -BANDA_PLATA_DIA ? 'empeoro' : 'parecido'
      Object.assign(caso, { estado: 'con-nota', resultado, diferenciaDia: diferencia,
        lectura: `Antes dejaba ${pesos(antes.plataDia)} al día y después ${pesos(despues.plataDia)}: ${resultado === 'mejoro' ? 'mejoró' : resultado === 'empeoro' ? 'empeoró' : 'quedó parecido'}.` })
    } else if (siguiente && fecha(siguiente, -1) < fecha(dia, minimo)) Object.assign(caso, { estado: 'cambiada-antes', lectura: `La cambiaste de nuevo antes de ${minimo} días: no alcanza para ponerle nota.` })
    else if (fecha(dia, alcance) >= hoy) Object.assign(caso, { estado: 'midiendo', faltanDias: minimo - despues.dias, lectura: `Midiendo: lleva ${despues.dias} de ${minimo} días después del cambio.` })
    else Object.assign(caso, { estado: 'sin-dias', lectura: 'Después del cambio no hubo días limpios suficientes (sin stock o con evento).' })
    casos.push(caso)
  }
  const conNota = casos.filter((k) => k.estado === 'con-nota')
  const cuenta = (xs) => ({ n: xs.length, mejoraron: xs.filter((k) => k.resultado === 'mejoro').length, empeoraron: xs.filter((k) => k.resultado === 'empeoro').length })
  return { tipo: 'por-hechos', resumen: { decisiones: casos.length, conNota: conNota.length, ...cuenta(conNota), parecidos: conNota.filter((k) => k.resultado === 'parecido').length,
    midiendo: casos.filter((k) => k.estado === 'midiendo').length, siguiendoElPlan: cuenta(conNota.filter((k) => k.seguiaElPlan === true)), sinSeguirlo: cuenta(conNota.filter((k) => k.seguiaElPlan === false)) },
    casos: casos.slice(-20).reverse(),
    nota: 'Compara lo que dejaron las ventas por anuncio menos el gasto, por día, antes y después de cada cambio. Es un hecho, no prueba que el cambio lo haya causado.' }
}
