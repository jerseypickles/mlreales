export function StatTile({ label, value, detalle, destacado = false }) {
  return (
    <div className={destacado ? 'tile tile-destacado' : 'tile'}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {detalle ? <div className="tile-detalle">{detalle}</div> : null}
    </div>
  )
}

// Anillo de score 0-100 coloreado por banda (verde ≥70, ámbar ≥50, gris bajo)
export function ScoreRing({ valor, size = 32, grosor = 4 }) {
  if (!Number.isFinite(valor)) return null
  const radio = (size - grosor) / 2
  const circ = 2 * Math.PI * radio
  const frac = Math.max(0, Math.min(100, valor)) / 100
  const banda = valor >= 70 ? 'score-alto' : valor >= 50 ? 'score-medio' : 'score-bajo'
  return (
    <span className={`aro ${banda}`} style={{ width: size, height: size }} role="img" aria-label={`score ${valor} de 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="aro-riel" cx={size / 2} cy={size / 2} r={radio} strokeWidth={grosor} fill="none" />
        <circle
          className="aro-valor"
          cx={size / 2}
          cy={size / 2}
          r={radio}
          strokeWidth={grosor}
          fill="none"
          strokeDasharray={`${circ * frac} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="aro-num" style={{ fontSize: Math.round(size * (size > 60 ? 0.28 : 0.36)) }}>
        {valor}
      </span>
    </span>
  )
}

export function MarcaIcono() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" opacity="0.35" />
      <circle cx="12" cy="12" r="5" opacity="0.6" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 3 A9 9 0 0 1 21 12" />
    </svg>
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
