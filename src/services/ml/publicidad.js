import mongoose from 'mongoose'
import { AdsDiaMl } from '../../models/AdsDiaMl.js'

// LO QUE LA PUBLICIDAD LE ENSEÑÓ A LA CUENTA, Y EL PLAN PARA LO QUE VIENE.
//
// Pedido del importador (28-sep-2026): "los productos que vienen tendrán que
// tener esta información antes de publicitar". La mesa de Publicidad juzgaba
// anuncios que ya gastaron; esto aprende de ellos los números que se repiten
// —qué ROAS entrega ML con volumen, cuánto cuesta cada venta por anuncio, cuánto
// sube el envío real sobre la tarifa, cuántas ventas por día trae un anuncio— y
// con eso arma el plan de un producto ANTES de su primer peso en publicidad.
//
// Lo que se midió el 28-sep sobre 8 anuncios: el ROAS real va de 1,8x a 3,35x
// con el objetivo de campaña en 2,6x; cada venta por anuncio cuesta
// $1.100-1.900 (la lámpara $3.550) casi sin importar el precio, y el envío
// real promedia 1,3-3× la base de $799. Por eso bajo ~$4.000 de ticket la
// publicidad se come la venta.

const DIA = 86400e3
const MIN_UNIDADES_PRODUCTO = 10 // un anuncio con menos ventas no enseña su ROAS
const MARGEN_SOBRE_EQUILIBRIO = 1.2 // el objetivo deja 20% de aire sobre el empate

const schema = new mongoose.Schema({
  dia: { type: String, required: true, unique: true },
  parametros: { type: mongoose.Schema.Types.Mixed, required: true },
  porProducto: { type: [mongoose.Schema.Types.Mixed], default: [] },
  // el efecto real de la publicidad sobre las ventas totales (entrenarEfecto)
  efecto: { type: mongoose.Schema.Types.Mixed, default: null },
  calculadoEl: { type: Date, required: true },
}, { versionKey: false })
export const AprendizajePublicidad = mongoose.models.AprendizajePublicidad ?? mongoose.model('AprendizajePublicidad', schema)

const cuantil = (xs, q) => {
  const o = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!o.length) return null
  const i = (o.length - 1) * q
  return o[Math.floor(i)] + (o[Math.ceil(i)] - o[Math.floor(i)]) * (i - Math.floor(i))
}
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null)

// Pura. filas: acumulado por anuncio { itemId, costo, clicks, unidadesAds,
// unidadesOrganicas, ventaAds, dias }; envio: itemId → { porUnidad, base }.
export function aprenderDeAnuncios(filas, envio = new Map()) {
  const porProducto = filas.filter((f) => f.costo > 0 || f.unidadesAds > 0).map((f) => {
    const e = envio.get(f.itemId)
    return {
      itemId: f.itemId, titulo: f.titulo ?? null,
      gasto: Math.round(f.costo), unidadesAds: f.unidadesAds, unidadesOrganicas: f.unidadesOrganicas, clicks: f.clicks, dias: f.dias,
      precioPorVenta: f.unidadesAds > 0 ? Math.round(f.ventaAds / f.unidadesAds) : null,
      roas: f.costo > 0 ? r2(f.ventaAds / f.costo) : null,
      costoPorVenta: f.unidadesAds > 0 ? Math.round(f.costo / f.unidadesAds) : null,
      cpc: f.clicks > 0 ? Math.round(f.costo / f.clicks) : null,
      conversion: f.clicks > 0 ? r2((f.unidadesAds / f.clicks) * 100) : null,
      ventasAdsPorDia: f.dias > 0 ? r2(f.unidadesAds / f.dias) : null,
      envioPorUnidad: e?.porUnidad ?? null, envioBase: e?.base ?? null,
      factorEnvio: e?.porUnidad && e?.base ? r2(e.porUnidad / e.base) : null,
    }
  })
  const conMuestra = porProducto.filter((p) => p.unidadesAds >= MIN_UNIDADES_PRODUCTO)
  const total = (k) => porProducto.reduce((a, p) => a + (p[k] ?? 0), 0)
  const gasto = total('gasto'), unidades = total('unidadesAds'), organicas = total('unidadesOrganicas')
  const venta = porProducto.reduce((a, p) => a + (p.precioPorVenta ?? 0) * p.unidadesAds, 0)
  const conEnvio = porProducto.filter((p) => p.factorEnvio != null)
  return {
    parametros: {
      productos: porProducto.length,
      productosConMuestra: conMuestra.length,
      unidadesAds: unidades,
      gasto,
      // el ROAS que ML entregó CON VOLUMEN: la mediana es lo esperable, el p75
      // lo mejor que se ha sostenido. Un objetivo sobre el p75 no vende.
      roas: { mediana: r2(cuantil(conMuestra.map((p) => p.roas), 0.5)), p25: r2(cuantil(conMuestra.map((p) => p.roas), 0.25)),
        p75: r2(cuantil(conMuestra.map((p) => p.roas), 0.75)), cuenta: gasto > 0 ? r2(venta / gasto) : null },
      acosCuenta: venta > 0 ? r2((gasto / venta) * 100) : null,
      // con sus cuantiles y el rango de precios donde se midió (planPublicidad)
      costoPorVenta: referenciaCosto(porProducto) ?? { mediana: null, min: null, max: null },
      cpcMediano: Math.round(cuantil(conMuestra.map((p) => p.cpc), 0.5) ?? 0) || null,
      conversionMediana: r2(cuantil(conMuestra.map((p) => p.conversion), 0.5)),
      ventasAdsPorDia: r2(cuantil(conMuestra.map((p) => p.ventasAdsPorDia), 0.5)),
      // envío real sobre la base de la tarifa, ponderado por unidades
      factorEnvio: conEnvio.length ? r2(conEnvio.reduce((a, p) => a + p.factorEnvio * p.unidadesAds, 0) / Math.max(1, conEnvio.reduce((a, p) => a + p.unidadesAds, 0))) : null,
      pctOrganico: unidades + organicas > 0 ? Math.round((organicas / (unidades + organicas)) * 100) : null,
      confianza: conMuestra.length >= 5 ? 'media' : conMuestra.length >= 3 ? 'baja' : 'insuficiente',
    },
    porProducto,
  }
}

