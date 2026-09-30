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
// la regla inicial de subir (ROAS/empate) y cuánto pesa frente a lo aprendido
const UMBRAL_INICIAL = 1.3
const PESO_PREVIO = 30
const MIN_TRANSICIONES = 12
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
export function revisarCampana(dias, eco, p, { beta = null, diasCorriendo = dias.length, umbral = UMBRAL_INICIAL } = {}) {
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
    // el umbral lo aprende aprenderUmbral con la plata de cada cambio de gasto
    const holgada = roas7 != null && eco.roasEmpate && roas7 >= eco.roasEmpate * umbral
    // en la semana 1 el plan manda doblar para aprender; después, subir solo si hay aire
    if (fase === 'semana-1') {
      return { ...base, accion: 'subir', budgetDiario: redondear500(gastoDiario * 2),
        texto: `Semana 1 deja plata (${plata(resultado7)} en 7 días, ROAS ${roas7}x). Como estaba planeado, semana 2 a ${plata(redondear500(gastoDiario * 2))}/día para medir si más gasto deja más.` }
    }
    if (holgada && (optimo == null || gastoDiario < optimo)) {
      const nuevo = optimo ? Math.min(optimo, redondear500(gastoDiario * 1.4)) : redondear500(gastoDiario * 1.4)
      return { ...base, accion: 'subir', budgetDiario: nuevo,
        texto: `Deja plata con aire: ${plata(resultado7)} en 7 días, ROAS ${roas7}x contra un empate de ${eco.roasEmpate}x (subir conviene sobre ${r2(eco.roasEmpate * umbral)}x, aprendido). Sube a ${plata(nuevo)}/día.${optimo ? ` El techo aprendido es ${plata(optimo)}/día.` : ''}` }
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
  // pierde plata en la semana. ¿Alcanzó el gasto para juzgarlo? Con el gasto
  // de dos ventas al empate (2 × lo que deja una venta) se esperan ~2 ventas;
  // con menos, una semana en cero es casi azar. Caso 30-sep: Set 10, Set 18 y
  // escopeta gastaban $150-330/día dentro de la campaña mixta (ML le daba casi
  // todo al Set 8), vendieron 0 esa semana y la regla decía "apagar" — cuando
  // en 30 días los tres dejaban plata (+$6.244, +$4.349, +$931).
  const muestra7 = gasto7 >= 2 * eco.deja
  if (!muestra7) {
    const ult30 = dias.slice(-30)
    const gasto30 = suma(ult30, 'gasto'), ventasAds30 = suma(ult30, 'unidadesAds'), venta30 = suma(ult30, 'ventaAds')
    const resultado30 = Math.round(dejaronDe(venta30, ventasAds30, eco) - gasto30)
    metricas.resultado30 = resultado30
    metricas.gasto30 = Math.round(gasto30)
    if (gasto30 < 2 * eco.deja) {
      return { ...base, accion: 'esperar', budgetDiario: Math.max(gastoDiario, 1000),
        texto: `Gasta tan poco (${plata(gastoDiario)}/día) que ni en 30 días alcanza para juzgarlo. Dale una campaña propia de ${plata(Math.max(gastoDiario, 1000))}/día por 2 semanas para saber si rinde.` }
    }
    if (resultado30 >= 0) {
      return { ...base, accion: 'mantener', budgetDiario: gastoDiario,
        texto: `Semana floja (${plata(resultado7)}) pero con muy poco gasto para juzgar: en 30 días deja ${plata(resultado30)}. Mantén; en una campaña propia se mide mejor.` }
    }
    // en 30 días también pierde: se juzga con esa ventana
    return { ...base, accion: fase === 'ajuste' || fase === 'regular' ? 'apagar' : 'bajar', budgetDiario: fase === 'ajuste' || fase === 'regular' ? 0 : redondear500(gastoDiario / 2),
      texto: `En 30 días pierde ${plata(-resultado30)} con ${plata(gasto30)} de gasto. ${fase === 'ajuste' || fase === 'regular' ? 'Apágalo y deja que venda orgánico.' : `Baja a ${plata(redondear500(gastoDiario / 2))}/día.`}` }
  }
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

// Pura. Desde qué día el producto gasta en su campaña ACTUAL (la del último
// día con gasto). Si siempre estuvo en la misma, su primer día de gasto.
export function diaDeCampanaActual(filas) {
  const conGasto = filas.filter((a) => a.costo > 0 && a.campanaId != null).sort((a, b) => a.dia.localeCompare(b.dia))
  if (!conGasto.length) return null
  const actual = conGasto.at(-1).campanaId
  let desde = conGasto.at(-1).dia
  for (let i = conGasto.length - 1; i >= 0 && conGasto[i].campanaId === actual; i--) desde = conGasto[i].dia
  return desde
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
  // todos: los pausados no llevan plan, pero su historia de publicidad enseña
  const propios = await ProductoPropio.find({}).lean()
  const ids = propios.map((x) => x.itemIdMl ?? x.sku)
  // toda la historia que ML retiene de publicidad (~100 días)
  const desde = new Date(+ahora - 120 * DIA).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
  const ads = await AdsDiaMl.find({ itemId: { $in: ids }, dia: { $gte: desde } }).select('itemId dia costo unidadesAds ventaAds campanaId').lean()
  const libro = await DiaProductoMl.find({ itemId: { $in: ids }, dia: { $gte: desde } }).select('itemId dia unidades').lean()
  const hoy = new Date(ahora).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
  const salida = []
  const paraMarcador = []
  const transiciones = []
  const diasPorItem = new Map()
  const ecoPorItem = new Map()
  const libroPrecio = await DiaProductoMl.find({ itemId: { $in: ids }, dia: { $gte: desde } }).select('itemId dia precio stockFraccion').lean()
  const precioDia = new Map(libroPrecio.map((l) => [`${l.itemId}|${l.dia}`, l.precio]))
  const stockDia = new Map(libroPrecio.map((l) => [`${l.itemId}|${l.dia}`, l.stockFraccion]))
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
        dias.push({ dia, gasto: a?.costo ?? 0, unidadesAds: a?.unidadesAds ?? 0, ventaAds: a?.ventaAds ?? 0, unidades: ventas.get(dia) ?? 0, precio: precioDia.get(`${id}|${dia}`) ?? null, stockFraccion: stockDia.get(`${id}|${dia}`) ?? null })
      }
      // una campaña apagada hace más de 7 días ya no se revisa como en curso
      const ultimoGasto = susAds.filter((a) => a.costo > 0).map((a) => a.dia).sort().at(-1)
      if (ultimoGasto && +new Date(hoy) - +new Date(ultimoGasto) > 7 * DIA) plan = { fase: 'apagada', accion: 'apagada', budgetDiario: 0, texto: `Sin gasto desde ${ultimoGasto}.` }
      else plan = { pendiente: true, desdeCampana: diaDeCampanaActual(susAds) }
      paraMarcador.push({ dias, eco })
      transiciones.push(...transicionesSemanales(dias, eco).map((t) => ({ ...t, itemId: id })))
      diasPorItem.set(id, dias)
      ecoPorItem.set(id, eco)
    } else {
      plan = planDeArranque(eco, p)
    }
    if (!plan || prop.estado !== 'activo') continue
    salida.push({ itemId: id, titulo: prop.titulo ?? null, precio: precioCobrado ?? precio, precioLista: precio, economia: eco, _dias: dias, ...plan })
  }

  // LAS REGLAS: el umbral de subir sale de los cambios de gasto de toda la
  // historia, y las recomendaciones pasadas se evalúan contra la plata
  const { ajustarRidge } = await import('./regresion.js')
  const decision = aprenderUmbral(transiciones, { ajustar: ajustarRidge })
  const recsViejas = await RecomendacionAds.find({ dia: { $lt: hoy } }).select('itemId dia accion').lean()
  const evaluacion = evaluarRecomendaciones(recsViejas, diasPorItem, ecoPorItem, { hoy })
  for (const fila of salida) {
    if (fila.pendiente) {
      // la fase cuenta desde que el producto está en su campaña ACTUAL: si se
      // lo pasó a una campaña propia, arranca su prueba de 2 semanas ahí
      const enCampana = fila.desdeCampana ? fila._dias.filter((d) => d.dia >= fila.desdeCampana).length : fila._dias.length
      const r = revisarCampana(fila._dias, fila.economia, p, { beta: betaUsable, diasCorriendo: enCampana, umbral: decision.umbral })
      if (r && fila.desdeCampana && enCampana < fila._dias.length && enCampana <= 21) r.texto = `En su campaña nueva desde ${fila.desdeCampana}. ${r.texto}`
      delete fila.pendiente
      delete fila.desdeCampana
      Object.assign(fila, r ?? { accion: 'sin-datos', texto: 'Sin datos suficientes.' })
    }
    delete fila._dias
    const id = fila.itemId, plan = fila
    if (guardar) {
      await RecomendacionAds.updateOne({ itemId: id, dia: hoy }, { $set: { titulo: fila.titulo, fase: plan.fase, accion: plan.accion, texto: plan.texto,
        budgetDiario: plan.budgetDiario ?? null, roasObjetivo: plan.roasObjetivo ?? null, metricas: { ...(plan.metricas ?? {}), economia: plan.economia, umbral: decision.umbral }, calculadoEl: ahora } }, { upsert: true })
    }
  }
  const marcador = marcadorSemanal(paraMarcador)
  // la estructura real de las campañas contra lo que recomienda el plan
  let estructura = null
  try {
    const { resumenAds } = await import('../ads.js')
    const r = await resumenAds({ dias: 7 })
    if (r) {
      estructura = estructuraCampanas({ campanas: r.campanas ?? [], porItem: r.porItem ?? {}, planes: salida })
      const campanaDe = new Map(Object.entries(r.porItem ?? {}).map(([id, a]) => [id, (r.campanas ?? []).find((c) => c.id === a.campanaId)?.nombre ?? null]))
      for (const f of salida) f.campana = campanaDe.get(f.itemId) ?? null
    }
  } catch (err) {
    console.warn(`[plan-campanas] estructura de campañas no leída: ${err.message}`)
  }
  return { dia: hoy, productos: salida, marcador, estructura, sinCosto: salida.filter((x) => x.economia?.esTecho).length,
    reglas: { ...decision, transiciones: transiciones.length, ultimas: transiciones.slice(-12) }, evaluacion }
}

