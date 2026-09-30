import mongoose from 'mongoose'
import { AdsDiaMl } from '../../models/AdsDiaMl.js'

// "COMIENZA CON ESTO Y VAMOS ANALIZANDO". El plan de campaña del learning machine.
//
// Pedido del importador (30-sep-2026), con los productos nuevos llegando ~10-oct:
// "no es necesario que sea 100% dictador, pero sí que diga comienza con esto y
// vamos analizando por dos o tres semanas; lo importante es que el learning
// machine gane dinero positivo hacia nosotros".
//
// Así que tres piezas, todas recomendaciones (nada se aplica solo en ML):
//   1. ARRANQUE: con lo aprendido de los anuncios propios (ml/publicidad.js),
//      el budget diario, el ROAS objetivo y si vale la pena anunciar.
//   2. PRUEBA DE DOS SEMANAS CON DOS NIVELES: semana 1 el budget base, semana
//      2 el doble. Con un gasto siempre igual el modelo no puede ver qué pasa
//      con más o con menos; con dos niveles aprende en 14 días cuál deja más.
//   3. REVISIÓN DIARIA contra la PLATA: lo que dejaron las ventas por anuncio
//      menos lo que costó conseguirlas. De ahí sale subir, mantener, bajar,
//      subir el ROAS objetivo o apagar. Y un marcador semanal de cuánto dejó la
//      publicidad, para saber si el learning machine hace ganar plata o no.

const DIA = 86400e3
const MARGEN_OBJETIVO = 1.2 // el ROAS objetivo deja 20% de aire sobre el empate
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null)
const redondear500 = (x) => Math.max(1000, Math.ceil(x / 500) * 500)
const plata = (x) => `$${Math.round(x).toLocaleString('es-CL')}`

const schema = new mongoose.Schema({
  itemId: { type: String, required: true },
  dia: { type: String, required: true },
  titulo: String,
  fase: String,
  accion: String,
  texto: String,
  budgetDiario: Number,
  roasObjetivo: Number,
  metricas: { type: mongoose.Schema.Types.Mixed, default: null },
  calculadoEl: { type: Date, required: true },
}, { versionKey: false })
schema.index({ itemId: 1, dia: 1 }, { unique: true })
schema.index({ dia: -1 })
export const RecomendacionAds = mongoose.models.RecomendacionAds ?? mongoose.model('RecomendacionAds', schema)

// Pura. Lo que deja UNA venta antes de publicidad. Sin costo cargado es un
// techo (mercadería gratis) y se dice.
export function economiaVenta({ precio, comisionPct = 17, envio = 800, costo = null }) {
  if (!Number.isFinite(precio) || precio <= 0) return null
  const comision = Math.round(precio * (comisionPct / 100))
  const deja = precio - comision - (Number.isFinite(envio) ? envio : 800) - (Number.isFinite(costo) ? costo : 0)
  return { precio, comision, comisionPct, envio: Math.round(envio ?? 800), costo: Number.isFinite(costo) ? costo : null, deja: Math.round(deja), esTecho: !Number.isFinite(costo),
    roasEmpate: deja > 0 ? r2(precio / deja) : null }
}

// Pura. Lo que dejaron unas ventas por anuncio, con el precio que SE COBRÓ
// (ventaAds trae los descuentos y promociones; el precio de lista no): la
// venta menos comisión, menos envío y costo por unidad.
export function dejaronDe(ventaAds, unidadesAds, eco) {
  if (!eco || !(unidadesAds > 0)) return 0
  const venta = ventaAds > 0 ? ventaAds : eco.precio * unidadesAds
  return venta * (1 - (eco.comisionPct ?? 17) / 100) - unidadesAds * ((eco.envio ?? 800) + (eco.costo ?? 0))
}