// EL COSTO POR VENTA, NO EL ROAS, ES LO QUE PASA DE UN PRODUCTO A OTRO
// (21-oct-2026). El plan comparaba el ROAS que necesita el producto contra el
// que ML entregó en la cuenta: 2,37 de mediana, medido en productos de $3.392 a
// $4.990. Pero el ROAS lleva el precio adentro (venta / gasto), así que a la
// manguera de $13.990 le exigía lo mismo que a una brocha de $4.000 y la mandaba
// a "orgánico" con un empate de 3,6x. Lo que se repite entre productos es lo
// que cuesta cada venta por anuncio ($1.100-1.900 casi sin importar el precio,
// medido el 28-sep): a ese costo la manguera daría ~9x. Ahora se compara lo que
// una venta AGUANTA de publicidad contra lo que cuesta una venta por anuncio en
// la cuenta. Fuera del rango de precios medido la conversión puede ser otra
// —una manguera de $13.990 no convierte como una brocha de $4.000—, así que el
// plan es una prueba chica que mide la suya.
const FUERA_DEBAJO = 0.6
const FUERA_ENCIMA = 1.6
const plata = (x) => `${x < 0 ? '−' : ''}$${Math.abs(Math.round(x)).toLocaleString('es-CL')}`

// Pura. Cuánto cuesta una venta por anuncio en la cuenta (cuantiles de los
// anuncios con muestra) y en qué rango de precios se midió.
export function referenciaCosto(porProducto) {
  const con = (porProducto ?? []).filter((x) => x.unidadesAds >= MIN_UNIDADES_PRODUCTO && Number.isFinite(x.costoPorVenta))
  if (!con.length) return null
  const costos = con.map((x) => x.costoPorVenta)
  const precios = con.map((x) => x.precioPorVenta).filter(Number.isFinite)
  return {
    mediana: Math.round(cuantil(costos, 0.5)), p25: Math.round(cuantil(costos, 0.25)), p75: Math.round(cuantil(costos, 0.75)),
    min: Math.round(cuantil(costos, 0)), max: Math.round(cuantil(costos, 1)),
    precioDesde: precios.length ? Math.round(Math.min(...precios)) : null,
    precioHasta: precios.length ? Math.round(Math.max(...precios)) : null,
  }
}

// Pura. ¿El precio queda lejos de los productos donde se midió el costo por venta?
export function fueraDelRangoMedido(precio, ref) {
  if (!Number.isFinite(precio) || !(ref?.precioDesde > 0) || !(ref?.precioHasta > 0)) return false
  return precio < ref.precioDesde * FUERA_DEBAJO || precio > ref.precioHasta * FUERA_ENCIMA
}

