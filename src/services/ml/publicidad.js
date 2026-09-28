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
      costoPorVenta: { mediana: Math.round(cuantil(conMuestra.map((p) => p.costoPorVenta), 0.5) ?? 0) || null,
        min: Math.round(cuantil(conMuestra.map((p) => p.costoPorVenta), 0) ?? 0) || null, max: Math.round(cuantil(conMuestra.map((p) => p.costoPorVenta), 1) ?? 0) || null },
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
  // lo que el producto puede costar para que una venta por anuncio empate,
  // con el ROAS que ML suele entregar
  const costoMaximo = Math.round(queda - precio / p.roas.mediana)
  const contribucion = costo != null ? queda - costo : null
  const roasEquilibrio = contribucion != null ? (contribucion > 0 ? r2(precio / contribucion) : null) : null
  const roasObjetivo = roasEquilibrio != null ? Math.ceil(roasEquilibrio * MARGEN_SOBRE_EQUILIBRIO * 10) / 10 : null
  let veredicto, texto
  if (costo == null) {
    veredicto = costoMaximo <= 0 ? 'solo-organico' : 'depende-del-costo'
    texto = costoMaximo <= 0
      ? `Aunque el producto fuera gratis, con el ROAS que entrega ML (${p.roas.mediana}x) cada venta por anuncio pierde`
      : `Conviene anunciar solo si el producto puesto en bodega cuesta menos de $${costoMaximo.toLocaleString('es-CL')}`
  } else if (contribucion <= 0) {
    veredicto = 'no-cierra'; texto = 'No deja plata ni sin publicidad: revisar precio o costo'
  } else if (roasObjetivo <= p.roas.mediana) {
    veredicto = 'anunciar'; texto = `Anunciar con ROAS objetivo ${roasObjetivo}x: ML lo entrega normalmente (mediana ${p.roas.mediana}x)`
  } else if (roasObjetivo <= (p.roas.p75 ?? p.roas.mediana)) {
    veredicto = 'anunciar-con-cuidado'; texto = `Necesita ROAS ${roasObjetivo}x: se ha logrado, pero con menos volumen`
  } else {
    veredicto = 'solo-organico'; texto = `Necesitaría ROAS ${roasObjetivo}x y ML no ha sostenido más de ${p.roas.p75 ?? p.roas.mediana}x: vender orgánico`
  }
  // presupuesto: lo que cuesta la venta por anuncio al objetivo, por las
  // ventas por día que un anuncio suele traer, redondeado a $500
  const roasParaPresupuesto = roasObjetivo ?? p.roas.mediana
  const costoPorVenta = Math.round(precio / roasParaPresupuesto)
  const presupuestoDiario = ['anunciar', 'anunciar-con-cuidado', 'depende-del-costo'].includes(veredicto)
    ? Math.max(1000, Math.ceil((costoPorVenta * Math.max(1, p.ventasAdsPorDia ?? 1)) / 500) * 500) : 0
  return {
    precio, comision, envio, envioOrigen, quedaTrasMl: queda, costoUnitario: costo, costoMaximo,
    roasEquilibrio, roasObjetivo, costoPorVentaEsperado: costoPorVenta,
    presupuestoDiario, presupuestoPrueba14Dias: presupuestoDiario * 14,
    gananciaPorVentaAds: contribucion != null ? Math.round(contribucion - costoPorVenta) : null,
    veredicto, texto, confianza: p.confianza, aprendidoDe: p.productosConMuestra,
  }
}

// Una vez al día: todo lo que la cuenta gastó en anuncios, acumulado por
// producto, más el envío real cruzado orden a orden.
export async function actualizarAprendizajePublicidad({ ahora = new Date() } = {}) {
  const filas = await AdsDiaMl.aggregate([
    { $match: { itemId: { $ne: '*' } } },
    { $group: { _id: '$itemId', costo: { $sum: '$costo' }, clicks: { $sum: '$clicks' }, unidadesAds: { $sum: '$unidadesAds' },
      unidadesOrganicas: { $sum: '$unidadesOrganicas' }, ventaAds: { $sum: '$ventaAds' }, dias: { $sum: { $cond: [{ $gt: ['$costo', 0] }, 1, 0] } } } },
  ])
  const { envioRealPorItem } = await import('../cargosMl.js')
  const envio = await envioRealPorItem({ dias: 90 }).catch(() => new Map())
  const { ProductoPropio } = await import('../../models/ProductoPropio.js')
  const titulos = new Map((await ProductoPropio.find().select('itemIdMl sku titulo').lean()).map((p) => [p.itemIdMl ?? p.sku, p.titulo]))
  const { parametros, porProducto } = aprenderDeAnuncios(filas.map((f) => ({ ...f, itemId: f._id, titulo: titulos.get(f._id) ?? null })), envio)
  const dia = new Date(ahora).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })
  await AprendizajePublicidad.updateOne({ dia }, { $set: { parametros, porProducto, calculadoEl: ahora } }, { upsert: true })
  cache = null
  console.log(`[ml-publicidad] ${parametros.productosConMuestra}/${parametros.productos} anuncios con muestra · ROAS mediana ${parametros.roas.mediana}x (p75 ${parametros.roas.p75}x) · venta por anuncio $${parametros.costoPorVenta.mediana} · envío real ${parametros.factorEnvio}× la base`)
  return { dia, parametros }
}

let cache = null
export async function parametrosPublicidad() {
  if (cache && Date.now() - cache.en < 30 * 60e3) return cache.valor
  const ultimo = await AprendizajePublicidad.findOne().sort({ dia: -1 }).lean()
  cache = { en: Date.now(), valor: ultimo ? { ...ultimo.parametros, dia: ultimo.dia } : null }
  return cache.valor
}

export async function estadoPublicidad() {
  const serie = await AprendizajePublicidad.find().sort({ dia: -1 }).limit(30).lean()
  if (!serie.length) return { vacio: true }
  return { ultimo: { dia: serie[0].dia, parametros: serie[0].parametros, porProducto: serie[0].porProducto },
    evolucion: serie.map((s) => ({ dia: s.dia, roasMediana: s.parametros.roas?.mediana, costoPorVenta: s.parametros.costoPorVenta?.mediana, factorEnvio: s.parametros.factorEnvio, productos: s.parametros.productosConMuestra })).reverse() }
}