// Pura. El plan de arranque. `p` son los parámetros aprendidos (roas.mediana,
// roas.p75, ventasAdsPorDia).
export function planDeArranque(eco, p) {
  if (!eco || !p?.roas?.mediana) return null
  if (eco.deja <= 0) {
    return { accion: 'no-anunciar', fase: 'arranque', budgetDiario: 0, roasObjetivo: null,
      texto: `No anunciar: a ${plata(eco.precio)} una venta deja ${plata(eco.deja)} ${eco.esTecho ? 'incluso sin contar el costo del producto' : 'después del costo'}. Revisa precio o costo antes de gastar.` }
  }
  // a un decimal y hacia arriba: así se escribe en ML
  const roasObjetivo = Math.ceil(Math.max(p.roas.mediana * 0.9, eco.roasEmpate * MARGEN_OBJETIVO) * 10) / 10
  // ML no ha sostenido volumen sobre su p75: pedirle más es pagar y no vender
  const alcanzable = p.roas.p75 ?? p.roas.mediana
  if (roasObjetivo > alcanzable * 1.3) {
    return { accion: 'organico', fase: 'arranque', budgetDiario: 0, roasObjetivo: r2(roasObjetivo),
      texto: `Vender orgánico primero: para no perder necesitaría ROAS ${r2(roasObjetivo)}x y ML entrega ~${p.roas.mediana}x. Si en 2 semanas no vende solo, prueba chica de $1.000/día con ROAS ${r2(roasObjetivo)}x.` }
  }
  const costoVenta = eco.precio / roasObjetivo
  const base = redondear500(costoVenta * Math.max(1, p.ventasAdsPorDia ?? 1))
  return {
    accion: roasObjetivo > alcanzable ? 'arrancar-con-cuidado' : 'arrancar',
    fase: 'arranque', budgetDiario: base, roasObjetivo: r2(roasObjetivo),
    niveles: { semana1: base, semana2: base * 2 },
    texto: `Comienza con ${plata(base)}/día y ROAS objetivo ${r2(roasObjetivo)}x, en su propia campaña. Semana 2: sube a ${plata(base * 2)}/día para medir si más gasto deja más plata. `
      + `Cada venta deja ${plata(eco.deja)}${eco.esTecho ? ' antes del costo del producto' : ''}; bajo ROAS ${eco.roasEmpate}x la publicidad pierde.`,
  }
}