// Pura. El plan de publicidad de un producto que todavía no se anuncia.
// costoUnitario null = no se sabe: el plan dice hasta cuánto puede costar.
export function planPublicidad({ precio, costoUnitario = null, comisionPct = null, envioTarifa = null, envioConocido = null }, p) {
  if (!Number.isFinite(precio) || precio <= 0 || !p?.roas?.mediana) return null
  const comision = Math.round(precio * ((Number.isFinite(comisionPct) ? comisionPct : 16) / 100))
  // el envío de un producto nuevo: su tarifa × lo que el real sube sobre la
  // tarifa en la cuenta; si ya se vendió, el suyo medido
  const envio = Number.isFinite(envioConocido) ? Math.round(envioConocido)
    : Number.isFinite(envioTarifa) ? Math.round(envioTarifa * (p.factorEnvio ?? 1)) : null
  const envioOrigen = Number.isFinite(envioConocido) ? 'medido' : Number.isFinite(envioTarifa) ? 'tarifa ajustada' : 'sin dato'
  const queda = precio - comision - (envio ?? 0)
  const costo = Number.isFinite(costoUnitario) ? costoUnitario : null
  // lo que cuesta una venta por anuncio en la cuenta; sin esa medida, lo que
  // implica el ROAS a este precio (la regla anterior)
  const ref = p.costoPorVenta?.mediana ? p.costoPorVenta : null
  const tipico = ref?.mediana ?? Math.round(precio / p.roas.mediana)
  const barato = ref ? (ref.p25 ?? ref.min ?? ref.mediana) : Math.round(precio / (p.roas.p75 ?? p.roas.mediana))
  const fuera = fueraDelRangoMedido(precio, ref)
  const medidoEn = ref?.precioDesde ? `productos de ${plata(ref.precioDesde)}-${plata(ref.precioHasta)}` : 'tus anuncios'
  // lo que el producto puede costar para que una venta por anuncio típica empate
  const costoMaximo = Math.round(queda - tipico)
  // lo que una venta aguanta de publicidad, y con 20% de aire lo que se le
  // deja pagar a ML; el ROAS objetivo de la campaña es ese mismo número
  const contribucion = costo != null ? queda - costo : null
  const roasEquilibrio = contribucion > 0 ? r2(precio / contribucion) : null
  const costoObjetivo = contribucion > 0 ? Math.round(contribucion / MARGEN_SOBRE_EQUILIBRIO) : null
  const roasObjetivo = roasEquilibrio != null ? Math.ceil(roasEquilibrio * MARGEN_SOBRE_EQUILIBRIO * 10) / 10 : null
  let veredicto, texto
  if (costo == null) {
    veredicto = costoMaximo <= 0 ? 'solo-organico' : 'depende-del-costo'
    texto = costoMaximo <= 0
      ? `Aunque el producto fuera gratis, una venta por anuncio (~${plata(tipico)} en tu cuenta) se come lo que deja`
      : `Conviene anunciar solo si el producto puesto en bodega cuesta menos de ${plata(costoMaximo)}`
  } else if (contribucion <= 0) {
    veredicto = 'no-cierra'; texto = 'No deja plata ni sin publicidad: revisar precio o costo'
  } else if (costoObjetivo < barato) {
    veredicto = 'solo-organico'
    texto = `Cada venta aguanta ${plata(contribucion)} de publicidad y en tu cuenta hasta las ventas por anuncio más baratas cuestan ~${plata(barato)}: vender orgánico`
  } else if (fuera) {
    veredicto = 'probar'
    texto = `Cada venta aguanta ${plata(contribucion)} de publicidad y en tu cuenta una venta por anuncio cuesta ~${plata(tipico)}, pero eso se midió en ${medidoEn}: a ${plata(precio)} la conversión puede ser otra. Prueba 14 días con ROAS objetivo ${roasObjetivo}x y mide la suya`
  } else if (costoObjetivo >= tipico) {
    veredicto = 'anunciar'
    texto = `Anunciar con ROAS objetivo ${roasObjetivo}x: cada venta aguanta ${plata(contribucion)} de publicidad y en tu cuenta una venta por anuncio cuesta ~${plata(tipico)}`
  } else {
    veredicto = 'anunciar-con-cuidado'
    texto = `Necesita ventas por anuncio de hasta ${plata(costoObjetivo)}: las más baratas de la cuenta (~${plata(barato)}) lo logran, la típica (~${plata(tipico)}) no; habrá menos volumen`
  }
  // presupuesto: lo que ML puede pagar por venta (la prueba, lo típico de la
  // cuenta) por las ventas por día que un anuncio suele traer, a $500
  const costoPorVenta = veredicto === 'probar' || costoObjetivo == null ? tipico : costoObjetivo
  const presupuestoDiario = ['anunciar', 'anunciar-con-cuidado', 'probar', 'depende-del-costo'].includes(veredicto)
    ? Math.max(1000, Math.ceil((costoPorVenta * Math.max(1, p.ventasAdsPorDia ?? 1)) / 500) * 500) : 0
  return {
    precio, comision, envio, envioOrigen, quedaTrasMl: queda, costoUnitario: costo, costoMaximo,
    roasEquilibrio, roasObjetivo, costoPorVentaEsperado: costoPorVenta,
    aguantaPorVenta: contribucion != null ? Math.round(contribucion) : null, costoObjetivo,
    referencia: ref ? { mediana: ref.mediana, barato, precioDesde: ref.precioDesde ?? null, precioHasta: ref.precioHasta ?? null } : null,
    fueraDelRangoMedido: fuera,
    presupuestoDiario, presupuestoPrueba14Dias: presupuestoDiario * 14,
    gananciaPorVentaAds: contribucion != null ? Math.round(contribucion - tipico) : null,
    veredicto, texto, confianza: p.confianza, aprendidoDe: p.productosConMuestra,
  }
}

// Una vez al día: todo lo que la cuenta gastó en anuncios, acumulado por
// producto, más el envío real cruzado orden a orden.
export async function actualizarAprendizajePublicidad({ ahora = new Date() } = {}) {
  // sin los días de evento comercial: los parámetros arman el plan de los
  // productos que vienen y tienen que describir un día normal
  const diasEventoAds = [...(await import('../eventosComerciales.js').then((m) => m.diasDeEvento()).catch(() => new Set()))]
  const filas = await AdsDiaMl.aggregate([
    { $match: { itemId: { $ne: '*' }, dia: { $nin: diasEventoAds } } },
    { $group: { _id: '$itemId', costo: { $sum: '$costo' }, clicks: { $sum: '$clicks' }, unidadesAds: { $sum: '$unidadesAds' },
      unidadesOrganicas: { $sum: '$unidadesOrganicas' }, ventaAds: { $sum: '$ventaAds' }, dias: { $sum: { $cond: [{ $gt: ['$costo', 0] }, 1, 0] } } } },
  ])
  const { envioRealPorItem } = await import('../cargosMl.js')
  const envio = await envioRealPorItem({ dias: 90 }).catch(() => new Map())
  const { ProductoPropio } = await import('../../models/ProductoPropio.js')
  const titulos = new Map((await ProductoPropio.find().select('itemIdMl sku titulo').lean()).map((p) => [p.itemIdMl ?? p.sku, p.titulo]))
  const { parametros, porProducto } = aprenderDeAnuncios(filas.map((f) => ({ ...f, itemId: f._id, titulo: titulos.get(f._id) ?? null })), envio)
  const dia = new Date(ahora).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
  let efecto = null
  try {
    efecto = await entrenarEfectoDesdeBase({ titulos, envio })
  } catch (err) {
    efecto = { estado: 'error', motivo: err.message }
  }
  let ticket = null
  try {
    ticket = await aprenderTicket({ envio })
    if (ticket?.minimo40 != null || ticket?.curva) {
      const { Aprendizaje } = await import('../../models/Aprendizaje.js')
      await Aprendizaje.findOneAndUpdate({ tipo: 'formato-gana', keyword: '__ticket-publicidad__' },
        { $set: { leccion: leccionTicket(ticket), evidencia: { medido: ticket.medido, minimo40: ticket.minimo40, minimo45: ticket.minimo45 }, actualizadoEl: ahora } }, { upsert: true })
    }
  } catch (err) {
    console.warn(`[ml-publicidad] economía por precio no calculada: ${err.message}`)
  }
  parametros.ticket = ticket
  // el costo por venta de cada nicho, cruzando los anuncios propios con las
  // señales de su nicho (ml/costoAdsNicho.js)
  try {
    const { actualizarCostoAdsNicho } = await import('./costoAdsNicho.js')
    await actualizarCostoAdsNicho({ ahora })
  } catch (err) {
    console.warn(`[ml-publicidad] costo por nicho no calculado: ${err.message}`)
  }
  await AprendizajePublicidad.updateOne({ dia }, { $set: { parametros, porProducto, efecto, calculadoEl: ahora } }, { upsert: true })
  cache = null
  console.log(`[ml-publicidad] ${parametros.productosConMuestra}/${parametros.productos} anuncios con muestra · ROAS mediana ${parametros.roas.mediana}x (p75 ${parametros.roas.p75}x) · venta por anuncio $${parametros.costoPorVenta.mediana} · envío real ${parametros.factorEnvio}× la base`)
  return { dia, parametros }
}

