import crypto from 'node:crypto'
import { SiiSesion } from '../models/SiiSesion.js'

// CLIENTE DEL REGISTRO DE COMPRAS Y VENTAS DEL SII.
//
// El SII NO tiene web service para esto — lo dice hasta la competencia que lo
// vende ("todas las operaciones se realizan utilizando técnicas de scraping").
// Lo que sí hay es la app Angular del propio SII llamando endpoints JSON
// internos, y eso es lo que hablamos acá. El contrato completo, con cómo se
// capturó, está en docs/rcv-sii-contrato.md.
//
// POR QUÉ NO USAMOS UN PROVEEDOR. Se evaluaron cuatro el 25-ago-2026. BaseAPI
// anunció su cierre para el 11-dic y ni siquiera acepta cuentas nuevas —
// exactamente el riesgo de colgarse de un tercero. SimpleAPI pide 3 UF al año
// y ApiPyme 0,90 UF al mes, y los dos exigen entregarles la clave tributaria.
// Acá la clave no se entrega a nadie: el usuario abre su sesión en sii.cl y el
// sistema recibe solo las cookies.

const BASE = 'https://www4.sii.cl/consdcvinternetui/services/data/facadeService'
const NS = 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService'

// CUIDADO CON ESTA CABECERA. Con `application/json` a secas el servidor
// responde HTTP 500 y un `NotAcceptableException: RESTEASY001530` que no
// menciona por ningún lado que el problema es el Accept. Va exacto como lo
// manda la app del SII.
const ACCEPT = 'application/json, text/plain, */*'

export class SesionSiiVencida extends Error {
  constructor(mensaje = 'la sesión del SII expiró: hay que reconectar desde sii.cl') {
    super(mensaje)
    this.name = 'SesionSiiVencida'
    this.reconectar = true
  }
}

// Del string de cookies del navegador a un mapa. Los valores pueden traer '='
// adentro (el hash bcrypt de NETSCAPE_LIVEWIRE.clave), así que solo se parte
// en el primero.
export function parsearCookies(str) {
  const mapa = new Map()
  for (const parte of String(str ?? '').split(';')) {
    const i = parte.indexOf('=')
    if (i < 1) continue
    mapa.set(parte.slice(0, i).trim(), parte.slice(i + 1).trim())
  }
  return mapa
}

// Cuándo muere la sesión. `locexp` viene como fecha GMT explícita y es la
// fuente buena; `exp` es AAAAMMDDHHMMSS en hora de Chile y sirve de respaldo,
// pero interpretarla mal por el huso daría una sesión "viva" que ya murió.
export function expiracionDe(cookies) {
  const loc = cookies.get('NETSCAPE_LIVEWIRE.locexp')
  if (loc) {
    const d = new Date(decodeURIComponent(loc))
    if (!Number.isNaN(d.getTime())) return d
  }
  const exp = cookies.get('NETSCAPE_LIVEWIRE.exp')
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(exp ?? '')
  if (!m) return null
  const [, a, me, d, h, mi, s] = m
  // Chile en UTC-4; si el país está en horario de verano la sesión se dará por
  // muerta una hora antes de tiempo, que es el lado seguro del error
  return new Date(`${a}-${me}-${d}T${h}:${mi}:${s}-04:00`)
}

// Toma las cookies de una sesión que el usuario abrió en su navegador.
export async function guardarSesion(cookieString) {
  const cookies = parsearCookies(cookieString)
  const token = cookies.get('TOKEN')
  const rut = cookies.get('RUT_NS') ?? cookies.get('NETSCAPE_LIVEWIRE.rut')
  const dv = cookies.get('DV_NS') ?? cookies.get('NETSCAPE_LIVEWIRE.dv')
  if (!token) throw new Error('las cookies no traen TOKEN: ¿copiaste las de www4.sii.cl con la sesión abierta?')
  if (!rut) throw new Error('las cookies no traen el RUT (RUT_NS)')

  await SiiSesion.deleteMany({})
  const doc = await SiiSesion.create({
    cookies: String(cookieString).trim(),
    token,
    rut: String(rut),
    dv: String(dv ?? ''),
    expiraEl: expiracionDe(cookies),
    conectadoEl: new Date(),
  })
  return { rut: `${doc.rut}-${doc.dv}`, expiraEl: doc.expiraEl }
}

export async function estadoSesion() {
  const s = await SiiSesion.findOne().lean()
  if (!s) return { conectada: false, motivo: 'nunca se conectó' }
  const vencida = s.expiraEl ? s.expiraEl.getTime() <= Date.now() : false
  return {
    conectada: !vencida,
    motivo: vencida ? 'la sesión expiró' : null,
    rut: `${s.rut}-${s.dv}`,
    expiraEl: s.expiraEl,
    conectadoEl: s.conectadoEl,
    ultimoUsoEl: s.ultimoUsoEl,
  }
}