// Pura. Revisión de una campaña en curso. `dias`: filas diarias del producto
// desde el primer gasto { dia, gasto, unidadesAds, ventaAds, unidades }.
export function revisarCampana(dias, eco, p, { beta = null, diasCorriendo = dias.length } = {}) {
  const conGasto = dias.filter((d) => d.gasto > 0)
  if (!conGasto.length) return null
  const ult7 = dias.slice(-7)
  const suma = (xs, k) => xs.reduce((a, d) => a + (d[k] ?? 0), 0)
  const gasto7 = suma(ult7, 'gasto'), ventasAds7 = suma(ult7, 'unidadesAds'), venta7 = suma(ult7, 'ventaAds'), unidades7 = suma(ult7, 'unidades')
  const roas7 = gasto7 > 0 ? r2(venta7 / gasto7) : null
  // LA PLATA: lo que dejaron las ventas por anuncio menos lo que costaron
  const resultado7 = eco ? Math.round(dejaronDe(venta7, ventasAds7, eco) - gasto7) : null
  const gastoDiario = Math.round(gasto7 / Math.max(1, ult7.length))
  const fase = diasCorriendo <= 7 ? 'semana-1' : diasCorriendo <= 14 ? 'semana-2' : diasCorriendo <= 21 ? 'ajuste' : 'regular'
  const metricas = { diasCorriendo, gasto7, ventasAds7, unidades7, roas7, resultado7, gastoDiario, dejaPorVenta: eco?.deja ?? null, esTecho: eco?.esTecho ?? true }
  const base = { fase, metricas, roasObjetivo: eco?.roasEmpate ? Math.ceil(Math.max(p?.roas?.mediana ?? 0, eco.roasEmpate * MARGEN_OBJETIVO) * 10) / 10 : null }
  if (!eco) return { ...base, accion: 'sin-economia', budgetDiario: gastoDiario, texto: 'Falta el precio para saber si deja plata.' }

  // con la venta de cada día a la vista (media) y el efecto aprendido, el
  // gasto donde la próxima venta cuesta lo que deja
  // (solo si el producto vende al menos 1 al día: con menos, el efecto común
  // aplicado a una venta ínfima da "óptimo $0" contra un ROAS que dice otra cosa)
  const media = unidades7 / Math.max(1, ult7.length)
  const dejaReal = ventasAds7 > 0 ? dejaronDe(venta7, ventasAds7, eco) / ventasAds7 : eco.deja
  const optimo = beta > 0 && media >= 1 && dejaReal > 0 ? Math.max(0, Math.round((beta * media * dejaReal - 1000) / 500) * 500) : null
  metricas.budgetOptimoAprendido = optimo

  if (diasCorriendo < 5 && !(gasto7 >= 3 * eco.deja && ventasAds7 === 0)) {
    return { ...base, accion: 'esperar', budgetDiario: gastoDiario, texto: `Van ${diasCorriendo} días: muy poco para juzgar. Mantén ${plata(gastoDiario)}/día hasta el día 7.` }
  }
  if (ventasAds7 === 0 && gasto7 >= 3 * eco.deja) {
    return { ...base, accion: 'bajar', budgetDiario: redondear500(gastoDiario / 2),
      texto: `Gastó ${plata(gasto7)} en 7 días sin vender por anuncio. Baja a ${plata(redondear500(gastoDiario / 2))}/día y revisa fotos y precio: el clic llega y no compra.` }
  }
  if (resultado7 >= 0) {
    const holgada = roas7 != null && eco.roasEmpate && roas7 >= eco.roasEmpate * 1.3
    // en la semana 1 el plan manda doblar para aprender; después, subir solo si hay aire
    if (fase === 'semana-1') {
      return { ...base, accion: 'subir', budgetDiario: redondear500(gastoDiario * 2),
        texto: `Semana 1 deja plata (${plata(resultado7)} en 7 días, ROAS ${roas7}x). Como estaba planeado, semana 2 a ${plata(redondear500(gastoDiario * 2))}/día para medir si más gasto deja más.` }
    }
    if (holgada && (optimo == null || gastoDiario < optimo)) {
      const nuevo = optimo ? Math.min(optimo, redondear500(gastoDiario * 1.4)) : redondear500(gastoDiario * 1.4)
      return { ...base, accion: 'subir', budgetDiario: nuevo,
        texto: `Deja plata con aire: ${plata(resultado7)} en 7 días, ROAS ${roas7}x contra un empate de ${eco.roasEmpate}x. Sube a ${plata(nuevo)}/día.${optimo ? ` El techo aprendido es ${plata(optimo)}/día.` : ''}` }
    }
    // deja plata EN PROMEDIO, pero si gasta bastante sobre el óptimo, los
    // últimos pesos pierden: bajar hacia el óptimo deja más plata total
    if (optimo != null && optimo > 0 && gastoDiario > optimo * 1.3) {
      const nuevo = Math.max(optimo, redondear500(gastoDiario * 0.7))
      return { ...base, accion: 'bajar', budgetDiario: nuevo,
        texto: `Deja plata en promedio (${plata(resultado7)} en 7 días), pero gasta sobre lo que conviene: pasado ${plata(optimo)}/día la próxima venta cuesta más de lo que deja. Baja a ${plata(nuevo)}/día y deja más plata total.` }
    }
    return { ...base, accion: 'mantener', budgetDiario: gastoDiario,
      texto: `Deja plata: ${plata(resultado7)} en 7 días con ROAS ${roas7}x. Mantén ${plata(gastoDiario)}/día.` }
  }
  // pierde plata
  if (roas7 != null && eco.roasEmpate && roas7 >= eco.roasEmpate * 0.8) {
    const nuevoRoas = Math.ceil(eco.roasEmpate * MARGEN_OBJETIVO * 10) / 10
    return { ...base, accion: 'subir-roas', budgetDiario: gastoDiario, roasObjetivo: nuevoRoas,
      texto: `Pierde poco: ${plata(resultado7)} en 7 días, ROAS ${roas7}x contra un empate de ${eco.roasEmpate}x. Sube el ROAS objetivo a ${nuevoRoas}x para que ML puje solo por los clics que convierten.` }
  }
  if (fase === 'ajuste' || fase === 'regular') {
    return { ...base, accion: 'apagar', budgetDiario: 0,
      texto: `Lleva ${diasCorriendo} días y pierde ${plata(-resultado7)} en la última semana (ROAS ${roas7}x, empate ${eco.roasEmpate}x). Apágalo y deja que venda orgánico.` }
  }
  return { ...base, accion: 'bajar', budgetDiario: redondear500(gastoDiario / 2),
    texto: `Pierde ${plata(-resultado7)} en 7 días (ROAS ${roas7}x, empate ${eco.roasEmpate}x). Baja a ${plata(redondear500(gastoDiario / 2))}/día; si la próxima semana sigue en rojo, apágalo.` }
}