// Toda la historia: publicidad por producto y día (AdsDiaMl, día de Chile)
// contra el libro diario (DiaProductoMl, día UTC: hasta 4 horas de desfase,
// aceptable en series diarias). Después, el budget óptimo con la economía real.
async function entrenarEfectoDesdeBase({ titulos, envio }) {
  const { DiaProductoMl } = await import('../../models/DiaProductoMl.js')
  const { ajustarRidge, predecirRidge } = await import('./regresion.js')
  const ads = await AdsDiaMl.find({ itemId: { $ne: '*' } }).select('itemId dia costo unidadesAds').lean()
  const itemsConAds = [...new Set(ads.filter((a) => a.costo > 0).map((a) => a.itemId))]
  const libro = await DiaProductoMl.find({ itemId: { $in: itemsConAds } }).select('itemId dia unidades precio promo stockFraccion').lean()
  const adsPorDia = new Map(ads.map((a) => [`${a.itemId}|${a.dia}`, a]))
  // los días de evento comercial no entran: el CyberDay vende solo y el modelo
  // se lo atribuiría a la publicidad (services/eventosComerciales.js)
  const diasEvento = await import('../eventosComerciales.js').then((m) => m.diasDeEvento()).catch(() => new Set())
  const dias = libro.filter((d) => !diasEvento.has(d.dia)).map((d) => {
    const a = adsPorDia.get(`${d.itemId}|${d.dia}`)
    return { itemId: d.itemId, dia: d.dia, unidades: d.unidades, precio: d.precio, promo: d.promo, stockFraccion: d.stockFraccion, gasto: a?.costo ?? 0, unidadesAds: a?.unidadesAds ?? 0 }
  })
  const efecto = entrenarEfecto(dias, { ajustar: ajustarRidge, predecir: predecirRidge })
  if (!efecto.productos) return efecto
  // economía de cada producto: lo que deja una venta ANTES del costo de
  // mercadería (que no está cargado): precio mediano − comisión − envío real
  const { ProductoPropio } = await import('../../models/ProductoPropio.js')
  const { economiaUnidad } = await import('../economiaUnidad.js')
  const propios = new Map((await ProductoPropio.find({}).lean()).map((p) => [p.itemIdMl ?? p.sku, p]))
  for (const p of efecto.productos) {
    p.titulo = titulos.get(p.itemId) ?? null
    const precios = dias.filter((d) => d.itemId === p.itemId && d.precio > 0).map((d) => d.precio).sort((a, b) => a - b)
    const precio = precios[Math.floor(precios.length / 2)] ?? null
    const prop = propios.get(p.itemId)
    const env = envio.get(p.itemId)
    const eu = prop ? await economiaUnidad(prop, env ? { envioClp: env.cobrado, unidades: env.unidades } : null, { precio }).catch(() => null) : null
    const completa = eu && Number.isFinite(eu.costoClp) && Number.isFinite(eu.comisionClp) && Number.isFinite(eu.envioClp) && !eu.envioSupuesto
    p.precio = precio
    p.quedaTrasMl = eu && Number.isFinite(eu.comisionClp) && Number.isFinite(eu.envioClp) ? eu.quedaParaProductoClp : null
    p.costoUnitario = eu?.costoClp ?? null
    p.contribucion = completa ? eu.gananciaClp : null
    p.presupuestoOptimo = completa ? presupuestoOptimo({ beta: efecto.beta, media: p.ventasPorDia, contribucion: p.contribucion }) : null
    p.presupuestoEsTecho = !completa
    p.economiaVerificada = !!completa
  }
  return efecto
}

let cache = null
export async function parametrosPublicidad() {
  if (cache && Date.now() - cache.en < 30 * 60e3) return cache.valor
  const ultimo = await AprendizajePublicidad.findOne().sort({ dia: -1 }).lean()
  const valor = ultimo ? { ...ultimo.parametros, dia: ultimo.dia } : null
  // los guardados antes del 21-oct-2026 no traen los cuantiles ni el rango de
  // precios: salen de los mismos anuncios guardados en el día
  if (valor && valor.costoPorVenta?.p25 == null) {
    const ref = referenciaCosto(ultimo.porProducto)
    if (ref) valor.costoPorVenta = { ...valor.costoPorVenta, ...ref }
  }
  cache = { en: Date.now(), valor }
  return cache.valor
}

export async function estadoPublicidad() {
  const serie = await AprendizajePublicidad.find().sort({ dia: -1 }).limit(30).lean()
  if (!serie.length) return { vacio: true }
  // Los registros antiguos asumían mercadería gratis al calcular el óptimo.
  for (const p of serie[0].efecto?.productos ?? []) if (!p.economiaVerificada) {
    p.presupuestoOptimo = null; p.contribucion = null; p.presupuestoEsTecho = true
  }
  return { ultimo: { dia: serie[0].dia, parametros: serie[0].parametros, porProducto: serie[0].porProducto, efecto: serie[0].efecto ?? null },
    evolucion: serie.map((s) => ({ dia: s.dia, roasMediana: s.parametros.roas?.mediana, costoPorVenta: s.parametros.costoPorVenta?.mediana, factorEnvio: s.parametros.factorEnvio, productos: s.parametros.productosConMuestra })).reverse() }
}

