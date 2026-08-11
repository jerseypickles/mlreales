import { VentaMl } from '../models/VentaMl.js'
import { CargoMl } from '../models/CargoMl.js'
import { mesActual } from './gastos.js'

// Posición de IVA del mes. OJO con el alcance: esto NO reemplaza al RCV del
// SII, que es la fuente de verdad y de donde sale el F29 propuesto. Acá solo se
// arma lo que el sistema puede medir por su cuenta (ventas de ML y lo que ML
// cobró) para que el importador vea el orden de magnitud mientras el RCV no
// esté cargado. El crédito grande —importaciones (DIN) y gastos— no está acá.

export const IVA_PCT = 19

// En Chile los precios de ML son CON IVA incluido: el neto es bruto / 1,19 y
// el impuesto la diferencia. Redondeo a peso, que es como declara el SII.
export function desglosarIva(brutoClp) {
  if (!Number.isFinite(brutoClp) || brutoClp <= 0) return { brutoClp: 0, netoClp: 0, ivaClp: 0 }
  const netoClp = Math.round(brutoClp / (1 + IVA_PCT / 100))
  return { brutoClp: Math.round(brutoClp), netoClp, ivaClp: Math.round(brutoClp) - netoClp }
}

// Rango [desde, hasta) del mes en hora de Chile. El corte importa: una venta de
// las 22:00 del último día del mes es de ESE mes, no del siguiente.
export function rangoDelMes(periodo) {
  const [anio, mes] = periodo.split('-').map(Number)
  const desde = new Date(Date.UTC(anio, mes - 1, 1, 4, 0, 0)) // 00:00 en Chile ≈ 04:00 UTC
  const hasta = new Date(Date.UTC(mes === 12 ? anio + 1 : anio, mes === 12 ? 0 : mes, 1, 4, 0, 0))
  return { desde, hasta }
}

export async function posicionIva({ periodo = mesActual() } = {}) {
  const { desde, hasta } = rangoDelMes(periodo)

  // VISTA COMERCIAL: las órdenes cerradas en el período. Es lo que se vendió.
  const ordenes = await VentaMl.find({ fecha: { $gte: desde, $lt: hasta } }).lean()
  const brutoVentas = ordenes.reduce((s, o) => s + (o.totalClp ?? 0), 0)
  const unidades = ordenes.reduce((s, o) => s + (o.items ?? []).reduce((u, i) => u + (i.cantidad ?? 0), 0), 0)
  const sinBoleta = ordenes.filter((o) => !o.boleta?.invoiceId).length
  const ventas = { ...desglosarIva(brutoVentas), unidades, ordenes: ordenes.length, sinBoleta }

  // VISTA TRIBUTARIA: los documentos EMITIDOS en el período, cada uno contado
  // una sola vez. Dos correcciones sobre lo obvio, ambas medidas el 10-ago:
  //
  //  1. Una boleta puede cubrir VARIAS órdenes (compras de un mismo carro:
  //     51 de 52 órdenes traían tag pack_order y 3 boletas cubrían más de una).
  //     Sumar por orden duplicaba el IVA: daba $26.966 donde eran $22.287.
  //  2. El corte va por fecha de EMISIÓN, no por fecha de la orden. Un pack que
  //     cruza el fin de mes se factura en un período y sus órdenes caen en el
  //     otro — por eso el bruto de las boletas de agosto ($139.507) no calza
  //     con el de las órdenes de agosto ($119.911).
  //
  // El débito del período es lo primero, no lo segundo.
  const conDocumento = await VentaMl.find({ 'boleta.emitidaEl': { $gte: desde, $lt: hasta } })
    .select('boleta')
    .lean()
  const porFactura = new Map()
  for (const v of conDocumento) {
    if (v.boleta?.invoiceId && !porFactura.has(v.boleta.invoiceId)) porFactura.set(v.boleta.invoiceId, v.boleta)
  }
  const documentos = [...porFactura.values()]
  const ivaDocumentos = documentos.reduce((s, b) => s + (b.ivaClp ?? 0), 0)
  const brutoDocumentos = documentos.reduce((s, b) => s + (b.brutoClp ?? 0), 0)

  const debitoBase = documentos.length
    ? {
        clp: Math.round(ivaDocumentos),
        documentos: documentos.length,
        brutoClp: Math.round(brutoDocumentos),
        netoClp: Math.round(brutoDocumentos - ivaDocumentos),
      }
    : { clp: ventas.ivaClp, documentos: 0, brutoClp: brutoVentas, netoClp: ventas.netoClp }
  // quién emite: el mandato es lo que hace que este débito sea del vendedor
  const muestra = documentos[0] ?? null

  // cargos de ML del período: comisión, envío y publicidad. Los anulados en
  // factura no son costo y por lo tanto tampoco generan crédito.
  const cargos = await CargoMl.find({ fecha: { $gte: desde, $lt: hasta }, anulado: { $ne: true } }).lean()
  const totalCargos = cargos.reduce((s, c) => s + (c.montoClp ?? 0), 0)
  const cargosMl = { totalClp: Math.round(totalCargos), lineas: cargos.length }

  return {
    periodo,
    ventas,
    cargosMl,
    debito: {
      ...debitoBase,
      base: debitoBase.documentos
        ? `${debitoBase.documentos} documento(s) emitido(s) en el período`
        : 'estimado del bruto (documentos sin sincronizar)',
    },
    // El documento lo emite ML con sus folios, pero "por cuenta y orden de" la
    // empresa: la venta es del vendedor y el débito también. Se muestra en
    // pantalla porque es la diferencia entre "ML me compró" y "ML facturó por
    // mí", que cambia por completo cómo se declara.
    emision: muestra
      ? {
          tipo: muestra.tipo,
          emisorNombre: muestra.emisorNombre,
          emisorRut: muestra.emisorRut,
          porCuentaDe: muestra.porCuentaDe,
        }
      : null,
    // supuesto explícito y todavía sin confirmar: que los montos que ML factura
    // vienen con IVA incluido. Se resuelve leyendo la factura del período
    // cuando cierre; hasta entonces el número es referencial.
    creditoMl: { clp: desglosarIva(totalCargos).ivaClp, supuesto: 'montos de ML con IVA incluido' },
    actualizadoEl: new Date(),
  }
}