// Pura. El marcador: cuánto dejó la publicidad por semana, sumando productos.
export function marcadorSemanal(porProducto) {
  const semanas = new Map()
  for (const { dias, eco } of porProducto) {
    if (!eco) continue
    for (const d of dias) {
      if (!(d.gasto > 0) && !(d.unidadesAds > 0)) continue
      const t = new Date(`${d.dia}T12:00:00Z`)
      const lunes = new Date(+t - ((t.getUTCDay() + 6) % 7) * DIA).toISOString().slice(0, 10)
      const s = semanas.get(lunes) ?? { semana: lunes, gasto: 0, ventasAds: 0, dejaron: 0 }
      s.gasto += d.gasto ?? 0
      s.ventasAds += d.unidadesAds ?? 0
      s.dejaron += dejaronDe(d.ventaAds ?? 0, d.unidadesAds ?? 0, eco)
      semanas.set(lunes, s)
    }
  }
  return [...semanas.values()].sort((a, b) => a.semana.localeCompare(b.semana))
    .map((s) => ({ ...s, gasto: Math.round(s.gasto), dejaron: Math.round(s.dejaron), resultado: Math.round(s.dejaron - s.gasto) }))
}

// Todos los productos propios: plan de arranque si no tiene anuncio, revisión
// si ya gasta. Una fila por producto y día queda guardada (así se puede ver
// después si lo recomendado dejó plata).
export async function planesDeCampana({ ahora = new Date(), guardar = false } = {}) {
  const { ProductoPropio } = await import('../../models/ProductoPropio.js')
  const { DiaProductoMl } = await import('../../models/DiaProductoMl.js')
  const { parametrosPublicidad, AprendizajePublicidad } = await import('./publicidad.js')
  const { envioRealPorItem } = await import('../cargosMl.js')
  const { costoEnvioFull } = await import('../envioFull.js')
  const p = await parametrosPublicidad()
  if (!p) return { motivo: 'todavía no hay aprendizaje de publicidad' }
  const beta = (await AprendizajePublicidad.findOne().sort({ dia: -1 }).select('efecto.beta efecto.estado').lean())?.efecto
  const betaUsable = beta?.estado === 'aprendido' ? beta.beta : null
  const envioReal = await envioRealPorItem({ dias: 60 }).catch(() => new Map())
  const propios = await ProductoPropio.find({ estado: 'activo' }).lean()
  const ids = propios.map((x) => x.itemIdMl ?? x.sku)
  const desde = new Date(+ahora - 60 * DIA).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
  const ads = await AdsDiaMl.find({ itemId: { $in: ids }, dia: { $gte: desde } }).select('itemId dia costo unidadesAds ventaAds').lean()
  const libro = await DiaProductoMl.find({ itemId: { $in: ids }, dia: { $gte: desde } }).select('itemId dia unidades').lean()
  const hoy = new Date(ahora).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
  const salida = []
  const paraMarcador = []
  for (const prop of propios) {
    const id = prop.itemIdMl ?? prop.sku
    const ult = [...(prop.mediciones ?? [])].sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha)).at(-1)
    const precio = prop.promoMl?.activa?.precio ?? ult?.precioEfectivo ?? ult?.precio ?? null
    let envio = envioReal.get(id)?.porUnidad ?? null
    if (envio == null && Number.isFinite(precio)) envio = (await costoEnvioFull({ precioClp: precio }).catch(() => null))?.clp ?? null
    // el precio que SE COBRA (con promociones) de las ventas por anuncio de las
    // últimas 2 semanas; sin ventas, el de lista
    const recientes = ads.filter((a) => a.itemId === id && a.unidadesAds > 0 && a.dia >= new Date(+ahora - 14 * DIA).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }))
    const u14 = recientes.reduce((a, x) => a + x.unidadesAds, 0)
    const precioCobrado = u14 >= 2 ? Math.round(recientes.reduce((a, x) => a + x.ventaAds, 0) / u14) : null
    const eco = economiaVenta({ precio: precioCobrado ?? precio, envio, costo: prop.costoUnitarioClp ?? null })
    // la serie desde el primer día con gasto (o vacía si nunca se anunció)
    const susAds = ads.filter((a) => a.itemId === id)
    const primer = susAds.filter((a) => a.costo > 0).map((a) => a.dia).sort()[0] ?? null
    let plan = null
    let dias = []
    if (primer) {
      const porDia = new Map(susAds.map((a) => [a.dia, a]))
      const ventas = new Map(libro.filter((l) => l.itemId === id).map((l) => [l.dia, l.unidades]))
      for (let t = +new Date(`${primer}T12:00:00Z`); new Date(t).toISOString().slice(0, 10) < hoy; t += DIA) {
        const dia = new Date(t).toISOString().slice(0, 10)
        const a = porDia.get(dia)
        dias.push({ dia, gasto: a?.costo ?? 0, unidadesAds: a?.unidadesAds ?? 0, ventaAds: a?.ventaAds ?? 0, unidades: ventas.get(dia) ?? 0 })
      }
      // una campaña apagada hace más de 7 días ya no se revisa como en curso
      const ultimoGasto = susAds.filter((a) => a.costo > 0).map((a) => a.dia).sort().at(-1)
      if (ultimoGasto && +new Date(hoy) - +new Date(ultimoGasto) > 7 * DIA) plan = { fase: 'apagada', accion: 'apagada', budgetDiario: 0, texto: `Sin gasto desde ${ultimoGasto}.` }
      else plan = revisarCampana(dias.slice(-21), eco, p, { beta: betaUsable, diasCorriendo: dias.length })
      paraMarcador.push({ dias, eco })
    } else {
      plan = planDeArranque(eco, p)
    }
    if (!plan) continue
    const fila = { itemId: id, titulo: prop.titulo ?? null, precio: precioCobrado ?? precio, precioLista: precio, economia: eco, ...plan }
    salida.push(fila)
    if (guardar) {
      await RecomendacionAds.updateOne({ itemId: id, dia: hoy }, { $set: { titulo: fila.titulo, fase: plan.fase, accion: plan.accion, texto: plan.texto,
        budgetDiario: plan.budgetDiario ?? null, roasObjetivo: plan.roasObjetivo ?? null, metricas: { ...(plan.metricas ?? {}), economia: eco }, calculadoEl: ahora } }, { upsert: true })
    }
  }
  const marcador = marcadorSemanal(paraMarcador)
  return { dia: hoy, productos: salida, marcador, sinCosto: salida.filter((x) => x.economia?.esTecho).length }
}