// ─── EL EFECTO REAL DE LA PUBLICIDAD, APRENDIDO DE TODA LA HISTORIA ──────────
//
// Pedido del importador (28-sep-2026): "necesito que tome la data de todo el
// tiempo corriendo publicidad sin que el learning machine aprenda". ML dice
// cuántas ventas le atribuye al anuncio, pero parte de esas iban a llegar
// solas. Esto cruza, producto por producto y día por día, lo gastado en
// anuncios con las VENTAS TOTALES del libro diario, controlando precio,
// promoción, días sin stock y la tendencia de cada producto (que madura sola
// mientras la publicidad sube: sin la tendencia, todo se lo lleva el anuncio).
//
// Modelo: ventas del día / promedio del producto = efecto del producto +
// tendencia del producto + β·log(1 + gasto/1000) + precio + promo. El log hace
// que cada peso extra venda menos que el anterior, y de ahí sale el budget
// óptimo: el gasto donde la siguiente venta cuesta lo mismo que lo que deja.
// Se valida con los últimos días, que el modelo no ve al entrenar.

const MIN_DIAS_PRODUCTO = 20
const FRACCION_PRUEBA = 0.25

const logGasto = (g) => Math.log1p(Math.max(0, g) / 1000)

// Pura. dias: { itemId, dia, unidades, gasto, precio, promo, stockFraccion, unidadesAds }
export function filasEfecto(dias) {
  const porItem = new Map()
  for (const d of dias) {
    if (d.stockFraccion != null && d.stockFraccion < 0.5) continue // sin stock no vende, con o sin anuncio
    porItem.set(d.itemId, [...(porItem.get(d.itemId) ?? []), d])
  }
  const items = []
  for (const [itemId, ds] of porItem) {
    const o = ds.sort((a, b) => a.dia.localeCompare(b.dia))
    // desde el primer día con venta o anuncio: antes el producto no existía
    const inicio = o.findIndex((d) => d.unidades > 0 || d.gasto > 0)
    if (inicio < 0) continue
    const vivos = o.slice(inicio)
    if (vivos.length < MIN_DIAS_PRODUCTO || !vivos.some((d) => d.gasto > 0)) continue
    const precios = vivos.map((d) => d.precio).filter((p) => p > 0).sort((a, b) => a - b)
    items.push({ itemId, dias: vivos, precioMediano: precios[Math.floor(precios.length / 2)] ?? null })
  }
  return items
}

function disenar(items, { conAds = true, medias }) {
  const ids = items.map((i) => i.itemId)
  const filas = []
  for (const it of items) {
    const t0 = +new Date(it.dias[0].dia)
    const media = medias.get(it.itemId)
    if (!(media > 0)) continue
    for (const d of it.dias) {
      const tendencia = (+new Date(d.dia) - t0) / (30 * 86400e3)
      const xs = [
        ...(conAds ? [logGasto(d.gasto)] : []),
        d.precio > 0 && it.precioMediano ? Math.log(d.precio / it.precioMediano) : 0,
        d.promo ? 1 : 0,
        ...ids.map((id) => (id === it.itemId ? 1 : 0)),
        ...ids.map((id) => (id === it.itemId ? tendencia : 0)),
      ]
      filas.push({ xs, y: d.unidades / media, grupo: it.itemId, fin: 0, itemId: it.itemId, dia: d.dia, media, unidades: d.unidades, gasto: d.gasto, unidadesAds: d.unidadesAds ?? 0 })
    }
  }
  return filas
}

const coefCrudo = (m, j) => m.coeficientes[j + 1] / m.escalas[j]

// Pura. Entrena con toda la historia, valida con los últimos días y estima el
// efecto por producto. El ajuste lo recibe hecho (ridge) para poder probarlo.
export function entrenarEfecto(dias, opciones = {}) {
  // TRES LECTURAS DEL MISMO EFECTO. El stock diario se mide desde el 1-sep; antes,
  // un día sin gasto puede ser un día con el producto pausado o quebrado (ML
  // detiene el anuncio sin stock), y el modelo le cargaría a "apagar la
  // publicidad" una caída que fue "no había producto". Por eso:
  //   todos         — toda la historia
  //   stockConocido — solo días con stock medido: sin la trampa, menos datos
  //   soloConGasto  — solo días con anuncio encendido: gasto alto contra bajo,
  //                   nunca confunde quiebre con publicidad apagada
  // Si coinciden, el efecto es real. El principal es la lectura más limpia
  // que tenga datos suficientes.
  const variantes = {
    todos: dias,
    stockConocido: dias.filter((d) => d.stockFraccion != null),
    soloConGasto: dias.filter((d) => d.gasto > 0),
  }
  const lecturas = {}
  for (const [k, ds] of Object.entries(variantes)) {
    const r = ajustarEfecto(ds, { ...opciones, remuestreos: k === 'todos' ? 0 : opciones.remuestreos })
    lecturas[k] = r
  }
  // la primera lectura LIMPIA que tenga datos y valide (predice mejor los días
  // que no vio); toda la historia solo si ninguna limpia alcanza. Medido el
  // 28-sep: toda la historia daba β 1,00 y las dos limpias 0,75 — el quiebre
  // de stock inflaba el efecto un tercio.
  const sirve = (r) => r.filas >= 150 && r.productosEntrenados >= 3 && (r.validacion?.mejoraPct ?? -1) > 0
  const principal = sirve(lecturas.stockConocido) ? 'stockConocido' : sirve(lecturas.soloConGasto) ? 'soloConGasto' : 'todos'
  const elegido = ajustarEfecto(variantes[principal], opciones)
  const betas = Object.entries(lecturas).filter(([, r]) => r.beta != null).map(([k, r]) => ({ lectura: k, beta: r.beta, filas: r.filas, productos: r.productosEntrenados, mejoraPct: r.validacion?.mejoraPct ?? null }))
  const positivas = betas.filter((b) => b.beta > 0)
  const rango = positivas.length ? Math.max(...positivas.map((b) => b.beta)) / Math.min(...positivas.map((b) => b.beta)) : null
  return {
    ...elegido,
    lectura: principal,
    robustez: {
      lecturas: betas,
      // las tres dicen lo mismo si todas son positivas y la mayor no pasa el doble de la menor
      coinciden: betas.length === 3 && positivas.length === 3 && rango <= 2,
      nota: { todos: 'ninguna lectura limpia alcanza todavía: el principal usa toda la historia y puede estar inflado por días sin stock',
        stockConocido: 'el principal usa solo días con stock medido', soloConGasto: 'el principal compara días de gasto alto contra gasto bajo: no confunde quiebre de stock con publicidad apagada' }[principal],
    },
  }
}

