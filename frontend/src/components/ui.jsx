export function StatTile({ label, value, detalle, destacado = false }) {
  return (
    <div className={destacado ? 'tile tile-destacado' : 'tile'}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {detalle ? <div className="tile-detalle">{detalle}</div> : null}
    </div>
  )
}

// tipo: 'full' | 'oficial' | 'cn' | 'neutro'
export function Badge({ tipo = 'neutro', children, title }) {
  return (
    <span className={`badge badge-${tipo}`} title={title}>
      {children}
    </span>
  )
}

export function IconoExterno() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

export function Cargando({ texto = 'Cargando…' }) {
  return <p className="vacio">{texto}</p>
}
