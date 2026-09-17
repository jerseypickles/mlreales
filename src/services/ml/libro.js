import { DiaProductoMl } from '../../models/DiaProductoMl.js'
import { ObservacionProductoMl } from '../../models/ObservacionProductoMl.js'
import { ProductoPropio } from '../../models/ProductoPropio.js'
import { VentaMl } from '../../models/VentaMl.js'
import { meliGet } from '../meli.js'
import { diaChile } from '../inventarioFull.js'

const DIA = 86400e3
const HISTORIA_DIAS = 150 // lo más lejos que ML entrega visitas por día
const RECALCULO_DIAS = 14 // una orden puede pagarse o anularse tarde
const diaUtc = (t) => new Date(t).toISOString().slice(0, 10)
const inicioDe = (dia) => +new Date(`${dia}T00:00:00Z`)

// ML omite los días sin visitas: dentro del rango que reporta, ausente es cero
// (medido el 17-sep-2026: la suma de los días presentes es el total declarado).
export function visitasPorDia(respuesta) {
  const dias = new Map()
  for (const r of respuesta?.results ?? []) {
    const dia = typeof r?.date === 'string' ? r.date.slice(0, 10) : null
    if (dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) && Number.isFinite(r.total) && r.total >= 0) dias.set(dia, (dias.get(dia) ?? 0) + r.total)
  }
  return dias
}

// Valor vigente en cada instante a partir de un historial {fecha, anterior, nuevo}.
function tramos(cambios, desde, hasta, valorSinHistoria) {
  const orden = (cambios ?? []).filter((c) => Number.isFinite(+new Date(c.fecha))).sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
  if (!orden.length) return { tramos: [{ valor: valorSinHistoria, ms: hasta - desde }], cambios: 0, inferido: false }
  const previos = orden.filter((c) => +new Date(c.fecha) <= desde)
  let vigente = previos.length ? previos.at(-1).nuevo : orden[0].anterior
  const dentro = orden.filter((c) => +new Date(c.fecha) > desde && +new Date(c.fecha) < hasta)
  const salida = []
  let t = desde
  for (const c of dentro) {
    salida.push({ valor: vigente, ms: +new Date(c.fecha) - t })
    t = +new Date(c.fecha)
    vigente = c.nuevo
  }
  salida.push({ valor: vigente, ms: hasta - t })
  return { tramos: salida, cambios: dentro.length, inferido: !previos.length && +new Date(orden[0].fecha) >= hasta }
}

// Renglones del libro para un producto. Pura: recibe todo lo ya leído.
export function diasDelLibro(propio, visitas, ventas, { ahora = new Date(), desdeDia } = {}) {
  const itemId = propio.itemIdMl ?? propio.sku
  const hoy = diaUtc(ahora)
  const unidades = new Map(), ordenes = new Map()
  let primeraVenta = null
  for (const v of ventas ?? []) {
    if (v.estado !== 'paid' || !Number.isFinite(+new Date(v.fecha))) continue
    const n = (v.items ?? []).reduce((a, i) => a + (i.itemId === itemId && Number.isFinite(i.cantidad) && i.cantidad > 0 ? i.cantidad : 0), 0)
    if (!n) continue
    const dia = diaUtc(v.fecha)
    unidades.set(dia, (unidades.get(dia) ?? 0) + n)
    ordenes.set(dia, (ordenes.get(dia) ?? 0) + 1)
    if (!primeraVenta || dia < primeraVenta) primeraVenta = dia
  }
  const primeraVisita = [...visitas.keys()].sort()[0] ?? null
  const limite = diaUtc(+ahora - HISTORIA_DIAS * DIA)
  let inicio = [primeraVisita, primeraVenta].filter(Boolean).sort()[0]
  if (!inicio) return []
  if (inicio < limite) inicio = limite
  if (desdeDia && desdeDia > inicio) inicio = desdeDia
  const ultima = [...(propio.mediciones ?? [])].sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha)).at(-1)
  const precioActual = ultima?.precioEfectivo ?? ultima?.precio ?? null
  const stock = new Map((propio.stockDiario ?? []).map((s) => [s.dia, s]))
  // última medición de cada día: unidades en bodega, reseñas y nota. Solo
  // existe para los ~6 días que conserva `mediciones`; más atrás queda sin dato.
  const cierre = new Map()
  for (const m of [...(propio.mediciones ?? [])].sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))) {
    if (Number.isFinite(+new Date(m.fecha))) cierre.set(diaUtc(m.fecha), m)
  }
  const filas = []
  for (let t = inicioDe(inicio); diaUtc(t) < hoy; t += DIA) {
    const dia = diaUtc(t)
    const p = tramos(propio.historialPrecios, t, t + DIA, precioActual)
    const valores = p.tramos.map((x) => x.valor)
    const preciosOk = valores.every((v) => Number.isFinite(v) && v > 0)
    const l = tramos(propio.historialLogistica, t, t + DIA, propio.envioMl?.logistica ?? null)
    const s = stock.get(dia)
    const m = cierre.get(dia)
    // la campaña vigente al cierre del día, leída del motivo del último cambio
    const motivo = (propio.historialPrecios ?? []).filter((c) => +new Date(c.fecha) < t + DIA)
      .sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha)).at(-1)?.motivo ?? null
    filas.push({ itemId, dia, titulo: propio.titulo ?? null, categoria: propio.categoriaMl ?? null,
      // el nicho se anota solo en los días que se escriben en su fecha
      nichoId: +ahora - t <= 2 * DIA ? propio.nichoId ?? null : null,
      visitas: visitas.get(dia) ?? 0, unidades: unidades.get(dia) ?? 0, ordenes: ordenes.get(dia) ?? 0,
      precio: preciosOk ? Math.round(p.tramos.reduce((a, x) => a + x.valor * x.ms, 0) / DIA) : null,
      precioMin: preciosOk ? Math.min(...valores) : null, precioMax: preciosOk ? Math.max(...valores) : null,
      cambiosPrecio: p.cambios, precioInferido: p.inferido,
      logistica: l.tramos.at(-1).valor ?? null, cambioLogistica: l.cambios > 0,
      stockFraccion: s && s.mediciones > 0 ? s.conStock / s.mediciones : null,
      promo: typeof motivo === 'string' && motivo.startsWith('promo ') ? motivo.slice(6).trim() : null,
      stockUnidades: Number.isFinite(m?.stock) ? m.stock : null,
      numReviews: Number.isFinite(m?.numReviews) ? m.numReviews : null,
      rating: Number.isFinite(m?.rating) ? m.rating : null })
  }
  return filas
}

