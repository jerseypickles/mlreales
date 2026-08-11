import { VentaMl } from '../models/VentaMl.js'
import { meliGet, hayCuentaMeli } from './meli.js'

// LA BOLETA REAL de cada venta, no una reconstrucción.
//
// Sondeado el 10-ago-2026: en las ventas Full el documento tributario lo emite
// MercadoLibre Chile LTDA (RUT 77.398.220-1) con sus propios folios, pero
// lleva el mensaje legal "Por cuenta y orden de <razón social del vendedor>".
// Es emisión por cuenta de terceros: la venta es del vendedor y el débito
// fiscal es suyo — ML es el mandatario que materialmente emite.
//
// Por eso vale la pena traerla: el documento trae el desglose fiscal exacto
// (piva/viva/biva), y con eso la posición de IVA deja de depender de dividir
// por 1,19 y pasa a ser la suma de lo que el SII efectivamente recibió.

const PAUSA_MS = 350 // una llamada por orden; sin apuro, corre en el scan diario

const numero = (v) => (Number.isFinite(v) ? Math.round(v) : null)

// Pura: del JSON de /users/:uid/invoices/orders/:orderId a lo que guardamos.
export function normalizarBoleta(f) {
  if (!f?.id) return null
  const monto = (nombre, campo) =>
    f.fiscal_data?.fiscal_amounts?.find((a) => a.name === nombre)?.attributes?.[campo]

  // el mandato viaja como mensaje complementario del documento; es la prueba
  // de que la venta se factura por cuenta del vendedor y no por cuenta de ML
  const mandato = (f.fiscal_data?.messages ?? []).find((m) => /por cuenta y orden/i.test(m?.content ?? ''))

  return {
    invoiceId: String(f.id),
    tipo: f.attributes?.document_type ?? null, // BOLETA | FACTURA
    serie: f.invoice_series ?? null,
    folio: f.invoice_number ?? null,
    estado: f.status ?? null,
    emitidaEl: f.issued_date ? new Date(f.issued_date) : null,
    emisorNombre: f.issuer?.name ?? null,
    emisorRut: f.issuer?.identifications?.rut ?? null,
    porCuentaDe: mandato?.content?.replace(/^Por cuenta y orden de\s*/i, '').replace(/\.+$/, '') ?? null,
    netoClp: numero(monto('AMOUNTS', 'net_value')),
    ivaClp: numero(monto('IVA', 'viva')),
    ivaPct: monto('IVA', 'piva') ?? null,
    brutoClp: numero(monto('AMOUNTS', 'gross_value') ?? f.amount),
    receptorRut: f.recipient?.identifications?.rut ?? null,
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

// Trae la boleta de las ventas que todavía no la tienen. Idempotente: una vez
// guardada no se vuelve a pedir (el documento no cambia salvo anulación, que
// llega como una nota de crédito aparte).
export async function sincronizarBoletas({ dias = 60, max = 200 } = {}) {
  if (!(await hayCuentaMeli())) return { omitido: true }
  const me = await meliGet('/users/me')
  const desde = new Date(Date.now() - dias * 86_400e3)

  const pendientes = await VentaMl.find({ fecha: { $gte: desde }, 'boleta.invoiceId': { $exists: false } })
    .sort({ fecha: -1 })
    .limit(max)

  let traidas = 0
  let sinDocumento = 0
  const errores = []
  for (const venta of pendientes) {
    try {
      const f = await meliGet(`/users/${me.id}/invoices/orders/${venta.orderId}`)
      const boleta = normalizarBoleta(f)
      if (!boleta) {
        sinDocumento++
        continue
      }
      // Mixed: asignar el objeto no siempre marca el path como sucio, y un
      // save() silencioso que no persiste es el peor de los fallos — no avisa
      venta.boleta = boleta
      venta.markModified('boleta')
      await venta.save()
      traidas++
    } catch (err) {
      // 404 = la orden todavía no tiene documento emitido (ML lo emite con
      // algo de retraso). No es error: se reintenta en la próxima pasada.
      if (!/404/.test(err.message)) errores.push(`${venta.orderId}: ${err.message}`)
      sinDocumento++
    }
    await esperar(PAUSA_MS)
  }
  if (errores.length) console.warn(`[boletas] ${errores.length} con error: ${errores.slice(0, 3).join(' | ')}`)
  return { pendientes: pendientes.length, traidas, sinDocumento, errores: errores.slice(0, 5) }
}