function ajustarEfecto(dias, { ajustar, predecir, remuestreos = 200, semilla = 7 } = {}) {
  const items = filasEfecto(dias)
  if (items.length < 2) return { estado: 'sin-datos', motivo: 'menos de 2 productos con 20+ días y publicidad' }
  const todosDias = [...new Set(items.flatMap((i) => i.dias.map((d) => d.dia)))].sort()
  const corte = todosDias[Math.floor(todosDias.length * (1 - FRACCION_PRUEBA))]
  const mediasDe = (filtro) => new Map(items.map((i) => {
    const ds = i.dias.filter(filtro)
    return [i.itemId, ds.length ? ds.reduce((a, d) => a + d.unidades, 0) / ds.length : 0]
  }))
  // VALIDACIÓN: entrenar hasta el corte, predecir después, con y sin publicidad
  const mediasEntreno = mediasDe((d) => d.dia < corte)
  const error = (conAds) => {
    const f = disenar(items, { conAds, medias: mediasEntreno })
    const entreno = f.filter((x) => x.dia < corte), prueba = f.filter((x) => x.dia >= corte)
    if (entreno.length < 30 || prueba.length < 10) return null
    const m = ajustar(entreno, { lambda: 1 })
    return prueba.reduce((a, x) => a + Math.abs(predecir(m, x.xs) * x.media - x.unidades), 0) / prueba.length
  }
  const errorCon = error(true), errorSin = error(false)

  // EL MODELO: toda la historia
  const medias = mediasDe(() => true)
  const filas = disenar(items, { conAds: true, medias })
  const modelo = ajustar(filas, { lambda: 1 })
  const beta = coefCrudo(modelo, 0)
  // incertidumbre: remuestreo por DÍAS (un día malo mueve a todos los productos)
  let s = semilla
  const azar = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const porDia = new Map()
  for (const f of filas) porDia.set(f.dia, [...(porDia.get(f.dia) ?? []), f])
  const listaDias = [...porDia.keys()]
  const betas = []
  for (let r = 0; r < remuestreos; r++) {
    const muestra = []
    for (let k = 0; k < listaDias.length; k++) muestra.push(...porDia.get(listaDias[Math.floor(azar() * listaDias.length)]))
    try { betas.push(coefCrudo(ajustar(muestra, { lambda: 1 }), 0)) } catch { /* muestra degenerada */ }
  }
  betas.sort((a, b) => a - b)
  const q = (p) => betas[Math.floor(p * (betas.length - 1))] ?? null

  // por producto: ventas que el modelo le da a la publicidad contra las que ML
  // le atribuye. Lo incremental es β·media·log(1+gasto/1000) de cada día.
  const productos = items.map((it) => {
    const media = medias.get(it.itemId)
    const conGasto = it.dias.filter((d) => d.gasto > 0)
    const gasto = conGasto.reduce((a, d) => a + d.gasto, 0)
    const incrementales = it.dias.reduce((a, d) => a + beta * media * logGasto(d.gasto), 0)
    const atribuidas = it.dias.reduce((a, d) => a + (d.unidadesAds ?? 0), 0)
    const gastoDiario = conGasto.length ? gasto / conGasto.length : 0
    return {
      itemId: it.itemId, dias: it.dias.length, diasConGasto: conGasto.length, ventasPorDia: r2(media),
      gasto: Math.round(gasto), gastoDiarioPromedio: Math.round(gastoDiario),
      ventasAtribuidasMl: atribuidas, ventasIncrementales: Math.round(incrementales * 10) / 10,
      // cuánto costó de verdad cada venta que la publicidad agregó
      costoPorVentaIncremental: incrementales > 0.5 ? Math.round(gasto / incrementales) : null,
      // lo que cuesta la PRÓXIMA venta al gasto diario de hoy: con el log, es
      // (1000 + gasto) / (β · media)
      costoVentaMarginal: beta > 0 && media > 0 ? Math.round((1000 + gastoDiario) / (beta * media)) : null,
      // el gasto diario donde la próxima venta cuesta exactamente `c` (lo que
      // deja la venta): se rellena afuera con la economía del producto
      beta, media,
    }
  })
  const incrementalesTotal = productos.reduce((a, p) => a + p.ventasIncrementales, 0)
  const atribuidasTotal = productos.reduce((a, p) => a + p.ventasAtribuidasMl, 0)
  const mejora = errorCon != null && errorSin != null ? Math.round((1 - errorCon / errorSin) * 1000) / 10 : null
  const estado = beta <= 0 || (q(0.1) ?? 0) <= 0 ? 'efecto-incierto' : mejora != null && mejora <= 0 ? 'no-predice-mejor' : 'aprendido'
  return {
    estado,
    productos: productos.map(({ beta: _b, media: _m, ...resto }) => resto),
    beta: r2(beta * 1000) / 1000, betaP10: q(0.1) != null ? Math.round(q(0.1) * 1000) / 1000 : null, betaP90: q(0.9) != null ? Math.round(q(0.9) * 1000) / 1000 : null,
    // ventas que la publicidad trajo de verdad por cada una que ML se atribuye
    incrementalidad: atribuidasTotal > 0 ? r2(incrementalesTotal / atribuidasTotal) : null,
    ventasIncrementales: Math.round(incrementalesTotal), ventasAtribuidasMl: atribuidasTotal,
    validacion: { corte, errorConPublicidad: r2(errorCon), errorSinPublicidad: r2(errorSin), mejoraPct: mejora },
    filas: filas.length, productosEntrenados: items.length, dias: todosDias.length, desde: todosDias[0], hasta: todosDias.at(-1),
  }
}

