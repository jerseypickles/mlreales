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