// ─── LAS REGLAS TAMBIÉN SE APRENDEN ─────────────────────────────────────────
//
// El importador, 30-sep-2026: "no sirve con umbral razonable, eso es un
// learning machine en observación; necesitamos que aprenda". La regla de
// "subir si el ROAS supera el empate en 30%" la puse yo. Ahora sale de la
// plata: cada cambio de gasto de una semana a la siguiente, en cualquier
// producto, es un experimento natural. Si subió el gasto, ¿la plata TOTAL del
// producto (todas sus ventas por lo que deja cada una, menos la publicidad)
// subió o bajó? ¿Y a qué ROAS estaba cuando eso pasó?
//
// Modelo: Δplata = a·Δlog(gasto) + b·Δlog(gasto)·(ROAS/empate − 1) + c. Subir
// el gasto deja más plata cuando a + b·(r − 1) > 0, o sea sobre r* = 1 − a/b.
// Ese r* es el umbral aprendido. Con pocos casos se mezcla con la regla
// inicial (1,3), pesando lo aprendido n/(n+30); con muchos, manda lo aprendido.


// Pura. semanas por producto desde su primer gasto; `dias` trae
// { dia, gasto, unidadesAds, ventaAds, unidades, precio }.
export function transicionesSemanales(dias, eco) {
  if (!eco || !dias.length) return []
  const semanas = []
  for (let i = 0; i + 7 <= dias.length; i += 7) {
    const w = dias.slice(i, i + 7)
    const suma = (k) => w.reduce((a, d) => a + (d[k] ?? 0), 0)
    const unidades = suma('unidades'), gasto = suma('gasto'), ventaAds = suma('ventaAds')
    const conPrecio = w.filter((d) => d.precio > 0)
    const precio = conPrecio.length ? conPrecio.reduce((a, d) => a + d.precio, 0) / conPrecio.length : eco.precio
    const dejaUnidad = precio * (1 - (eco.comisionPct ?? 17) / 100) - (eco.envio ?? 800) - (eco.costo ?? 0)
    // SIN STOCK NO ES "APAGAR LA PUBLICIDAD": stock medido bajo 50%, o una
    // semana entera sin ventas y sin gasto (el producto pausado o quebrado;
    // el stock diario solo se mide desde el 1-sep)
    const conStock = w.filter((d) => d.stockFraccion != null)
    const sinStock = (conStock.length && conStock.reduce((a, d) => a + d.stockFraccion, 0) / conStock.length < 0.5) || (unidades === 0 && gasto === 0)
    semanas.push({ desde: w[0].dia, sinStock, gasto, unidades, roas: gasto > 0 ? ventaAds / gasto : null, empate: dejaUnidad > 0 ? precio / dejaUnidad : null,
      plata: unidades * dejaUnidad - gasto, escala: Math.max(1, Math.abs(dejaUnidad)) })
  }
  const salida = []
  for (let t = 0; t + 1 < semanas.length; t++) {
    const a = semanas[t], b = semanas[t + 1]
    if (a.sinStock || b.sinStock || !(a.gasto > 0) || a.roas == null || !a.empate) continue
    salida.push({ desde: a.desde, ratio: a.roas / a.empate, dlog: Math.log((b.gasto + 500) / (a.gasto + 500)),
      // la plata en "ventas equivalentes" para poder juntar productos de precios distintos
      dplata: (b.plata - a.plata) / a.escala, gastoAntes: Math.round(a.gasto), gastoDespues: Math.round(b.gasto), plataAntes: Math.round(a.plata), plataDespues: Math.round(b.plata) })
  }
  return salida
}