async function sesionUsable() {
  const s = await SiiSesion.findOne()
  if (!s) throw new SesionSiiVencida('no hay sesión del SII conectada')
  if (s.expiraEl && s.expiraEl.getTime() <= Date.now()) throw new SesionSiiVencida()
  return s
}

// CÓDIGOS DE "NO HAY NADA", medidos contra la cuenta real el 25-ago-2026:
//
//   3   el resumen no encuentra registro para ese período+operación. Julio no
//       tenía ninguna compra y devolvía esto con data en null.
//   99  el detalle no tiene filas... O tiene demasiadas y hay que pedirlas de
//       forma diferida. El SII usa el MISMO código y el MISMO mensaje para las
//       dos cosas, que no se parecen en nada.
//
// Ninguno es una excepción: los dos significan "vino vacío". La ambigüedad del
// 99 se resuelve afuera, comparando contra el resumen (ver liquidacionesDelPeriodo).
const CODIGOS_VACIOS = new Set([3, 99])

async function llamar(metodo, data, sesion) {
  const resp = await fetch(`${BASE}/${metodo}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: ACCEPT,
      Cookie: sesion.cookies,
      Origin: 'https://www4.sii.cl',
      Referer: 'https://www4.sii.cl/consdcvinternetui/',
    },
    body: JSON.stringify({
      metaData: {
        namespace: `${NS}/${metodo}`,
        conversationId: sesion.token,
        transactionId: crypto.randomUUID(),
        page: null,
      },
      data,
    }),
  })

  const texto = await resp.text()
  let cuerpo
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    // con la sesión caída el SII devuelve HTML (la página de login), no un 401.
    // Un JSON.parse que revienta acá es eso el 99% de las veces.
    throw new SesionSiiVencida(`el SII respondió HTML en ${metodo} (HTTP ${resp.status}): la sesión ya no sirve`)
  }
  // codRespuesta 99 tapa DOS casos con el mismo mensaje: "no hay documentos" y
  // "debe ser de forma diferida" (demasiadas filas para la consulta síncrona).
  // Tratarlos igual haría que un período grande devolviera vacío en silencio y
  // el F29 saliera en cero, así que acá solo se marca y quien llama compara
  // contra el resumen — que sí sabe cuántos documentos hay.
  const cod = cuerpo?.respEstado?.codRespuesta
  if (CODIGOS_VACIOS.has(cod) && !(cuerpo.data ?? []).length) {
    return { data: [], sinFilas: true, codigo: cod, mensaje: cuerpo.respEstado.msgeRespuesta ?? null }
  }
  if (cuerpo?.respEstado && cuerpo.respEstado.codRespuesta !== 0) {
    throw new Error(`${metodo}: ${cuerpo.respEstado.msgeRespuesta ?? cuerpo.respEstado.codError ?? 'error del SII'}`)
  }
  sesion.ultimoUsoEl = new Date()
  await sesion.save()
  return cuerpo
}


export class DescargaDiferida extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'DescargaDiferida'
  }
}

const ESTADOS = ['REGISTRO', 'PENDIENTE']
const periodoSii = (periodo) => String(periodo).replace('-', '') // '2026-08' → '202608'

export async function rcvResumen({ periodo, operacion = 'COMPRA', estadoContab = 'REGISTRO' }) {
  const s = await sesionUsable()
  const cuerpo = await llamar(
    'getResumen',
    {
      rutEmisor: s.rut,
      dvEmisor: s.dv,
      ptributario: periodoSii(periodo),
      estadoContab,
      operacion,
      busquedaInicial: true,
    },
    s,
  )
  return (cuerpo?.data ?? []).map((d) => ({
    tipoDoc: d.rsmnTipoDocInteger,
    nombreTipoDoc: d.dcvNombreTipoDoc,
    documentos: d.rsmnTotDoc ?? 0,
    netoClp: d.rsmnMntNeto ?? 0,
    ivaClp: d.rsmnMntIVA ?? 0,
    exentoClp: d.rsmnMntExe ?? 0,
    totalClp: d.rsmnMntTotal ?? 0,
    estadoContab,
    operacion,
  }))
}

export async function rcvDetalle({ periodo, operacion = 'COMPRA', codTipoDoc, estadoContab = 'REGISTRO' }) {
  const s = await sesionUsable()
  const esVenta = operacion === 'VENTA'
  const cuerpo = await llamar(
    esVenta ? 'getDetalleVenta' : 'getDetalleCompra',
    {
      rutEmisor: s.rut,
      dvEmisor: s.dv,
      ptributario: periodoSii(periodo),
      codTipoDoc: String(codTipoDoc),
      operacion,
      estadoContab,
      // placeholder literal: con sesión abierta el recaptcha no se valida. Si
      // algún día esto empieza a dar 403, mirar acá primero.
      accionRecaptcha: esVenta ? 'RCV_DETV' : 'RCV_DETC',
      tokenRecaptcha: 't-o-k-e-n-web',
    },
    s,
  )
  return (cuerpo?.data ?? []).map((d) => ({
    folio: d.detNroDoc,
    fecha: d.detFchDoc,
    rutEmisor: d.detRutDoc != null ? `${d.detRutDoc}-${d.detDvDoc}` : null,
    razonSocial: d.detRznSoc,
    netoClp: d.detMntNeto ?? 0,
    ivaClp: d.detMntIVA ?? 0,
    exentoClp: d.detMntExe ?? 0,
    totalClp: d.detMntTotal ?? 0,
    // campos propios de la liquidación factura. ML los deja en 0/null: por eso
    // el [520] del F29 NO se puede leer del RCV (ver liquidacionesDelPeriodo)
    comisionNetaClp: d.detLiqValComNeto ?? null,
    comisionIvaClp: d.detLiqValComIVA ?? null,
    evento: d.detEventoReceptorLeyenda ?? null,
    estadoContab,
    operacion,
  }))
}

// LO QUE EL F29 NECESITA, en una sola función.
//
// Las liquidaciones factura (tipo 43) viajan por los DOS registros y hay que
// mirar los dos estados:
//
//   VENTAS   → los montos de las ventas que ML hizo por cuenta tuya. De acá
//              salen [500] (cantidad) y [501] (IVA débito).
//   COMPRAS  → los mismos folios, para el lado del crédito. Vienen en CERO.
//
// Medido el 25-ago-2026 sobre agosto: 4 liquidaciones semanales por $607.543
// con $96.999 de IVA en ventas, y esos mismos 4 folios en compras — 2 en
// REGISTRO y 2 todavía en PENDIENTE. Consultar solo REGISTRO habría declarado
// 2 documentos donde son 4.
export const TIPO_LIQUIDACION_FACTURA = 43

export async function liquidacionesDelPeriodo(periodo) {
  const ventas = []
  const compras = []

  // EL RESUMEN PRIMERO, Y NO POR PROLIJIDAD. Pedir el detalle de una
  // combinación vacía hace que el SII responda con error (código 99), y ese
  // mismo código significa también "hay demasiadas filas, usa descarga
  // diferida". Preguntando antes cuántos documentos hay se evitan las dos
  // trampas: no se pide lo que no existe, y si el detalle vuelve corto se
  // puede gritar en vez de devolver un F29 en cero.
  //
  // Lo encontró la primera corrida contra el SII real: julio no tiene
  // liquidaciones (su documento fue un tipo 48) y la función entera reventaba.
  for (const operacion of ['VENTA', 'COMPRA']) {
    for (const estadoContab of ESTADOS) {
      const resumen = await rcvResumen({ periodo, operacion, estadoContab })
      const fila = resumen.find((r) => r.tipoDoc === TIPO_LIQUIDACION_FACTURA)
      if (!fila || !fila.documentos) continue

      const filas = await rcvDetalle({
        periodo,
        operacion,
        codTipoDoc: TIPO_LIQUIDACION_FACTURA,
        estadoContab,
      })
      if (filas.length < fila.documentos) {
        throw new DescargaDiferida(
          `el RCV declara ${fila.documentos} documento(s) en ${operacion}/${estadoContab} y el detalle entregó ${filas.length}: ` +
            'el período necesita descarga diferida y no se puede declarar con esto',
        )
      }
      ;(operacion === 'VENTA' ? ventas : compras).push(...filas)
    }
  }
  return resumirLiquidaciones({ periodo, ventas, compras })
}

// EL CRÉDITO DEL PERÍODO, que NO sale de las liquidaciones.
//
// Corrección del 25-ago-2026 tras leer la instrucción oficial del F29
// (instrucciones_f29_20241112.pdf, línea 28). El [519]/[520] NO es una línea
// del mandato: es la línea general de "facturas recibidas que dan derecho a
// crédito fiscal". La comisión del mandatario entra ahí solo si ML la cobra
// con una FACTURA — el propio instructivo lo dice para el lado del mandatario:
// "en caso de que el cobro de dicha comisión se realice a través de una
// factura, esta será tratada como el resto de las operaciones cuyo respaldo es
// una factura".
//
// Consecuencia práctica medida en agosto: las 4 liquidaciones tipo 43 llegan
// al registro de compras con los montos en CERO, así que no aportan crédito.
// Y no hay ninguna factura tipo 33 de ML. El crédito del período es CERO
// mientras ML no emita la factura de su comisión — y que las 2 liquidaciones
// pendientes pasen a REGISTRO no cambia eso: cambia su estado, no sus montos.
//
// Los tipos que sí dan crédito. 43 queda fuera a propósito: la liquidación
// factura declara su crédito por el [520] solo si trae comisión, y ML no la
// trae; contarla acá inflaría el casillero con documentos en cero.
export const TIPOS_CON_CREDITO = [30, 33, 34, 45, 46, 55, 56, 60, 61]

export async function comprasConCredito(periodo) {
  const filas = []
  for (const estadoContab of ESTADOS) {
    filas.push(...(await rcvResumen({ periodo, operacion: 'COMPRA', estadoContab })))
  }
  return resumirCredito({ periodo, filas })
}

// Pura: de las filas del resumen de compras a lo que va en el [519] y el [520].
export function resumirCredito({ periodo, filas = [] }) {
  const conCredito = filas.filter((f) => TIPOS_CON_CREDITO.includes(f.tipoDoc))
  return {
    periodo,
    documentos: conCredito.reduce((s, f) => s + (f.documentos ?? 0), 0),
    ivaCreditoClp: Math.round(conCredito.reduce((s, f) => s + (f.ivaClp ?? 0), 0)),
    netoClp: Math.round(conCredito.reduce((s, f) => s + (f.netoClp ?? 0), 0)),
    // lo que llegó pero NO da crédito por esta línea: sirve para explicar por
    // qué el casillero puede quedar en cero teniendo documentos en el registro
    sinCredito: filas
      .filter((f) => !TIPOS_CON_CREDITO.includes(f.tipoDoc))
      .map((f) => ({ tipoDoc: f.tipoDoc, nombre: f.nombreTipoDoc, documentos: f.documentos })),
  }
}

// Pura, para poder probarla sin red.
export function resumirLiquidaciones({ periodo, ventas = [], compras = [] }) {
  // UN FOLIO, UNA FILA. El mismo documento llega por los dos registros y cada
  // lado aporta algo distinto: los MONTOS vienen del de ventas (el de compras
  // los trae en cero) y el ESTADO de aceptación viene del de compras, que es
  // donde el documento está pendiente o registrado. Fusionar al revés —o dejar
  // que uno pise al otro— deja la tabla en cero y el [501] en nada.
  const porFolio = new Map()
  const tocar = (d) => {
    const k = String(d.folio)
    const prev = porFolio.get(k) ?? { folio: d.folio, fecha: d.fecha, razonSocial: d.razonSocial }
    porFolio.set(k, prev)
    return prev
  }
  for (const d of ventas) {
    if (d.folio == null) continue
    Object.assign(tocar(d), {
      fecha: d.fecha,
      razonSocial: d.razonSocial,
      netoClp: d.netoClp,
      ivaClp: d.ivaClp,
      totalClp: d.totalClp,
    })
  }
  for (const d of compras) {
    if (d.folio == null) continue
    const f = tocar(d)
    f.estadoContab = d.estadoContab
    f.evento = d.evento
    if ((d.comisionIvaClp ?? 0) > 0) f.comisionIvaClp = d.comisionIvaClp
  }

  const ivaDebitoClp = ventas.reduce((s, d) => s + (d.ivaClp ?? 0), 0)
  const netoVentasClp = ventas.reduce((s, d) => s + (d.netoClp ?? 0), 0)
  const totalVentasClp = ventas.reduce((s, d) => s + (d.totalClp ?? 0), 0)
  // si algún día ML puebla la comisión, el [520] sale solo de acá
  const conComision = compras.filter((d) => (d.comisionIvaClp ?? 0) > 0)
  const ivaComisionClp = conComision.reduce((s, d) => s + (d.comisionIvaClp ?? 0), 0)

  return {
    periodo,
    // [500] y [519]: los folios distintos, no las filas — un mismo documento
    // aparece en ventas y en compras y contarlo dos veces infla el casillero
    documentos: porFolio.size,
    ivaDebitoClp: Math.round(ivaDebitoClp),
    netoVentasClp: Math.round(netoVentasClp),
    totalVentasClp: Math.round(totalVentasClp),
    ivaComisionClp: conComision.length ? Math.round(ivaComisionClp) : null,
    comisionEnElDocumento: conComision.length > 0,
    // los que ML emitió y todavía no entran al registro: su crédito no está
    // firme, y son justamente los del final del mes
    pendientes: [...porFolio.values()].filter((d) => d.estadoContab === 'PENDIENTE').length,
    detalle: [...porFolio.values()]
      .map((d) => ({
        folio: d.folio,
        fecha: d.fecha,
        razonSocial: d.razonSocial ?? null,
        netoClp: d.netoClp ?? 0,
        ivaClp: d.ivaClp ?? 0,
        totalClp: d.totalClp ?? 0,
        estadoContab: d.estadoContab ?? null,
      }))
      .sort((a, b) => Number(b.folio) - Number(a.folio)),
    leidoEl: new Date(),
  }
}
