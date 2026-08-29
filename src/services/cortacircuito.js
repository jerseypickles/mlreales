import { ProveedorEstado } from '../models/ProveedorEstado.js'

// CUANDO EL PROVEEDOR ESTÁ CAÍDO, DEJAR DE GOLPEARLO.
//
// El 29-ago-2026 la cuenta de Zyte se suspendió por crédito agotado. El sistema
// trató ese 403 como cualquier otro error: tres intentos con backoff POR CADA
// NICHO, sobre 82 nichos activos. Unas 246 peticiones contra una cuenta muerta,
// reintentando algo que ningún reintento puede arreglar, y 40 minutos de scans
// perdidos sin que nadie se enterara hasta que el importador preguntó.
//
// La distinción que faltaba: hay errores TRANSITORIOS —un 520, un timeout, una
// página que vino a medias— donde reintentar es exactamente lo correcto, y hay
// errores FATALES —cuenta suspendida, credenciales malas, cuota agotada— donde
// reintentar es ruido. Y los fatales son GLOBALES: si le pasa a un nicho, le
// pasa a los 82.
//
// Esto es código nuestro, no del proveedor. Sirve igual el día que cambiemos.

// Reintentar estos es tirar peticiones a la basura.
const SENALES_FATALES = [
  'account-suspended',
  'account_suspended',
  'over-quota',
  'quota exceeded',
  'payment required',
  'subscription',
  'unauthorized',
  'forbidden: invalid key',
]

// Pura. ¿Este error es del tipo que no se arregla reintentando?
export function esFatal(err) {
  const status = err?.status ?? null
  const texto = String(err?.message ?? err ?? '').toLowerCase()
  // 401/402 son siempre de cuenta; el 403 depende de si viene de la cuenta o
  // del sitio destino, así que se mira el texto
  if (status === 401 || status === 402) return true
  return SENALES_FATALES.some((s) => texto.includes(s))
}

// Pura. Cuánto lleva abierto, para decidir si vale reintentar solo.
export function debeReintentar(estado, { ahora = Date.now(), esperaMs = 15 * 60_000 } = {}) {
  if (!estado?.abierto) return true
  const desde = estado.desdeEl ? new Date(estado.desdeEl).getTime() : 0
  // pasada la espera se deja pasar UNA petición de prueba: si el importador ya
  // pagó, el sistema se recupera solo sin esperar a que alguien lo note
  return ahora - desde >= esperaMs
}

export async function abrir(proveedor, motivo) {
  await ProveedorEstado.updateOne(
    { proveedor },
    { $set: { abierto: true, motivo: String(motivo).slice(0, 300), desdeEl: new Date() } },
    { upsert: true },
  )
  console.error(`[cortacircuito] ${proveedor} CAÍDO: ${motivo}`)
}

export async function cerrar(proveedor) {
  const previo = await ProveedorEstado.findOne({ proveedor }).lean()
  if (!previo?.abierto) return
  await ProveedorEstado.updateOne({ proveedor }, { $set: { abierto: false, cerradoEl: new Date() } })
  console.log(`[cortacircuito] ${proveedor} se recuperó`)
}

export async function estado(proveedor) {
  return ProveedorEstado.findOne({ proveedor }).lean()
}

export class ProveedorCaido extends Error {
  constructor(proveedor, motivo) {
    super(`${proveedor} está caído: ${motivo}. No se reintenta hasta que se recupere.`)
    this.name = 'ProveedorCaido'
    this.fatal = true
  }
}

// Envuelve una llamada al proveedor. Si el cortacircuito está abierto y todavía
// no toca la prueba, falla al tiro sin gastar una petición.
export async function conCortacircuito(proveedor, fn) {
  const st = await estado(proveedor).catch(() => null)
  if (st?.abierto && !debeReintentar(st)) {
    throw new ProveedorCaido(proveedor, st.motivo)
  }
  try {
    const r = await fn()
    if (st?.abierto) await cerrar(proveedor).catch(() => {})
    return r
  } catch (err) {
    if (esFatal(err)) await abrir(proveedor, err.message).catch(() => {})
    throw err
  }
}
