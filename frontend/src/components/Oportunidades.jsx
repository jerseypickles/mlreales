import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { Cargando, ScoreRing } from './ui.jsx'
import { Criterios } from './Criterios.jsx'
import { PlanSemana } from './PlanSemana.jsx'
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
          {o.confirmacion ? (
            <span
              className={`op-confianza ${o.confirmacion === 'confirmado' ? 'op-confianza-alta' : 'op-confianza-media'}`}
              title={
                o.confirmacion === 'confirmado'
                  ? `Demanda sostenida en ${o.scansConDemanda} scans`
                  : `Solo ${o.scansConDemanda} scan(s) con demanda: espera 2-3 antes de apostar`
              }
            >
              {o.confirmacion === 'confirmado' ? `✓ confirmado (${o.scansConDemanda} scans)` : `preliminar (${o.scansConDemanda} scan${o.scansConDemanda === 1 ? '' : 's'})`}
            </span>
          ) : null}
          {o.tramites.map((t) => (
            <span key={t} className="op-tramite" title="Requiere trámite de importación">
              ⚠ {t}
            </span>
          ))}
          {o.etapaCompra && o.etapaCompra !== 'evaluando' ? (
            <span className="op-confianza op-confianza-alta" title={o.notaEtapa ?? 'Etapa del embudo de compra'}>
              {o.etapaCompra.replace(/-/g, ' ')}
              {o.notaEtapa ? ` · ${o.notaEtapa}` : ''}
            </span>
          ) : null}
          {Number.isFinite(o.shareJugadaPct) && o.shareJugadaPct < 50 ? (
            <span
              className="op-confianza op-confianza-media"
              title={`El score del nicho mezcla familias de producto; la jugada recomendada concentra el ${o.shareJugadaPct}% de las reseñas del top${o.keywordJugada ? ` — el sistema la mide aparte como "${o.keywordJugada}"` : ''}`}
            >
              jugada {o.shareJugadaPct}% del top
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
          <Hecho etiqueta="gemelos creciendo">
            {o.sellersGemelos != null ? (
              <span title={o.gemelosDetalle ?? 'Vendedores chicos no-oficiales ganando reseñas en el nicho'}>
                {o.sellersGemelos}
              </span>
            ) : null}
          </Hecho>
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

// Nichos que miden el MISMO mercado que la carta líder (solape de SKUs):
// colapsados bajo ella, con absorber (pausar, reversible) o mantener aparte.
function FamiliaColapsada({ miembros, porKeyword, lider, onAbrir, onRecargar }) {
  const [abierta, setAbierta] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  async function absorber(m) {
    const o = porKeyword.get(m.keyword)
    if (!o) return
    setOcupado(true)
    try {
      await api.ajustarNicho(o.nichoId, { estado: 'pausado', notaEtapa: `familia de ${lider.keyword}` })
      onRecargar()
    } finally {
      setOcupado(false)
    }
  }

  async function mantenerAparte(m) {
    const o = porKeyword.get(m.keyword)
    if (!o) return
    setOcupado(true)
    try {
      await api.ajustarNicho(o.nichoId, { familiaAparte: lider.keyword })
      onRecargar()
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="familia">
      <button className="enlace-boton" onClick={() => setAbierta(!abierta)}>
        {abierta ? '▾' : '▸'} {miembros.length} nicho(s) miden este mismo mercado:{' '}
        {miembros.map((m) => `${m.keyword} (${m.solapePct}% compartido)`).join(' · ')}
      </button>
      {abierta ? (
        <ul className="familia-lista">
          {miembros.map((m) => {
            const o = porKeyword.get(m.keyword)
            const esJugada = o?.esJugadaDelLider
            return (
              <li key={m.keyword}>
                <button className="enlace-boton" onClick={() => o && onAbrir(o.nichoId)}>
                  {m.keyword}
                </button>{' '}
                <span className="plan-motivo">
                  {m.solapePct}% del top compartido · score {o?.score ?? '—'}
                  {esJugada ? ' · sub-nicho de jugada (medición a propósito)' : ''}
                </span>{' '}
                {!esJugada ? (
                  <>
                    <button className="boton-secundario boton-mini" onClick={() => absorber(m)} disabled={ocupado}
                            title="Pausa este nicho (reversible): libera cupo y deja de pagar scans duplicados">
                      absorber
                    </button>{' '}
                    <button className="enlace-boton" onClick={() => mantenerAparte(m)} disabled={ocupado}
                            title="Falso positivo: son mercados distintos, no volver a agruparlos">
                      mantener aparte
                    </button>
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

export function Oportunidades({ onAbrirNicho }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)

  const cargar = useCallback(() => {
    api
      .oportunidades()
      .then(setDatos)
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

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

      <PlanSemana onAbrirNicho={onAbrirNicho} />

      {!datos.oportunidades.length ? (
        <p className="vacio">
          Todavía no hay nichos con veredicto de entrada. El radar y los análisis van llenando este
          panel solos.
        </p>
      ) : (
        <div className="op-lista">
          {(() => {
            // el primer nicho de cada clave de producto (mayor score) es el dueño
            // de la compra; los siguientes llevan el chip "misma compra que".
            // Los miembros de una familia (mismo mercado) no ocupan carta propia:
            // viven colapsados bajo su líder.
            const dueno = new Map()
            const porKeyword = new Map(datos.oportunidades.map((o) => [o.keyword, o]))
            let rank = 0
            return datos.oportunidades.map((o) => {
              if (o.familiaLider) return null // colapsado bajo el líder
              rank++
              let mismaCompraQue = null
              if (o.productoClave) {
                if (dueno.has(o.productoClave)) mismaCompraQue = dueno.get(o.productoClave)
                else dueno.set(o.productoClave, o.keyword)
              }
              return (
                <div key={o.nichoId}>
                  <CartaOportunidad o={o} rank={rank} onAbrir={onAbrirNicho} mismaCompraQue={mismaCompraQue} />
                  {o.familiaMiembros?.length ? (
                    <FamiliaColapsada
                      miembros={o.familiaMiembros}
                      porKeyword={porKeyword}
                      lider={o}
                      onAbrir={onAbrirNicho}
                      onRecargar={cargar}
                    />
                  ) : null}
                </div>
              )
            })
          })()}
        </div>
      )}

      <Criterios />

      <p className="nota">
        Ranking por score con desempate por demanda. "EXW máx" es lo más que puedes pagar en China (precio ex-fábrica)
        para que el margen cierre al precio sugerido; la inversión estimada es EXW máx × pedido de
        prueba. Abre la carta para ver el análisis completo, el simulador y el listing.
      </p>
    </main>
  )
}
