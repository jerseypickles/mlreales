import { CapturaNichoMl } from '../../models/CapturaNichoMl.js'
import { SerieNichoMl } from '../../models/SerieNichoMl.js'
import { ObservacionProductoMl } from '../../models/ObservacionProductoMl.js'
import { CurvaEstacional } from '../../models/CurvaEstacional.js'
import { huellaDe } from './registro.js'
import { productosUnicos, unirFuentes, construirContexto } from './contexto.js'
import { ventanasIndependientes } from './comercial.js'
import { config } from '../../config/env.js'

async function guardar(dato, ahora) {
  const huella = huellaDe(dato)
  return CapturaNichoMl.findOneAndUpdate({ huella }, { $setOnInsert: { ...dato, huella, capturadoEl: ahora } }, { upsert: true, new: true }).lean()
}

export async function registrarListadoNichoMl({ nicho, items, fecha, fuente, ahora = new Date() }) {
  if (!config.mlActivo || fuente !== 'zyte' || nicho.domainCode && nicho.domainCode !== 'CL') return null
  if (!Number.isFinite(+new Date(fecha)) || +new Date(fecha) > +ahora) return null
  const productos = productosUnicos(items.map(({ producto: p, snapshot: s }) => ({
    sku: p.sku, itemId: p.itemId ?? null, catalogId: p.catalogId ?? null,
    tipoListing: p.tipoListing, posicion: s.posicion, precio: s.precio,
    esFull: p.esFull ?? null, resenasZyte: s.numReviews ?? null,
    // Solo auditoría; el modelo no trata el bucket público como ventas exactas.
    vendidosPublicos: s.vendidos ?? null,
  })))
  if (!productos.length) return null
  const curva = await CurvaEstacional.findOne({ keyword: nicho.keyword }).select('keywordMedida').lean()
  return guardar({ nichoId: nicho._id, keyword: nicho.keyword,
    keywordDemanda: curva?.keywordMedida || nicho.keyword, fuente, fase: 'listado', fechaScan: fecha, productos }, ahora)
}

export async function registrarDetalleNichoMl({ nichoId, porSku, fecha, fuente, ahora = new Date() }) {
  if (!config.mlActivo || fuente !== 'zyte' || !porSku?.size) return null
  const anterior = await CapturaNichoMl.findOne({ nichoId, fechaScan: fecha, capturadoEl: { $lte: ahora } }).sort({ capturadoEl: -1, _id: -1 }).lean()
  if (!anterior) return null // No reconstruir un listado viejo desde Producto mutable.
  const productos = anterior.productos.map((p) => {
    const d = porSku.get(p.sku)
    if (!d) return p
    return { ...p,
      ...(Number.isFinite(d.precio) && d.precio > 0 ? { precio: d.precio } : {}),
      ...(typeof d.esFull === 'boolean' ? { esFull: d.esFull } : {}),
      ...(Number.isFinite(d.numReviews) && d.numReviews >= 0 ? { resenasZyte: d.numReviews } : {}),
    }
  })
  return guardar({ nichoId: anterior.nichoId, keyword: anterior.keyword, keywordDemanda: anterior.keywordDemanda,
    fuente, fase: 'detalle', fechaScan: anterior.fechaScan, productos }, ahora)
}

export async function datosConContexto({ observaciones, ahora = new Date() } = {}) {
  const datos = ventanasIndependientes(observaciones ?? await ObservacionProductoMl.find({ hasta: {
    $gte: new Date(+ahora - 730 * 86400e3), $lte: ahora,
  } }).lean())
  const ids = [...new Set(datos.filter((o) => o.nichoId).map((o) => String(o.nichoId)))]
  if (!ids.length) return unirFuentes(datos, [], [])
  const primera = new Date(Math.min(...datos.map((o) => +new Date(o.desde))) - 14 * 86400e3)
  const capturas = await CapturaNichoMl.find({ nichoId: { $in: ids }, fuente: 'zyte', fechaScan: { $gte: primera }, capturadoEl: { $lte: ahora } }).lean()
  const keywords = [...new Set(capturas.map((c) => c.keywordDemanda))]
  const series = await SerieNichoMl.find({ keyword: { $in: keywords }, pais: 2152, idioma: 'es', fuente: 'google-ads', capturadoEl: { $lte: ahora } }).lean()
  return unirFuentes(datos, capturas, series)
}

export async function contextoActual({ nichoId, precio, itemId, ahora = new Date() }) {
  const captura = await CapturaNichoMl.findOne({ nichoId, fuente: 'zyte', capturadoEl: { $lte: ahora } }).sort({ capturadoEl: -1, _id: -1 }).lean()
  const serie = captura ? await SerieNichoMl.findOne({ keyword: captura.keywordDemanda, pais: 2152, idioma: 'es', fuente: 'google-ads',
    capturadoEl: { $lte: ahora } }).sort({ capturadoEl: -1, _id: -1 }).lean() : null
  return construirContexto({ captura, serie, desde: ahora, itemId, precio })
}

export async function estadoIntegracion({ ahora = new Date() } = {}) {
  const [ultimas, unidas] = await Promise.all([
    CapturaNichoMl.aggregate([{ $match: { fuente: 'zyte', capturadoEl: { $lte: ahora } } },
      { $sort: { capturadoEl: -1, _id: -1 } }, { $group: { _id: '$nichoId', captura: { $first: '$$ROOT' } } }]),
    datosConContexto({ ahora }),
  ])
  return { fuente: 'zyte', nichosCapturados: ultimas.length,
    ventanasCandidatas: unidas.ventanasCandidatas, ventanasUnidas: unidas.datos.length,
    productosUnidos: new Set(unidas.datos.map((d) => d.itemId)).size,
    nichosUnidos: new Set(unidas.datos.map((d) => d.contexto.nichoId)).size, omitidas: unidas.omitidas,
    nichos: ultimas.map(({ captura: c }) => ({ nichoId: c.nichoId, keyword: c.keyword, keywordDemanda: c.keywordDemanda,
      fase: c.fase, capturadoEl: c.capturadoEl, fechaScan: c.fechaScan, productos: c.productos.length,
      reciente: +ahora - +new Date(c.fechaScan) <= 14 * 86400e3,
      ventanasUnidas: unidas.datos.filter((d) => d.contexto.nichoId === String(c.nichoId)).length,
    })).sort((a, b) => +new Date(b.capturadoEl) - +new Date(a.capturadoEl)).slice(0, 100) }
}