// Pura. Budget óptimo: el gasto diario donde la próxima venta por anuncio
// cuesta lo mismo que deja (contribución). Con el log: S* = β·media·c − 1000.
export function presupuestoOptimo({ beta, media, contribucion }) {
  if (!(beta > 0) || !(media > 0) || !(contribucion > 0)) return 0
  return Math.max(0, Math.round((beta * media * contribucion - 1000) / 100) * 100)
}

// ─── CUÁNTO DEJA UN PRODUCTO SEGÚN SU PRECIO ────────────────────────────────
//
// El importador, 28-sep-2026: "los productos que valen bajo $9.990 en
// realidad no dejan mucho, se lo comen más si la publicidad está puesta". Lo
// medido le da la razón y dice por qué: la comisión (~17%) y la publicidad
// (~29% de lo vendido: el ROAS objetivo la fija como porcentaje) se llevan
// una PARTE del precio, pero el envío es casi FIJO (~$830). En $4.000 el envío
// es otro 21%; en $10.000, un 8%. Así que lo que queda para pagar el producto
// y ganar sube con el ticket, y bajo cierto precio no alcanza.
//
// Se mide cada día con las ventas reales de 30 días y se guarda como lección:
// el radar y el analista la leen al elegir qué traer.

// Pura. filas: por producto { precio, comision, envio, adsPorVenta, unidades }
export function medirTicket(filas) {
  const ok = filas.filter((f) => f.unidades >= 3 && f.precio > 0)
  if (ok.length < 2) return null
  const u = ok.reduce((a, f) => a + f.unidades, 0)
  const venta = ok.reduce((a, f) => a + f.precio * f.unidades, 0)
  return {
    productos: ok.length, unidades: u,
    comisionPct: r2((ok.reduce((a, f) => a + f.comision * f.unidades, 0) / venta) * 100),
    // la publicidad como parte de lo vendido (todas las ventas, no solo las
    // atribuidas: el gasto se paga sobre el total)
    publicidadPct: r2((ok.reduce((a, f) => a + f.adsPorVenta * f.unidades, 0) / venta) * 100),
    envioMedio: Math.round(ok.reduce((a, f) => a + f.envio * f.unidades, 0) / u),
    filas: ok.map((f) => ({ ...f, quedaConAds: Math.round(f.precio - f.comision - f.envio - f.adsPorVenta), quedaSinAds: Math.round(f.precio - f.comision - f.envio),
      pctConAds: Math.round(((f.precio - f.comision - f.envio - f.adsPorVenta) / f.precio) * 100) })),
  }
}

// Pura. La curva por precio con lo medido; `envioDe(precio)` es el envío que
// pagaría el vendedor a ese precio (la tarifa cambia en $9.990 y $19.990).
export function curvaTicket(medido, precios, envioDe) {
  if (!medido) return null
  const curva = precios.map((p) => {
    const envio = envioDe(p) ?? medido.envioMedio
    const sinAds = p * (1 - medido.comisionPct / 100) - envio
    const conAds = sinAds - p * (medido.publicidadPct / 100)
    return { precio: p, envio: Math.round(envio), quedaSinAds: Math.round(sinAds), quedaConAds: Math.round(conAds),
      pctSinAds: Math.round((sinAds / p) * 100), pctConAds: Math.round((conAds / p) * 100) }
  })
  // el primer precio desde el cual, CON publicidad, queda al menos ese %
  const desde = (pct) => curva.find((c) => c.pctConAds >= pct)?.precio ?? null
  // LOS VALLES: tramos sobre el mínimo donde el envío salta y vuelve a dejar
  // poco. Medido el 28-sep: desde $19.990 el envío gratis es obligatorio y el
  // vendedor paga ~$3.064 en vez de $803; de $19.990 a ~$24.990 queda 37-40%.
  const min40 = desde(40)
  const valles = []
  for (const c of curva) {
    if (min40 == null || c.precio <= min40 || c.pctConAds >= 40) continue
    const ultimo = valles.at(-1)
    if (ultimo && curva.find((x) => x.precio > ultimo.hasta && x.precio < c.precio && x.pctConAds >= 40) == null) ultimo.hasta = c.precio
    else valles.push({ desde: c.precio, hasta: c.precio })
  }
  // un valle llega hasta justo antes del siguiente precio que vuelve al 40%
  // (la curva es de puntos: $21.990 cae entre $19.990 y $24.990)
  for (const v of valles) {
    const sale = curva.find((x) => x.precio > v.hasta && x.pctConAds >= 40)
    v.hasta = sale ? sale.precio - 1 : Infinity
  }
  return { curva, minimo35: desde(35), minimo40: min40, minimo45: desde(45), valles }
}

// Pura. Lo que queda a un precio, leyendo la curva (el punto más cercano por abajo).
export function dejaAPrecio(ticket, precio) {
  if (!ticket?.curva?.length || !Number.isFinite(precio) || precio <= 0) return null
  const punto = [...ticket.curva].reverse().find((c) => c.precio <= precio) ?? ticket.curva[0]
  const medido = ticket.medido
  const envio = punto.envio
  const sinAds = precio * (1 - medido.comisionPct / 100) - envio
  const conAds = sinAds - precio * (medido.publicidadPct / 100)
  const pctConAds = Math.round((conAds / precio) * 100)
  // se juzga A SU PRECIO: un nicho de $12.990 deja 45% aunque $19.990 sea un valle
  return { precio, quedaConAds: Math.round(conAds), pctConAds, quedaSinAds: Math.round(sinAds), pctSinAds: Math.round((sinAds / precio) * 100),
    bajo: pctConAds < 40, enValle: (ticket.valles ?? []).some((v) => precio >= v.desde && precio <= v.hasta) }
}

