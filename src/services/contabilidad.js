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

// LO QUE ML COBRA, DESGLOSADO Y CON LAS ANULACIONES RESTANDO.
//
// El detalle de facturación trae dos clases de línea: los cargos y sus
// ANULACIONES, que ML manda con código propio empezado en B y monto POSITIVO
// (BV anula CV, BFF anula CFF, BPAD anula PADS). Sumarlas todas cuenta la
// anulación como si fuera un costo más.
//
// Hasta el 18-ago-2026 esta pantalla sumaba `montoClp` de todo lo que no
// tuviera estado BONUS_ON_BILL, y daba $348.111 donde ML facturaba $283.939:
// $64.171 de más. El BONUS_ON_BILL tampoco había que excluirlo — ML lo cobra y
// lo compensa con su línea B, así que el par ya se cancela solo.
//
// La fórmula quedó fijada contra la factura, no por criterio: sumar los cargos
// y restar las anulaciones reproduce EXACTO el monto del período que declara
// /billing/integration/monthly/periods (diferencia $0,0 sobre 284 líneas).
const FAMILIA_CARGO = {
  CV: 'comision',
  CFF: 'envios',
  CXD: 'envios',
  PADS: 'publicidad',
  CFCB: 'colecta',
  CFWA: 'almacenamiento',
}
// qué cargo anula cada código de anulación
const ANULA_A = { BV: 'CV', BFF: 'CFF', BPAD: 'PADS' }

export const ETIQUETA_FAMILIA = {
  comision: 'Comisión por venta',
  envios: 'Envíos Full',
  publicidad: 'Publicidad (Product Ads)',
  colecta: 'Colecta Full',
  almacenamiento: 'Almacenamiento Full',
  otros: 'Otros cargos',
}

export function desglosarCargos(cargos) {
  const familias = new Map()
  let total = 0
  let anulaciones = 0
  for (const c of cargos) {
    const monto = c.montoClp ?? 0
    if (!Number.isFinite(monto)) continue
    const codigoAnulado = ANULA_A[c.tipo]
    const esAnulacion = Boolean(codigoAnulado) || String(c.tipo ?? '').startsWith('B')
    const familia = FAMILIA_CARGO[codigoAnulado ?? c.tipo] ?? 'otros'
    const signo = esAnulacion ? -1 : 1
    const f = familias.get(familia) ?? { familia, etiqueta: ETIQUETA_FAMILIA[familia], clp: 0, lineas: 0 }
    f.clp += signo * monto
    f.lineas++
    familias.set(familia, f)
    total += signo * monto
    if (esAnulacion) anulaciones += monto
  }
  return {
    totalClp: Math.round(total),
    anulacionesClp: Math.round(anulaciones),
    lineas: cargos.length,
    familias: [...familias.values()]
      .map((f) => ({ ...f, clp: Math.round(f.clp) }))
      .filter((f) => f.clp !== 0)
      .sort((a, b) => b.clp - a.clp),
  }
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

  // cargos de ML del período, desglosados y con las anulaciones restando (ver
  // desglosarCargos). Se traen TODAS las líneas, incluidas las BONUS_ON_BILL:
  // su anulación viene aparte y el par se cancela solo.
  const cargos = await CargoMl.find({ fecha: { $gte: desde, $lt: hasta } }).lean()
  const cargosMl = desglosarCargos(cargos)
  const ultimoCargo = cargos.reduce((max, c) => (c.guardadoEl > max ? c.guardadoEl : max), null)
  cargosMl.sincronizadoEl = ultimoCargo ?? null
  const totalCargos = cargosMl.totalClp

  // lo que ML declara del período: sirve de cuadratura y trae la DEUDA, que es
  // lo que todavía no descuenta de las ventas (publicidad, colecta, almacenaje)
  //
  // OJO CON LA VENTANA: el período de facturación de ML NO es el mes
  // calendario — el 2026-08-01 corre del 29-jul al 25-ago. Cuadrar su monto
  // contra los cargos del mes daría una diferencia que no es un error sino dos
  // ventanas distintas, así que el descuadre se calcula sobre las líneas del
  // rango de ML. Si ese descuadre no da ~0, faltan líneas por sincronizar.
  let periodoMl = null
  try {
    const { periodosFacturacion } = await import('./cargosMl.js')
    const ps = await periodosFacturacion()
    const p = ps.find((x) => String(x.key).startsWith(periodo)) ?? null
    if (p) {
      const enVentana = await CargoMl.find({
        fecha: { $gte: new Date(`${p.desde}T00:00:00Z`), $lt: new Date(`${p.hasta}T23:59:59Z`) },
      }).lean()
      const medido = desglosarCargos(enVentana).totalClp
      periodoMl = {
        totalClp: Math.round(p.montoClp ?? 0),
        impagoClp: Math.round(p.impagoClp ?? 0),
        desde: p.desde,
        hasta: p.hasta,
        estado: p.estado,
        medidoClp: medido,
        descuadreClp: Math.round((p.montoClp ?? 0) - medido),
      }
    }
  } catch (err) {
    console.warn(`[contabilidad] período de ML no consultado: ${err.message}`)
  }

  // LA RESPUESTA, CALCULADA ACÁ Y NO EN LA PANTALLA.
  //
  // La mesa mostraba débito y crédito en dos columnas y nunca decía cuánto se
  // paga. El importador lo dijo así: "veo un enredo y no sé qué es lo que se
  // impone, después gastamos en publicidad y no sé cuánto queda". Las dos
  // preguntas que tiene son esas, y ninguna estaba en pantalla.
  //
  // El rango existe porque no se sabe si ML factura con IVA incluido o neto —
  // se resuelve cuando emita el documento del período. Mientras tanto se
  // muestran los dos extremos en vez de un número falsamente preciso.
  const creditoConIva = Math.round((totalCargos * 19) / 119)
  const creditoNeto = Math.round(totalCargos * 0.19)
  const resultado = {
    ivaAPagar: debitoBase.clp - creditoConIva,
    ivaAPagarSiNeto: debitoBase.clp - creditoNeto,
    // lo que queda en caja: lo cobrado menos lo que ML se llevó menos el IVA.
    // ANTES del costo de la mercadería, que no está cargado.
    vendido: debitoBase.brutoClp,
    cobradoPorMl: Math.round(totalCargos),
    publicidad: cargosMl.familias?.find((f) => f.familia === 'publicidad')?.clp ?? 0,
    quedaEnCaja: debitoBase.brutoClp - Math.round(totalCargos) - (debitoBase.clp - creditoConIva),
    esTecho: true,
  }

  return {
    periodo,
    ventas,
    cargosMl,
    resultado,
    periodoMl,
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