// Semanas admisibles que se pueden leer del libro, con el mismo contrato que
// el registro en vivo: siete días corridos con stock medido y completo, una
// sola logística y precio conocido. Deslizantes; el entrenamiento elige las que
// no se solapan.
export function semanasDelLibro(dias) {
  const porItem = new Map()
  for (const d of dias) porItem.set(d.itemId, [...(porItem.get(d.itemId) ?? []), d])
  const semanas = []
  for (const [itemId, filas] of porItem) {
    const porDia = new Map(filas.map((d) => [d.dia, d]))
    for (const fin of filas) {
      const t = inicioDe(fin.dia)
      const semana = Array.from({ length: 7 }, (_, i) => porDia.get(diaUtc(t - (6 - i) * DIA)))
      if (!semana.every(Boolean) || !fin.categoria) continue
      if (semana.some((d) => d.stockFraccion !== 1 || d.cambioLogistica || d.precioInferido || !(d.precio > 0) || !d.logistica || d.logistica !== fin.logistica)) continue
      const visitas = semana.reduce((a, d) => a + d.visitas, 0)
      if (visitas < 1) continue
      const hasta = new Date(t + DIA)
      semanas.push({ itemId, titulo: fin.titulo, nichoId: fin.nichoId ?? null, categoria: fin.categoria,
        desde: new Date(t - 6 * DIA), hasta, dia: diaChile(hasta), visitas,
        unidades: semana.reduce((a, d) => a + d.unidades, 0),
        precio: Math.round(semana.reduce((a, d) => a + d.precio, 0) / 7),
        precioMin: Math.min(...semana.map((d) => d.precioMin)), precioMax: Math.max(...semana.map((d) => d.precioMax)),
        cambiosPrecio: semana.reduce((a, d) => a + d.cambiosPrecio, 0),
        full: fin.logistica === 'fulfillment', fuente: 'libro-diario' })
    }
  }
  return semanas
}

