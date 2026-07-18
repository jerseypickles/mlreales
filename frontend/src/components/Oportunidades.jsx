import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Cargando, ScoreRing } from './ui.jsx'
import { fmtNum, fmtPrecio, fmtFecha } from '../lib/formato.js'

const FLECHA = { sube: ['↑', 'delta-sube'], baja: ['↓', 'delta-baja'], estable: ['→', 'delta-neutra'] }

function Hecho({ etiqueta, children }) {
  if (children == null || children === '') return null
  return (
    <span className="op-hecho">
      <span className="op-hecho-etiqueta">{etiqueta}</span> {children}
    </span>
  )
}

function CartaOportunidad({ o, rank, onAbrir, mismaCompraQue }) {
  const flecha = o.tendenciaVentas ? FLECHA[o.tendenciaVentas] : null
  return (
    <article
      className="op-carta"
      onClick={() => onAbrir(o.nichoId)}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if (e.key === 'Enter') onAbrir(o.nichoId)
      }}
    >
      <div className="op-lateral">
        <span className="op-rank">#{rank}</span>
        {o.score != null ? <ScoreRing valor={o.score} size={44} grosor={4.5} /> : null}
      </div>

      <div className="op-cuerpo">
        <div className="op-encabezado">
          <h3 className="op-keyword">{o.keyword}</h3>
          <span className={`veredicto veredicto-${o.veredicto}`}>{o.veredicto.replace(/_/g, ' ')}</span>
          {o.confianza ? (
            <span className={`op-confianza op-confianza-${o.confianza}`} title="Confianza del análisis">
              confianza {o.confianza}
            </span>
          ) : null}
          {o.tramites.map((t) => (
            <span key={t} className="op-tramite" title="Requiere trámite de importación">
              ⚠ {t}
            </span>
          ))}
          {o.etapaCompra && o.etapaCompra !== 'evaluando' ? (
            <span className="op-confianza op-confianza-alta" title="Etapa del embudo de compra">
              {o.etapaCompra}
            </span>
          ) : null}
          {o.listingListo ? <span className="op-listing" title="Borrador de listing generado">listing ✓</span> : null}
          {mismaCompraQue ? (
            <span
              className="op-listing"
              title="Mismo producto de fábrica: un solo pedido a China cubre ambos nichos; lo que cambia es la jugada de listing"
            >
              🔁 misma compra que "{mismaCompraQue}"
            </span>
          ) : null}
        </div>

        {o.titular ? <p className="op-titular">{o.titular}</p> : null}

        <div className="op-hechos">
          <Hecho etiqueta="vender a">{o.precioVentaClp ? fmtPrecio(o.precioVentaClp) : null}</Hecho>
          <Hecho etiqueta="EXW máx">{o.exwMaximoUsd != null ? `US$ ${o.exwMaximoUsd}` : null}</Hecho>
          <Hecho etiqueta="demanda">
            {o.ventasDia != null ? (
              <>
                ~{fmtNum(Math.round(o.ventasDia))} ventas/día{' '}
                {flecha ? <span className={`delta ${flecha[1]}`}>{flecha[0]}</span> : null}
              </>
            ) : null}
          </Hecho>
          <Hecho etiqueta="mediana">{o.mediana ? fmtPrecio(o.mediana) : null}</Hecho>
          <Hecho etiqueta="Full">{o.pctFull != null ? `${Math.round(o.pctFull)}%` : null}</Hecho>
          <Hecho etiqueta="sellers">{o.sellersUnicos != null ? fmtNum(o.sellersUnicos) : null}</Hecho>
        </div>

        {o.condiciones ? <p className="op-condicion">condición: {o.condiciones}</p> : null}

        <div className="op-pie">
          {o.primeraCompra ? (
            <span>
              1ª compra: {o.primeraCompra}
              {o.inversionEstimadaUsd != null ? ` (~US$ ${fmtNum(o.inversionEstimadaUsd)})` : ''}
            </span>
          ) : null}
          {o.ventanaImportacion ? <span>ventana: {o.ventanaImportacion}</span> : null}
          {o.estacionalidad?.tipo === 'todo_el_año' ? <span>demanda todo el año</span> : null}
          {o.fechaScan ? <span>scan {fmtFecha(o.fechaScan)}</span> : null}
        </div>
      </div>
    </article>
  )
}

export function Oportunidades({ onAbrirNicho }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true
    api
      .oportunidades()
      .then((d) => vigente && setDatos(d))
      .catch((err) => vigente && setError(err.message))
    return () => {
      vigente = false
    }
  }, [])

  if (error) return <main><p className="error-bloque">Error: {error}</p></main>
  if (!datos) return <main><Cargando texto="Cargando oportunidades…" /></main>

  return (
    <main>
      <div className="reporte-encabezado">
        <div>
          <h2>Oportunidades</h2>
          <p className="reporte-fecha">
            Los nichos con veredicto de entrada, rankeados para decidir a cuál ponerle plata primero.
          </p>
        </div>
      </div>

      {!datos.oportunidades.length ? (
        <p className="vacio">
          Todavía no hay nichos con veredicto de entrada. El radar y los análisis van llenando este
          panel solos.
        </p>
      ) : (
        <div className="op-lista">
          {(() => {
            // el primer nicho de cada clave de producto (mayor score) es el dueño
            // de la compra; los siguientes llevan el chip "misma compra que"
            const dueno = new Map()
            return datos.oportunidades.map((o, i) => {
              let mismaCompraQue = null
              if (o.productoClave) {
                if (dueno.has(o.productoClave)) mismaCompraQue = dueno.get(o.productoClave)
                else dueno.set(o.productoClave, o.keyword)
              }
              return (
                <CartaOportunidad
                  key={o.nichoId}
                  o={o}
                  rank={i + 1}
                  onAbrir={onAbrirNicho}
                  mismaCompraQue={mismaCompraQue}
                />
              )
            })
          })()}
        </div>
      )}

      <p className="nota">
        Ranking por score con desempate por demanda. "EXW máx" es lo más que puedes pagar en China (precio ex-fábrica)
        para que el margen cierre al precio sugerido; la inversión estimada es EXW máx × pedido de
        prueba. Abre la carta para ver el análisis completo, el simulador y el listing.
      </p>
    </main>
  )
}
