import { useId, useMemo, useState } from 'react'
import { fmtNum, fmtPrecio, fmtFechaCorta } from '../lib/formato.js'

// Histograma de precios: un solo matiz secuencial; el bin dominante en el paso fuerte.
// Tooltip por barra al hover (regla dataviz: capa de hover por defecto).
export function HistogramaPrecios({ precios, bandaDominante, alto = 150 }) {
  const [activo, setActivo] = useState(null)
  const tituloId = useId()

  const bins = useMemo(() => {
    const valores = (precios ?? []).filter(Number.isFinite).sort((a, b) => a - b)
    if (valores.length < 3) return null
    const min = valores[0]
    const max = valores[valores.length - 1]
    if (min === max) return null
    const numBins = Math.min(14, Math.max(6, Math.round(Math.sqrt(valores.length) * 1.5)))
    const ancho = (max - min) / numBins
    const cuentas = new Array(numBins).fill(0)
    for (const v of valores) cuentas[Math.min(numBins - 1, Math.floor((v - min) / ancho))]++
    return { min, max, ancho, cuentas, total: valores.length }
  }, [precios])

  if (!bins) return null

  const maxCuenta = Math.max(...bins.cuentas)
  const anchoBarra = 100 / bins.cuentas.length
  const esDominante = (i) => {
    if (!bandaDominante) return false
    const desde = bins.min + i * bins.ancho
    const hasta = desde + bins.ancho
    return desde < bandaDominante.hasta && hasta > bandaDominante.desde
  }

  return (
    <figure className="grafico" role="img" aria-labelledby={tituloId}>
      <figcaption id={tituloId}>Distribución de precios del top 50</figcaption>
      <div className="grafico-area" style={{ height: alto }}>
        <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
          {bins.cuentas.map((cuenta, i) => {
            const h = maxCuenta ? (cuenta / maxCuenta) * 92 : 0
            return (
              <rect
                key={i}
                x={i * anchoBarra + 0.6}
                y={100 - h}
                width={anchoBarra - 1.2}
                height={h}
                rx="0.8"
                className={esDominante(i) ? 'barra dominante' : 'barra'}
                onMouseEnter={() => setActivo(i)}
                onMouseLeave={() => setActivo(null)}
              />
            )
          })}
        </svg>
        {activo != null ? (
          <div className="tooltip" style={{ left: `${(activo + 0.5) * anchoBarra}%` }}>
            <strong>{bins.cuentas[activo]}</strong> productos
            <br />
            {fmtPrecio(Math.round(bins.min + activo * bins.ancho))} –{' '}
            {fmtPrecio(Math.round(bins.min + (activo + 1) * bins.ancho))}
          </div>
        ) : null}
      </div>
      <div className="grafico-eje">
        <span>{fmtPrecio(bins.min)}</span>
        {bandaDominante ? (
          <span className="eje-destacado">
            banda dominante {fmtPrecio(bandaDominante.desde)}–{fmtPrecio(bandaDominante.hasta)}
          </span>
        ) : null}
        <span>{fmtPrecio(bins.max)}</span>
      </div>
    </figure>
  )
}

// Serie temporal pequeña (precio / posición / reseñas de un producto):
// una sola serie por gráfico (regla: nunca doble eje), crosshair + tooltip al hover.
export function MiniSerie({ titulo, puntos, formato = fmtNum, invertirY = false, alto = 90 }) {
  const [idx, setIdx] = useState(null)
  const tituloId = useId()

  const datos = useMemo(() => {
    const validos = (puntos ?? []).filter((p) => Number.isFinite(p.valor))
    if (validos.length < 2) return null
    const valores = validos.map((p) => p.valor)
    let min = Math.min(...valores)
    let max = Math.max(...valores)
    if (min === max) {
      min -= 1
      max += 1
    }
    const margen = (max - min) * 0.12
    min -= margen
    max += margen
    const coords = validos.map((p, i) => {
      const x = (i / (validos.length - 1)) * 100
      let y = ((p.valor - min) / (max - min)) * 88 + 6
      if (!invertirY) y = 100 - y
      return { x, y, ...p }
    })
    return { coords, path: coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ') }
  }, [puntos, invertirY])

  if (!datos) {
    return (
      <figure className="grafico">
        <figcaption>{titulo}</figcaption>
        <p className="grafico-vacio">se necesitan ≥ 2 scans</p>
      </figure>
    )
  }

  const activo = idx != null ? datos.coords[idx] : null

  function alMover(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    let mejor = 0
    for (let i = 1; i < datos.coords.length; i++) {
      if (Math.abs(datos.coords[i].x - x) < Math.abs(datos.coords[mejor].x - x)) mejor = i
    }
    setIdx(mejor)
  }

  return (
    <figure className="grafico" role="img" aria-labelledby={tituloId}>
      <figcaption id={tituloId}>{titulo}</figcaption>
      <div
        className="grafico-area"
        style={{ height: alto }}
        onMouseMove={alMover}
        onMouseLeave={() => setIdx(null)}
      >
        <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
          {activo ? <line x1={activo.x} y1="0" x2={activo.x} y2="100" className="crosshair" /> : null}
          <path d={datos.path} className="linea" vectorEffect="non-scaling-stroke" fill="none" />
          {datos.coords.map((c, i) => (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={i === idx ? 2.6 : 1.6}
              className="punto"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {activo ? (
          <div className="tooltip" style={{ left: `${activo.x}%` }}>
            <strong>{formato(activo.valor)}</strong>
            <br />
            {fmtFechaCorta(activo.fecha)}
            {activo.nota ? (
              <>
                <br />
                <span className="tooltip-nota">{activo.nota}</span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="grafico-eje">
        <span>{fmtFechaCorta(datos.coords[0].fecha)}</span>
        <span>{fmtFechaCorta(datos.coords.at(-1).fecha)}</span>
      </div>
    </figure>
  )
}