// Pura. El umbral de ROAS/empate sobre el cual subir el gasto dejó más plata.
export function aprenderUmbral(transiciones, { ajustar, previo = UMBRAL_INICIAL } = {}) {
  const utiles = transiciones.filter((t) => Math.abs(t.dlog) >= 0.1 && Number.isFinite(t.ratio) && Number.isFinite(t.dplata))
  const n = utiles.length
  const base = { previo, n, umbral: previo, peso: 0 }
  if (n < MIN_TRANSICIONES || !ajustar) return { ...base, estado: 'pocos-casos' }
  const filas = utiles.map((t) => ({ xs: [t.dlog, t.dlog * (Math.min(t.ratio, 4) - 1)], y: t.dplata, grupo: t.desde, fin: 0 }))
  let m
  try { m = ajustar(filas, { lambda: 1 }) } catch { return { ...base, estado: 'no-ajusta' } }
  const a = m.coeficientes[1] / m.escalas[0], b = m.coeficientes[2] / m.escalas[1]
  // b > 0: mientras más aire de ROAS, más rinde subir. Si no, los datos no
  // dicen dónde está el corte y se queda la regla previa
  if (!(b > 0)) return { ...base, a: r2(a), b: r2(b), estado: 'sin-patron' }
  const aprendido = Math.min(3, Math.max(0.8, 1 - a / b))
  const peso = n / (n + PESO_PREVIO)
  return { ...base, a: r2(a), b: r2(b), aprendido: r2(aprendido), peso: r2(peso), umbral: r2(peso * aprendido + (1 - peso) * previo), estado: 'aprendido' }
}

