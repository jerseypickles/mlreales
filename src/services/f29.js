// EL F29 DE CADA MES, ARMADO SOLO, Y SI ESTÁ AL DÍA.
//
// El importador, 30-sep-2026: "tenemos que manejar mejor la contabilidad, muchas
// cosas están desactualizadas y viven manuales; este es el tercer mes que
// entramos sin pagar impuestos". El panel dependía de la sesión del SII (que
// vence en días) para casi todo, y no decía cuánto pagar ni si un mes estaba
// atrasado.
//
// Ahora cada mes se arma con lo que el sistema lee solo:
//   débito   [500]/[501]  las boletas que ML emite por tu cuenta (o el RCV si hay sesión)
//   crédito  [519]/[520]  la factura mensual de ML, leída de su XML (o el RCV)
//            [527]/[528]  notas de crédito de ML
//            [534]/[535]  la DIN de importación (registrada a mano)
//   remanente [504]       lo que sobró de crédito el mes anterior
//   PPM      [563]/[115]/[062]  1% de las ventas netas (primer año de actividad)
//   total    [91]
// y con su vencimiento: el día 20 del mes siguiente.

export const INICIO_ACTIVIDADES = process.env.INICIO_ACTIVIDADES || '2026-07'
export const TASA_PPM_PCT = Number(process.env.TASA_PPM_PCT || 1)

const siguienteMes = (periodo) => {
  const [a, m] = periodo.split('-').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}
export const mesesDesde = (desde, hasta) => {
  const out = []
  for (let p = desde; p <= hasta; p = siguienteMes(p)) out.push(p)
  return out
}

// Pura. Día 20 del mes siguiente; si cae sábado o domingo, el lunes (los
// feriados también lo corren, y no se cuentan acá: se avisa).
export function vencimientoF29(periodo) {
  const [a, m] = siguienteMes(periodo).split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, 20, 12))
  const dow = d.getUTCDay()
  if (dow === 6) d.setUTCDate(22)
  if (dow === 0) d.setUTCDate(21)
  return d.toISOString().slice(0, 10)
}

// Pura. ¿Está al día? declarado / pendiente / vence pronto / atrasado.
export function estadoF29(periodo, { declaracion = null, hoy = new Date() } = {}) {
  const vence = vencimientoF29(periodo)
  const hoyIso = new Date(hoy).toISOString().slice(0, 10)
  const dias = Math.round((Date.parse(`${vence}T12:00:00Z`) - Date.parse(`${hoyIso}T12:00:00Z`)) / 86400e3)
  const mesAbierto = hoyIso < `${siguienteMes(periodo)}-01`
  if (declaracion) return { vence, estado: 'declarado', declaradoEl: declaracion.declaradoEl, diasAtraso: declaracion.declaradoEl > vence ? Math.round((Date.parse(declaracion.declaradoEl) - Date.parse(vence)) / 86400e3) : 0 }
  if (mesAbierto) return { vence, estado: 'mes-en-curso', dias }
  if (dias < 0) return { vence, estado: 'atrasado', diasAtraso: -dias }
  return { vence, estado: dias <= 5 ? 'vence-pronto' : 'por-declarar', dias }
}