const PRECIOS_CURVA = [2990, 3990, 4990, 5990, 6990, 7990, 8990, 9980, 9990, 11990, 13990, 15990, 17990, 19980, 19990, 24990, 29990, 39990]

async function aprenderTicket({ envio }) {
  const { ProductoPropio } = await import('../../models/ProductoPropio.js')
  const { ventasPorItem } = await import('../ventasMl.js')
  const { comisionMlExacta } = await import('../comisionesMl.js')
  const { costoEnvioFull } = await import('../envioFull.js')
  // la economía de un día NORMAL: los días de evento comercial no entran (el
  // CyberDay de octubre bajó la publicidad de ~35% a 28% de lo vendido y el
  // mínimo para quedar con 40% de $9.980 a $5.990, que el radar usa como piso)
  const diasEvento = [...(await import('../eventosComerciales.js').then((m) => m.diasDeEvento()).catch(() => new Set()))]
  const ventas = await ventasPorItem({ dias: 30, excluirDias: diasEvento })
  // la comisión que ML FACTURÓ por item (las publicaciones propias son
  // Premium, 17%; el tarifario sin tipo devolvía la Clásica, 13%)
  const { cargosPorItem } = await import('../cargosMl.js')
  const cargos = await cargosPorItem({ dias: 30, excluirDias: diasEvento }).catch(() => new Map())
  const desde = new Date(Date.now() - 30 * DIA).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
  const gasto = new Map((await AdsDiaMl.aggregate([{ $match: { itemId: { $ne: '*' }, dia: { $gte: desde, $nin: diasEvento } } }, { $group: { _id: '$itemId', costo: { $sum: '$costo' } } }])).map((g) => [g._id, g.costo]))
  const filas = []
  for (const p of await ProductoPropio.find().select('itemIdMl sku titulo categoriaMl').lean()) {
    const id = p.itemIdMl ?? p.sku
    const v = ventas.get(id)
    if (!(v?.unidades > 0)) continue
    const precio = Math.round(v.ingresosClp / v.unidades)
    const facturada = cargos.get(id)?.comisionClp
    let comision
    if (facturada > 0 && v.ingresosClp > 0) comision = Math.round((facturada / v.ingresosClp) * precio)
    else {
      const com = await comisionMlExacta({ precioClp: precio, categoriaId: p.categoriaMl ?? null, tipoPublicacion: 'gold_pro' }).catch(() => null)
      comision = Number.isFinite(com?.pct) ? Math.round((com.pct / 100) * precio + (com.cargoFijoClp ?? 0)) : Math.round(precio * 0.17)
    }
    const env = envio.get(id)?.porUnidad
    if (!Number.isFinite(env)) continue
    filas.push({ itemId: id, titulo: p.titulo ?? null, precio, comision, envio: env, adsPorVenta: Math.round((gasto.get(id) ?? 0) / v.unidades), unidades: v.unidades })
  }
  const medido = medirTicket(filas)
  if (!medido) return null
  // lo que el envío real sube sobre la tarifa (hoy ~1: lo del comprador ya no se cuenta)
  const tarifas = new Map()
  for (const precio of PRECIOS_CURVA) tarifas.set(precio, (await costoEnvioFull({ precioClp: precio }).catch(() => null))?.clp ?? null)
  const tarifaMedia = filas.reduce((a, f) => a + (tarifas.get(PRECIOS_CURVA.filter((x) => x <= f.precio).at(-1) ?? PRECIOS_CURVA[0]) ?? f.envio) * f.unidades, 0) / medido.unidades
  const factor = tarifaMedia > 0 ? medido.envioMedio / tarifaMedia : 1
  const c = curvaTicket(medido, PRECIOS_CURVA, (p) => (tarifas.get(p) != null ? tarifas.get(p) * factor : null))
  return { medido: { ...medido, factorEnvio: r2(factor) }, ...c }
}

function leccionTicket(t) {
  const m = t.medido
  const punto = (p) => t.curva.find((c) => c.precio === p)
  const ej = [3990, 5990, 9990, 19990].map(punto).filter(Boolean)
  return `ECONOMÍA POR PRECIO MEDIDA en mis ventas reales (${m.unidades} ventas de ${m.productos} productos, 30 días): ML cobra ${String(m.comisionPct).replace('.', ',')}% de comisión, `
    + `la publicidad cuesta ${String(m.publicidadPct).replace('.', ',')}% de lo vendido y el envío que pago es casi fijo (~$${m.envioMedio.toLocaleString('es-CL')} por venta). `
    + `Por eso lo que queda para pagar el producto y ganar, CON publicidad, depende del precio: ${ej.map((c) => `$${c.precio.toLocaleString('es-CL')} → ${c.pctConAds}% ($${c.quedaConAds.toLocaleString('es-CL')})`).join('; ')}. `
    + (t.minimo40 ? `Bajo $${t.minimo40.toLocaleString('es-CL')} queda menos del 40% del precio: un producto de ticket bajo que necesite publicidad para vender deja muy poco. ` : '')
    + (t.valles?.length ? `Ojo con ${t.valles.map((v) => (Number.isFinite(v.hasta) ? `$${v.desde.toLocaleString('es-CL')}-$${v.hasta.toLocaleString('es-CL')}` : `$${v.desde.toLocaleString('es-CL')} en adelante`)).join(' y ')}: ahí el envío gratis obligatorio sube lo que pago por envío y vuelve a quedar menos del 40%; conviene quedarse justo bajo el salto o bien por encima. ` : '')
    + `Prefiere tickets que dejen al menos 40% con publicidad; un ticket bajo solo se justifica si vende orgánico, sin anuncios.`
}