// Pura. ¿Sirvieron las recomendaciones? Siete días después de cada una: si el
// gasto se movió en la dirección recomendada (la siguió) y si la plata total
// del producto mejoró. `recs`: { itemId, dia, accion, metricas.gastoDiario };
// `diasPorItem`: itemId → filas diarias.
export function evaluarRecomendaciones(recs, diasPorItem, ecoPorItem, { hoy }) {
  const evaluadas = []
  for (const r of recs) {
    const dias = diasPorItem.get(r.itemId) ?? []
    const eco = ecoPorItem.get(r.itemId)
    const i = dias.findIndex((d) => d.dia > r.dia)
    if (i < 0 || !eco) continue
    const despues = dias.slice(i, i + 7)
    if (despues.length < 7 || despues.at(-1).dia >= hoy) continue
    const antes = dias.slice(Math.max(0, i - 7), i)
    const plataDe = (w) => w.reduce((a, d) => a + (d.unidades ?? 0), 0) * eco.deja - w.reduce((a, d) => a + (d.gasto ?? 0), 0)
    const gAntes = antes.reduce((a, d) => a + d.gasto, 0) / Math.max(1, antes.length), gDespues = despues.reduce((a, d) => a + d.gasto, 0) / 7
    const cambio = gAntes > 0 ? gDespues / gAntes : gDespues > 0 ? 2 : 1
    const siguio = { subir: cambio >= 1.15, bajar: cambio <= 0.85, apagar: gDespues < 100, mantener: cambio > 0.85 && cambio < 1.15, esperar: cambio > 0.85 && cambio < 1.15 }[r.accion]
    if (siguio == null) continue
    evaluadas.push({ itemId: r.itemId, dia: r.dia, accion: r.accion, siguio, plataAntes: Math.round(plataDe(antes)), plataDespues: Math.round(plataDe(despues)), mejoro: plataDe(despues) > plataDe(antes) })
  }
  const seguidas = evaluadas.filter((e) => e.siguio)
  return { evaluadas: evaluadas.length, seguidas: seguidas.length, aciertos: seguidas.filter((e) => e.mejoro).length,
    tasaAcierto: seguidas.length ? Math.round((seguidas.filter((e) => e.mejoro).length / seguidas.length) * 100) : null,
    // lo mismo para las que NO se siguieron: la comparación que dice si seguirlas sirve
    tasaSinSeguir: evaluadas.length - seguidas.length ? Math.round((evaluadas.filter((e) => !e.siguio && e.mejoro).length / (evaluadas.length - seguidas.length)) * 100) : null,
    detalle: evaluadas.slice(-20) }
}

