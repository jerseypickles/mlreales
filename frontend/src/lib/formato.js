const CLP = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
})
const NUM = new Intl.NumberFormat('es-CL')

export const fmtPrecio = (v) => (Number.isFinite(v) ? CLP.format(v) : '—')
export const fmtNum = (v) => (Number.isFinite(v) ? NUM.format(v) : '—')
export const fmtPct = (v) => (Number.isFinite(v) ? `${v}%` : '—')
export const fmtFecha = (iso) =>
  iso ? new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
export const fmtFechaCorta = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : '—'
