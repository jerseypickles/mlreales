import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { fmtNum, fmtPrecio } from '../lib/formato.js'

const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 10) / 10}%` : '—')

// Product Ads de la cuenta: campañas con ACOS vs objetivo y atribución por
// producto (pagado vs orgánico). Lectura por API oficial, ventana móvil.
export function Publicidad() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [dias, setDias] = useState(30)

  useEffect(() => {
    let vigente = true
    setDatos(null)
    api
      .ads(dias)
      .then((d) => vigente && setDatos(d))
      .catch((e) => vigente && setError(e.message))
    return () => {
      vigente = false
    }
  }, [dias])

  if (error) return <main><p className="error-inline">{error}</p></main>
  if (!datos) return <Cargando texto="Leyendo campañas de Product Ads…" />

  const items = Object.entries(datos.porItem ?? {})

  return (
    <main>
      <div className="reporte-encabezado">
        <div>
          <h2>Publicidad · Product Ads</h2>
          <p className="reporte-fecha">
            La primera etapa paga reputación: reseñas y ranking. La regla de escala: ACOS bajo el margen del
            producto = subir presupuesto; sobre el margen = bajar puja o precio arriba.
          </p>
        </div>
        <div className="toolbar">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              className={d === dias ? 'boton-primario' : 'boton-secundario'}
              onClick={() => setDias(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {datos.campanas.map((c) => {
        const m = c.metricas ?? {}
        const sobreObjetivo = Number.isFinite(m.acos) && Number.isFinite(c.acosObjetivo) && m.acos > c.acosObjetivo
        return (
          <article key={c.id} className="propio-card">
            <div className="propio-encabezado">
              <div className="propio-titular">
                <h3>
                  {c.nombre}{' '}
                  <span className={c.estado === 'active' ? 'badge badge-full' : 'badge badge-neutro'}>
                    {c.estado === 'active' ? 'activa' : c.estado}
                  </span>
                </h3>
                <p className="propio-sub">
                  presupuesto {fmtPrecio(c.presupuestoDiario)}/día · estrategia {c.estrategia ?? '—'} · ACOS
                  objetivo {pct(c.acosObjetivo)}
                </p>
              </div>
            </div>
            <div className="propio-metricas">
              <span className={sobreObjetivo ? 'propio-metrica propio-metrica-alerta' : 'propio-metrica'}>
                <span className="propio-metrica-etiqueta">ACOS real</span>
                <span className="propio-metrica-valor">{pct(m.acos)}</span>
              </span>
              <span className="propio-metrica">
                <span className="propio-metrica-etiqueta">Inversión</span>
                <span className="propio-metrica-valor">{fmtPrecio(m.cost)}</span>
              </span>
              <span className="propio-metrica">
                <span className="propio-metrica-etiqueta">Ingresos atribuidos</span>
                <span className="propio-metrica-valor">{fmtPrecio(m.total_amount)}</span>
              </span>
              <span className="propio-metrica">
                <span className="propio-metrica-etiqueta">Unidades</span>
                <span className="propio-metrica-valor">{fmtNum(m.units_quantity)}</span>
              </span>
              <span className="propio-metrica">
                <span className="propio-metrica-etiqueta">Clics</span>
                <span className="propio-metrica-valor">{fmtNum(m.clicks)}</span>
              </span>
              <span className="propio-metrica">
                <span className="propio-metrica-etiqueta">Impresiones</span>
                <span className="propio-metrica-valor">{fmtNum(m.prints)}</span>
              </span>
              <span className="propio-metrica">
                <span className="propio-metrica-etiqueta">CPC</span>
                <span className="propio-metrica-valor">{fmtPrecio(m.cpc)}</span>
              </span>
            </div>
            {sobreObjetivo ? (
              <p className="propio-sub">
                ⚠️ ACOS sobre el objetivo: cada venta pagada cuesta {pct(m.acos)} del ingreso. Palancas: subir
                precio del producto, bajar ACOS objetivo, o depurar los items de peor conversión.
              </p>
            ) : null}
          </article>
        )
      })}

      {items.length ? (
        <section>
          <h3>Por producto (pagado vs orgánico)</h3>
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Clics</th>
                  <th className="num">Costo</th>
                  <th className="num">ACOS</th>
                  <th className="num">U. pagadas</th>
                  <th className="num">U. orgánicas</th>
                  <th className="num">Ingreso atribuido</th>
                </tr>
              </thead>
              <tbody>
                {items.map(([id, ad]) => {
                  const m = ad.metricas ?? {}
                  const pagadas = (m.direct_units_quantity ?? 0) + (m.indirect_units_quantity ?? 0)
                  return (
                    <tr key={id}>
                      <td>{ad.titulo ?? id}</td>
                      <td className="num">{fmtNum(m.clicks)}</td>
                      <td className="num">{fmtPrecio(m.cost)}</td>
                      <td className="num">{pct(m.acos)}</td>
                      <td className="num">{fmtNum(pagadas)}</td>
                      <td className="num">{fmtNum(m.organic_units_quantity)}</td>
                      <td className="num">{fmtPrecio(m.total_amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  )
}