// ─── CÓMO ESTÁN ARMADAS LAS CAMPAÑAS ─────────────────────────────────────────
//
// El importador, 30-sep-2026: "hay una sola campaña activa y están todos los
// productos; eso también debería detectarlo e indicar: haz la campaña
// independiente". En una campaña compartida ML reparte el gasto a su criterio
// (el Set 8 se llevaba 46%), hay un solo ROAS objetivo para productos que
// empatan en ROAS distintos, y el learning machine no puede separar qué rinde
// cada uno. Esto mira la estructura real y dice qué mover.

const ACTIVOS = new Set(['subir', 'mantener', 'bajar', 'esperar', 'subir-roas', 'arrancar', 'arrancar-con-cuidado'])
const FUERA = new Set(['apagar', 'organico', 'no-anunciar'])
const BUDGET_MINIMO_SOLO = 1000 // bajo esto una campaña propia no junta datos: se agrupa

// Pura. Un nombre corto que distinga: "Brochas Maquillaje Profesionales Set 8
// + Organizador Rosa" → "Brochas Maquillaje Set 8". Las 4 primeras palabras
// dejaban tres productos como "Brochas Maquillaje Profesionales Set".
export function nombreCorto(titulo) {
  const w = String(titulo ?? '').split(/\s+/).filter(Boolean)
  const i = w.findIndex((x, k) => k >= 2 && /\d/.test(x))
  if (i < 0) return w.slice(0, 5).join(' ')
  return [...w.slice(0, 2), ...(i - 1 >= 2 ? [w[i - 1]] : []), w[i]].join(' ')
}