// Una vez al día por producto: la primera vez recupera hasta 150 días; después
// agrega el día cerrado y recalcula los últimos 14 (órdenes que entran tarde).
export async function actualizarLibroPropios(sincronizacion, { ahora = new Date(), pedir = meliGet } = {}) {
  if (!sincronizacion?.completa) return { productos: 0, dias: 0, semanas: 0, motivo: 'sin sincronización completa de órdenes' }
  const ayer = diaUtc(+ahora - DIA)
  const rehacer = sincronizacion.anuladas > 0
  const propios = await ProductoPropio.find({}).lean()
  let productos = 0, escritos = 0
  const errores = []
  for (const propio of propios) {
    const itemId = propio.itemIdMl ?? propio.sku
    if (!itemId || !/^MLC\d+$/.test(itemId)) continue
    // una orden que se anuló puede ser de cualquier fecha: ese día se rehace todo
    const ultimo = rehacer ? null : await DiaProductoMl.findOne({ itemId }).sort({ dia: -1 }).lean()
    if (ultimo?.dia >= ayer) continue
    try {
      // si el libro quedó atrasado más de 14 días, se recupera el hueco entero
      const atraso = ultimo ? Math.ceil((+ahora - inicioDe(ultimo.dia)) / DIA) : HISTORIA_DIAS
      const last = Math.min(HISTORIA_DIAS, Math.max(RECALCULO_DIAS + 1, atraso + 1))
      const respuesta = await pedir(`/items/${itemId}/visits/time_window?last=${last}&unit=day`)
      const desdeDia = ultimo ? diaUtc(+ahora - (last - 1) * DIA) : undefined
      const ventas = await VentaMl.find({ estado: 'paid', 'items.itemId': itemId,
        fecha: { $gte: new Date(+ahora - (HISTORIA_DIAS + 1) * DIA) } }).lean()
      const filas = diasDelLibro(propio, visitasPorDia(respuesta), ventas, { ahora, desdeDia })
      if (!filas.length) continue
      const sinNulos = (f) => Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== null || !['stockUnidades', 'numReviews', 'rating', 'stockFraccion'].includes(k)))
      await DiaProductoMl.bulkWrite(filas.map(({ nichoId, ...f }) => ({ updateOne: {
        filter: { itemId: f.itemId, dia: f.dia },
        // el nicho se anota una vez: recalcular no le atribuye el de hoy a un día viejo
        update: { $set: { ...sinNulos(f), actualizadoEl: ahora }, $setOnInsert: { nichoId } }, upsert: true,
      } })))
      productos++
      escritos += filas.length
    } catch (err) {
      errores.push(`${itemId}: ${err.message}`)
    }
  }
  if (!productos) return { productos: 0, dias: 0, semanas: 0, errores }
  const dias = await DiaProductoMl.find({ dia: { $gte: diaUtc(+ahora - (HISTORIA_DIAS + 7) * DIA) } }).lean()
  const semanas = semanasDelLibro(dias)
  let nuevas = 0
  if (semanas.length) {
    const r = await ObservacionProductoMl.bulkWrite(semanas.map((o) => ({ updateOne: {
      filter: { itemId: o.itemId, dia: o.dia }, update: { $setOnInsert: o }, upsert: true,
    } })))
    nuevas = r.upsertedCount
    // las semanas que salen del libro se corrigen con él; las del registro en
    // vivo no se tocan
    if (rehacer) {
      await ObservacionProductoMl.bulkWrite(semanas.map((o) => ({ updateOne: {
        filter: { itemId: o.itemId, dia: o.dia, fuente: 'libro-diario' }, update: { $set: o },
      } })))
    }
  }
  return { productos, dias: escritos, semanas: nuevas, errores }
}

export async function resumenLibro({ ahora = new Date(), diasSerie = 42 } = {}) {
  const filas = await DiaProductoMl.aggregate([
    { $group: { _id: '$itemId', titulo: { $last: '$titulo' }, dias: { $sum: 1 }, desde: { $min: '$dia' }, hasta: { $max: '$dia' },
      visitas: { $sum: '$visitas' }, unidades: { $sum: '$unidades' },
      diasConStockMedido: { $sum: { $cond: [{ $ne: ['$stockFraccion', null] }, 1, 0] } } } },
    { $sort: { unidades: -1 } },
  ])
  // la serie reciente, para dibujarla: un punto por día, con los ceros
  const desdeSerie = diaUtc(+ahora - diasSerie * DIA)
  const recientes = await DiaProductoMl.find({ dia: { $gte: desdeSerie } }).select('itemId dia visitas unidades stockFraccion promo').sort({ dia: 1 }).lean()
  const porItem = new Map(), total = new Map()
  for (const d of recientes) {
    porItem.set(d.itemId, [...(porItem.get(d.itemId) ?? []), { dia: d.dia, visitas: d.visitas, unidades: d.unidades, sinStock: d.stockFraccion !== null && d.stockFraccion < 1, promo: !!d.promo }])
    const t = total.get(d.dia) ?? { dia: d.dia, visitas: 0, unidades: 0 }
    t.visitas += d.visitas
    t.unidades += d.unidades
    total.set(d.dia, t)
  }
  return { productos: filas.length, dias: filas.reduce((a, f) => a + f.dias, 0),
    unidades: filas.reduce((a, f) => a + f.unidades, 0), visitas: filas.reduce((a, f) => a + f.visitas, 0),
    desde: filas.map((f) => f.desde).sort()[0] ?? null, hasta: filas.map((f) => f.hasta).sort().at(-1) ?? null,
    serie: [...total.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
    porProducto: filas.map(({ _id, ...f }) => ({ itemId: _id, ...f, serie: porItem.get(_id) ?? [] })) }
}
