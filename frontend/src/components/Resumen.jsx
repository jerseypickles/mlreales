import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { StatTile, ScoreRing, RepSeller } from './ui.jsx'
import { HistogramaPrecios, MiniSerie } from './graficos.jsx'
import { fmtNum, fmtPrecio, fmtPct } from '../lib/formato.js'

// cada componente mide ESPACIO PARA ENTRAR, no bondad del nicho: calidad 0 =
// ratings altos (no te diferencias por producto), calidad 100 = ratings
// mediocres con volumen (entra con algo mejor)
const COMPONENTES_SCORE = [
  ['demanda', 'Demanda', 'Volumen de ventas estimado del top (reseñas × factor)'],
  ['competencia', 'Competencia', 'Espacio fuera del top 3 de sellers: 0 = mercado concentrado'],
  ['calidad', 'Calidad', 'Espacio para diferenciarte por producto: 0 = todos tienen rating ≥4.4 (se compite por precio/Full), 100 = ratings mediocres con volumen'],
  ['full', 'Full', 'Espacio sin Mercado Envíos Full: 0 = todos usan Full'],
]

function ScoreHero({ score, componentes }) {
  return (
    <div className="score-hero">
      <ScoreRing valor={score} size={104} grosor={10} />
      <div className="score-hero-info">
        <span className="score-hero-label">Score de oportunidad</span>
        <div className="score-barras">
          {COMPONENTES_SCORE.map(([clave, etiqueta, ayuda]) => (
            <div className="score-barra" key={clave} title={ayuda}>
              <span className="score-barra-label">{etiqueta}</span>
              <span className="score-barra-riel" aria-hidden="true">
                <span style={{ width: `${componentes[clave] ?? 0}%` }} />
              </span>
              <span className="score-barra-num">{componentes[clave] ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const ACELERACION = {
  acelerando: { texto: '▲ demanda acelerando', clase: 'acel-sube' },
  estable: { texto: '● demanda estable', clase: 'acel-estable' },
  frenando: { texto: '▼ demanda frenando', clase: 'acel-baja' },
}

export function Resumen({ reporte, productos, nichoId, nicho }) {
  const m = reporte.metricas
  const precios = (productos ?? []).map((p) => p.precio)
  const [tendencia, setTendencia] = useState(null)

  useEffect(() => {
    let vigente = true
    if (nichoId) {
      api
        .tendencia(nichoId)
        .then((t) => vigente && setTendencia(t))
        .catch(() => {})
    }
    return () => {
      vigente = false
    }
  }, [nichoId])

  const serie = (campo) =>
    (tendencia?.puntos ?? []).map((p) => ({ fecha: p.fecha, valor: p[campo] }))
  // ventas/día con la canasta de cada punto en el tooltip: dos puntos con
  // canastas muy distintas no son comparables entre sí (composición ≠ demanda)
  const serieVentas = (tendencia?.puntos ?? []).map((p) => ({
    fecha: p.fecha,
    valor: p.ventasDia,
    nota:
      p.canasta != null
        ? `canasta: ${p.canasta} comparables${p.saltosFiltrados ? ` · ${p.saltosFiltrados} saltos filtrados` : ''}`
        : null,
  }))
  const acel = tendencia?.aceleracion ? ACELERACION[tendencia.aceleracion] : null

  // categoría real dominante entre los productos medidos (breadcrumbs del nivel 2)
  const rutas = (productos ?? []).map((p) => p.categoriaRuta).filter(Boolean)
  const categoria = rutas.length
    ? [...rutas.reduce((m2, r) => m2.set(r, (m2.get(r) ?? 0) + 1), new Map()).entries()].sort(
        (a, b) => b[1] - a[1],
      )[0][0]
    : null

  return (
    <div>
      {categoria ? <p className="categoria-nicho">{categoria}</p> : null}
      {m.scoreOportunidad != null ? (
        <ScoreHero score={m.scoreOportunidad} componentes={m.oportunidad.componentes} />
      ) : null}
      <div className="tiles">
        {m.demanda ? (
          <StatTile
            label="Ventas estimadas/día"
            value={m.demanda.ventasEstimadasPorDia ?? '—'}
            detalle={
              m.demanda.ventasEstimadasPorDia == null
                ? 'el delta requiere 2 scans con detalle'
                : m.demanda.base === 'reviews'
                  ? `reseñas nuevas × factor · canasta ${m.demanda.reviews?.itemsComparables ?? '—'}${
                      (m.demanda.reviews?.saltosFiltrados ?? 0) + (m.demanda.reviews?.duplicadosCatalogo ?? 0) > 0
                        ? ` · ${(m.demanda.reviews.saltosFiltrados ?? 0) + (m.demanda.reviews.duplicadosCatalogo ?? 0)} saltos de catálogo filtrados`
                        : ''
                    }`
                  : 'desde vendidos'
            }
          />
        ) : null}
        {m.demanda?.reviews ? (
          <StatTile
            label="Reseñas top 50"
            value={fmtNum(m.demanda.reviews.total)}
            detalle={`mediana ${fmtNum(m.demanda.reviews.mediana)} por producto`}
          />
        ) : null}
        <StatTile
          label="Precio mediana"
          value={fmtPrecio(m.precio.mediana)}
          detalle={`p25 ${fmtPrecio(m.precio.p25)} · p75 ${fmtPrecio(m.precio.p75)}`}
        />
        <StatTile
          label="Descuento promedio"
          value={fmtPct(m.precio.descuentoPromedioPct)}
          detalle={`${fmtPct(m.precio.pctConDescuento)} de items con descuento`}
        />
        <StatTile
          label="Sellers únicos"
          value={fmtNum(m.competencia.sellersUnicos)}
          detalle={`concentración top 3: ${fmtPct(m.competencia.concentracionTop3Pct)}`}
        />
        <StatTile label="Tiendas oficiales" value={fmtPct(m.competencia.pctTiendaOficial)} detalle="del top 50" />
        <StatTile
          label="Items con Full"
          value={fmtPct(m.competencia.pctFull)}
          detalle={`envío rápido: ${fmtPct(m.competencia.pctEnvioRapido)}`}
        />
        <StatTile
          label="Rating promedio"
          value={m.calidad.ratingPromedio ?? '—'}
          detalle={`${fmtPct(m.calidad.pctConRating)} con rating`}
        />
        <StatTile
          label="Resultados en ML"
          value={`${fmtNum(m.universo.totalResultadosBusqueda)}${m.universo.totalEsMinimo ? '+' : ''}`}
          detalle={`${fmtNum(m.universo.productosAnalizados)} analizados`}
        />
        {nicho?.costoUsd ? (
          <StatTile
            label="Costo de esta inteligencia"
            value={`US$ ${nicho.costoUsd}`}
            detalle="Apify + IA acumulado del nicho"
          />
        ) : null}
      </div>

      {tendencia && tendencia.puntos.length >= 2 ? (
        <section>
          <div className="tendencia-encabezado">
            <h3>Evolución del nicho</h3>
            {acel ? <span className={`acel ${acel.clase}`}>{acel.texto}</span> : null}
          </div>
          <div className="fila-3col">
            <MiniSerie titulo="Score de oportunidad" puntos={serie('score')} />
            <MiniSerie titulo="Ventas/día estimadas (delta depurado)" puntos={serieVentas} />
            <MiniSerie titulo="Precio mediana" puntos={serie('mediana')} formato={fmtPrecio} />
          </div>
        </section>
      ) : null}

      <section className="fila-2col">
        <HistogramaPrecios precios={precios} bandaDominante={m.precio.bandaDominante} />
        <div>
          <h3>Top sellers</h3>
          {reporte.topSellers?.length ? (
            <div className="tabla-envoltura">
              <table>
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th>Reputación</th>
                    <th className="num">Items</th>
                    <th className="num">% top 50</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.topSellers.map((s) => (
                    <tr key={s.vendedor}>
                      <td>{s.vendedor}</td>
                      <td>
                        <RepSeller reputacion={s.reputacion} powerSeller={s.powerSeller} />
                      </td>
                      <td className="num">{s.items}</td>
                      <td className="num">{fmtPct(s.pctItems)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="vacio">Sin datos de sellers aún.</p>
          )}
        </div>
      </section>
    </div>
  )
}