// Pura. campanas: [{ id, nombre, estado, presupuestoDiario, roasObjetivo }];
// porItem: itemId → { campanaId, estado }; planes: [{ itemId, titulo, accion,
// budgetDiario, roasObjetivo, economia: { roasEmpate } }].
export function estructuraCampanas({ campanas = [], porItem = {}, planes = [] }) {
  const corto = nombreCorto
  const plata = (x) => `$${Math.round(x).toLocaleString('es-CL')}`
  const plan = new Map(planes.map((p) => [p.itemId, p]))
  const acciones = []
  const resumen = []
  for (const c of campanas.filter((x) => x.estado === 'active')) {
    const suyos = Object.entries(porItem).filter(([, a]) => a?.campanaId === c.id && a?.estado !== 'paused').map(([id, a]) => ({ id, anuncio: a.estado, plan: plan.get(id) })).filter((x) => x.plan)
    const conStock = suyos.filter((x) => x.anuncio !== 'hold')
    resumen.push({ id: c.id, nombre: c.nombre, presupuestoDiario: c.presupuestoDiario ?? null, roasObjetivo: c.roasObjetivo ?? null, productos: suyos.map((x) => corto(x.plan.titulo)), compartida: conStock.length > 1 })
    // 1. lo que el plan manda sacar de la publicidad y sigue anunciándose acá
    for (const x of conStock.filter((y) => FUERA.has(y.plan.accion))) {
      acciones.push({ prioridad: 1, tipo: 'pausar-anuncio', itemId: x.id, campana: c.nombre,
        texto: `Pausa el anuncio de ${corto(x.plan.titulo)} dentro de «${c.nombre}»: ${x.plan.accion === 'apagar' ? 'pierde plata' : 'no le conviene publicidad a su precio'}. Sigue vendiendo orgánico.` })
    }
    const siguen = conStock.filter((y) => ACTIVOS.has(y.plan.accion))
    if (siguen.length < 2) {
      // una campaña con un solo producto: solo ajustar budget y ROAS si no calzan
      const x = siguen[0]
      if (x && Number.isFinite(x.plan.budgetDiario) && Number.isFinite(c.presupuestoDiario) && Math.abs(c.presupuestoDiario - x.plan.budgetDiario) > Math.max(500, 0.25 * x.plan.budgetDiario)) {
        acciones.push({ prioridad: 3, tipo: 'ajustar-budget', campana: c.nombre, texto: `Ajusta el presupuesto de «${c.nombre}» de ${plata(c.presupuestoDiario)} a ${plata(x.plan.budgetDiario)}/día (lo que recomienda el plan de ${corto(x.plan.titulo)}).` })
      }
      continue
    }
    // 2. varios productos que siguen anunciándose en la misma campaña: los que
    // tienen budget propio suficiente van a su campaña; los chicos se agrupan
    // solo si empatan en un ROAS parecido
    const solos = siguen.filter((y) => (y.plan.budgetDiario ?? 0) >= BUDGET_MINIMO_SOLO)
    const chicos = siguen.filter((y) => (y.plan.budgetDiario ?? 0) < BUDGET_MINIMO_SOLO)
    const empates = siguen.map((y) => y.plan.economia?.roasEmpate).filter(Number.isFinite)
    const dispares = empates.length > 1 && Math.max(...empates) / Math.min(...empates) > 1.25
    const motivo = dispares
      ? `sus productos empatan en ROAS muy distintos (${Math.min(...empates).toString().replace('.', ',')}x a ${Math.max(...empates).toString().replace('.', ',')}x) y «${c.nombre}» les pone a todos ${String(c.roasObjetivo ?? '—').replace('.', ',')}x`
      : `ML reparte el gasto a su criterio entre ${siguen.length} productos y el learning machine no puede medir qué rinde cada uno`
    // el que se queda en la campaña actual es el que más budget pide; el resto sale
    const orden = [...solos].sort((a, b) => (b.plan.budgetDiario ?? 0) - (a.plan.budgetDiario ?? 0))
    const [queda, ...salen] = orden
    if (queda) {
      acciones.push({ prioridad: 2, tipo: 'separar', campana: c.nombre, itemId: queda.id,
        texto: `Deja «${c.nombre}» solo para ${corto(queda.plan.titulo)}: ${plata(queda.plan.budgetDiario)}/día y ROAS objetivo ${String(queda.plan.roasObjetivo ?? c.roasObjetivo ?? '—').replace('.', ',')}x. Hoy ${motivo}.` })
    }
    for (const x of salen) {
      acciones.push({ prioridad: 2, tipo: 'campana-propia', campana: c.nombre, itemId: x.id,
        texto: `Crea una campaña solo para ${corto(x.plan.titulo)}: ${plata(x.plan.budgetDiario)}/día y ROAS objetivo ${String(x.plan.roasObjetivo ?? '—').replace('.', ',')}x, y saca su anuncio de «${c.nombre}».` })
    }
    if (chicos.length) {
      const budget = Math.max(1000, chicos.reduce((a, y) => a + (y.plan.budgetDiario ?? 0), 0))
      const roas = Math.max(...chicos.map((y) => y.plan.roasObjetivo ?? 0))
      acciones.push({ prioridad: 3, tipo: 'agrupar-chicos', campana: c.nombre,
        texto: chicos.length === 1 && !queda
          ? `Deja ${corto(chicos[0].plan.titulo)} en «${c.nombre}» con ${plata(budget)}/día: vende poco para una campaña propia.`
          : `Agrupa ${chicos.map((y) => corto(y.plan.titulo)).join(', ')} en una campaña aparte de ${plata(budget)}/día con ROAS ${String(roas || '—').replace('.', ',')}x: venden poco para tener campaña propia cada uno.` })
    }
  }
  // 3. productos con plan de arranque que no tienen anuncio: campaña nueva
  for (const p of planes.filter((x) => ['arrancar', 'arrancar-con-cuidado'].includes(x.accion) && !porItem[x.itemId]?.campanaId)) {
    acciones.push({ prioridad: 2, tipo: 'crear', itemId: p.itemId, texto: `Crea una campaña solo para ${corto(p.titulo)}: ${plata(p.budgetDiario)}/día y ROAS objetivo ${String(p.roasObjetivo).replace('.', ',')}x (prueba de 2 semanas; la segunda al doble).` })
  }
  return { campanas: resumen, acciones: acciones.sort((a, b) => a.prioridad - b.prioridad) }
}