// Pura. Los casilleros del mes. Cada uno dice de dónde salió.
export function armarF29({ debito, credito, notasCredito = { documentos: 0, ivaClp: 0 }, din = { documentos: 0, ivaClp: 0 }, remanenteAnterior = 0, ventasNetasClp = 0, tasaPpmPct = TASA_PPM_PCT }) {
  const debitoTotal = debito.ivaClp ?? 0
  const creditoTotal = (credito.ivaClp ?? 0) - (notasCredito.ivaClp ?? 0) + (din.ivaClp ?? 0)
  const determinado = debitoTotal - creditoTotal - (remanenteAnterior ?? 0)
  const ivaAPagar = Math.max(0, determinado)
  const remanente = Math.max(0, -determinado)
  const ppm = Math.round((ventasNetasClp * tasaPpmPct) / 100)
  const c = (codigo, que, valor, fuente, unidad = 'clp') => ({ codigo, que, valor, fuente, unidad })
  return {
    codigos: [
      c(500, 'Liquidaciones-factura recibidas por el mandato', debito.documentos, debito.fuenteDocumentos ?? debito.fuente, 'documentos'),
      c(501, 'IVA débito de esas liquidaciones', debitoTotal, debito.fuente),
      c(519, 'Facturas recibidas con derecho a crédito', credito.documentos, credito.fuente, 'documentos'),
      c(520, 'IVA crédito de esas facturas', credito.ivaClp ?? 0, credito.fuente),
      ...(notasCredito.documentos ? [c(527, 'Notas de crédito recibidas', notasCredito.documentos, notasCredito.fuente, 'documentos'), c(528, 'IVA de esas notas de crédito (resta)', notasCredito.ivaClp, notasCredito.fuente)] : []),
      ...(din.documentos ? [c(534, 'Declaraciones de ingreso (DIN) de importación', din.documentos, 'registradas a mano', 'documentos'), c(535, 'IVA pagado en esas DIN', din.ivaClp, 'registradas a mano')] : []),
      c(504, 'Remanente de crédito del mes anterior', remanenteAnterior ?? 0, remanenteAnterior ? 'el [77] del mes anterior (sin reajuste UTM)' : 'sin remanente'),
      c(538, 'Total débitos', debitoTotal, 'suma'),
      c(537, 'Total créditos', creditoTotal + (remanenteAnterior ?? 0), 'suma'),
      ...(remanente ? [c(77, 'Remanente de crédito para el mes siguiente', remanente, 'créditos mayores que débitos')] : [c(89, 'IVA determinado a pagar', ivaAPagar, 'débitos menos créditos')]),
      c(563, 'Base del PPM: ventas netas del mes', Math.round(ventasNetasClp), debito.fuenteNeto ?? debito.fuente),
      c(115, 'Tasa del PPM', tasaPpmPct, 'primer año de actividad: 1%', '%'),
      c(62, 'PPM a pagar', ppm, `${tasaPpmPct}% de la base`),
      c(91, 'TOTAL A PAGAR', ivaAPagar + ppm, 'IVA + PPM, sin multas ni intereses'),
    ],
    ivaAPagar, remanente, ppm, totalAPagar: ivaAPagar + ppm, debitoTotal, creditoTotal,
  }
}

// Pura. Domingos del mes con ventas la semana anterior: ML emite una
// liquidación-factura semanal (agosto 2026: folios del 02, 09, 16 y 23-08).
// Es la estimación del [500] mientras no haya RCV que la confirme.
export function liquidacionesEstimadas(periodo, diasConBoleta) {
  const [a, m] = periodo.split('-').map(Number)
  let n = 0
  for (let d = 1; d <= 31; d++) {
    const f = new Date(Date.UTC(a, m - 1, d, 12))
    if (f.getUTCMonth() !== m - 1) break
    if (f.getUTCDay() !== 0) continue
    const semana = [...Array(7)].map((_, i) => new Date(+f - (i + 1) * 86400e3).toISOString().slice(0, 10))
    if (semana.some((x) => diasConBoleta.has(x))) n++
  }
  return n
}

// Lo que el sistema lee solo para un mes: boletas emitidas por ML por tu
// cuenta, facturas de ML, notas de crédito y documentos cargados a mano.
export async function datosDelMes(periodo) {
  const { VentaMl } = await import('../models/VentaMl.js')
  const { rangoDelMes } = await import('./contabilidad.js')
  const { facturasMlDelMes } = await import('./facturasMl.js')
  const { DocumentoCompra } = await import('../models/DocumentoCompra.js')
  const { desde, hasta } = rangoDelMes(periodo)
  const conBoleta = await VentaMl.find({ 'boleta.emitidaEl': { $gte: desde, $lt: hasta } }).select('boleta').lean()
  const unicas = new Map()
  for (const v of conBoleta) if (v.boleta?.invoiceId && !unicas.has(v.boleta.invoiceId)) unicas.set(v.boleta.invoiceId, v.boleta)
  const boletas = [...unicas.values()]
  const ivaBoletas = boletas.reduce((s, b) => s + (b.ivaClp ?? 0), 0)
  const brutoBoletas = boletas.reduce((s, b) => s + (b.brutoClp ?? 0), 0)
  const dias = new Set(boletas.map((b) => new Date(new Date(b.emitidaEl).getTime() - 4 * 3600e3).toISOString().slice(0, 10)))
  const ml = await facturasMlDelMes(periodo)
  const manuales = await DocumentoCompra.find({ fecha: { $gte: `${periodo}-01`, $lte: `${periodo}-31` } }).lean()
  const dins = manuales.filter((d) => d.tipo === 'din')
  const facturasManuales = manuales.filter((d) => d.tipo === 'factura')
  return {
    boletas: { documentos: boletas.length, ivaClp: Math.round(ivaBoletas), brutoClp: Math.round(brutoBoletas), netoClp: Math.round(brutoBoletas - ivaBoletas), liquidacionesEstimadas: liquidacionesEstimadas(periodo, dias) },
    ml, dins, facturasManuales,
  }
}

