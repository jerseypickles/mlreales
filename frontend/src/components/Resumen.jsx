import { StatTile } from './ui.jsx'
import { HistogramaPrecios } from './graficos.jsx'
import { fmtNum, fmtPrecio, fmtPct } from '../lib/formato.js'

export function Resumen({ reporte, productos }) {
  const m = reporte.metricas
  const precios = (productos ?? []).map((p) => p.precio)

  return (
    <div>
      <div className="tiles">
        {m.scoreOportunidad != null ? (
          <StatTile
            destacado
            label="Score oportunidad"
            value={m.scoreOportunidad}
            detalle={`demanda ${m.oportunidad.componentes.demanda} · competencia ${m.oportunidad.componentes.competencia} · calidad ${m.oportunidad.componentes.calidad} · full ${m.oportunidad.componentes.full}`}
          />
        ) : null}
        {m.demanda ? (
          <StatTile
            label="Ventas estimadas/día"
            value={m.demanda.ventasEstimadasPorDia ?? '—'}
            detalle={
              m.demanda.ventasEstimadasPorDia == null
                ? 'el delta requiere 2 scans con detalle'
                : m.demanda.base === 'reviews'
                  ? 'proxy: reseñas nuevas × factor'
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
      </div>

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
                    <th className="num">Items</th>
                    <th className="num">% top 50</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.topSellers.map((s) => (
                    <tr key={s.vendedor}>
                      <td>{s.vendedor}</td>
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
