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

  const ordenes = await VentaMl.find({ fecha: { $gte: desde, $lt: hasta } }).lean()
  const brutoVentas = ordenes.reduce((s, o) => s + (o.totalClp ?? 0), 0)
  const unidades = ordenes.reduce((s, o) => s + (o.items ?? []).reduce((u, i) => u + (i.cantidad ?? 0), 0), 0)

  // Débito REAL: la suma del IVA que declara cada boleta emitida, no el bruto
  // dividido por 1,19. Coinciden al peso (verificado 10-ago), pero el
  // documento es la fuente y el cálculo solo el respaldo mientras falten
  // boletas por sincronizar.
  const conBoleta = ordenes.filter((o) => Number.isFinite(o.boleta?.ivaClp))
  const ivaDeBoletas = conBoleta.reduce((s, o) => s + o.boleta.ivaClp, 0)
  const brutoConBoleta = conBoleta.reduce((s, o) => s + (o.boleta.brutoClp ?? o.totalClp ?? 0), 0)
  // lo que aún no tiene documento se estima, para no subdeclarar el período
  const estimadoDelResto = desglosarIva(brutoVentas - brutoConBoleta).ivaClp

  const ventas = { ...desglosarIva(brutoVentas), unidades, ordenes: ordenes.length }
  const debitoBase = conBoleta.length
    ? { clp: Math.round(ivaDeBoletas + estimadoDelResto), boletas: conBoleta.length, sinBoleta: ordenes.length - conBoleta.length }
    : { clp: ventas.ivaClp, boletas: 0, sinBoleta: ordenes.length }
  // quién emite: el mandato es lo que hace que este débito sea del vendedor
  const muestra = conBoleta[0]?.boleta ?? null

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
      base: debitoBase.boletas
        ? `${debitoBase.boletas} boleta(s) emitidas${debitoBase.sinBoleta ? ` + ${debitoBase.sinBoleta} estimada(s)` : ''}`
        : 'estimado del bruto (boletas sin sincronizar)',
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