// El F29 de un mes con lo leído solo (y el RCV si se le pasa).
export function f29DesdeDatos(periodo, datos, { rcv = null, comprasRcv = null, remanenteAnterior = 0 } = {}) {
  const b = datos.boletas
  const rcvDebito = rcv && !rcv.error && rcv.documentos > 0
  const debito = rcvDebito
    ? { documentos: rcv.documentos, ivaClp: Math.round(rcv.ivaDebitoClp), fuente: 'RCV del SII: liquidaciones-factura', fuenteDocumentos: 'RCV del SII', netoClp: Math.round(rcv.netoVentasClp ?? rcv.netoClp ?? b.netoClp), fuenteNeto: 'RCV del SII' }
    : { documentos: b.liquidacionesEstimadas, ivaClp: b.ivaClp, fuente: `${b.documentos} boletas emitidas por ML por tu cuenta`, fuenteDocumentos: 'estimado: una liquidación por semana', netoClp: b.netoClp }
  const rcvCredito = comprasRcv && !comprasRcv.error && comprasRcv.documentos > 0
  const manualesFact = datos.facturasManuales ?? []
  const credito = rcvCredito
    // el RCV ya trae la factura de ML y cualquier factura electrónica de proveedores
    ? { documentos: comprasRcv.documentos, ivaClp: Math.round(comprasRcv.ivaCreditoClp), fuente: 'RCV del SII: registro de compras' }
    : { documentos: datos.ml.facturas + manualesFact.length, ivaClp: datos.ml.ivaFacturas + manualesFact.reduce((a, d) => a + d.ivaClp, 0),
      fuente: datos.ml.facturas ? `factura de ML leída de su XML${manualesFact.length ? ` + ${manualesFact.length} cargada(s) a mano` : ''}` : manualesFact.length ? 'cargadas a mano' : 'ML todavía no emite la factura del mes' }
  const notasCredito = { documentos: datos.ml.notas, ivaClp: datos.ml.ivaNotas, fuente: 'notas de crédito de ML (XML)' }
  const din = { documentos: datos.dins.length, ivaClp: datos.dins.reduce((a, d) => a + d.ivaClp, 0) }
  return armarF29({ debito, credito, notasCredito, din, remanenteAnterior, ventasNetasClp: debito.netoClp ?? 0 })
}

// Todos los meses desde el inicio de actividades: su F29, su estado y el
// remanente que pasa de uno al otro.
export async function resumenF29({ hoy = new Date() } = {}) {
  const { DeclaracionF29 } = await import('../models/DeclaracionF29.js')
  const actual = new Date(hoy).toISOString().slice(0, 7)
  const declaraciones = new Map((await DeclaracionF29.find().lean()).map((d) => [d.periodo, d]))
  const meses = []
  let remanente = 0
  for (const periodo of mesesDesde(INICIO_ACTIVIDADES, actual)) {
    const datos = await datosDelMes(periodo)
    const f = f29DesdeDatos(periodo, datos, { remanenteAnterior: remanente })
    const decl = declaraciones.get(periodo) ?? null
    const estado = estadoF29(periodo, { declaracion: decl, hoy })
    meses.push({ periodo, ...estado, totalAPagar: f.totalAPagar, ivaAPagar: f.ivaAPagar, ppm: f.ppm, remanente: f.remanente, debito: f.debitoTotal, credito: f.creditoTotal,
      declaracion: decl, facturaMl: datos.ml.facturas > 0, dins: datos.dins.length })
    // lo declarado manda sobre lo calculado para el remanente que se arrastra
    remanente = decl?.remanenteClp != null ? decl.remanenteClp : f.remanente
  }
  const atrasados = meses.filter((m) => m.estado === 'atrasado')
  return { meses: meses.reverse(), atrasados: atrasados.length, deudaAtrasada: atrasados.reduce((a, m) => a + m.totalAPagar, 0) }
}
