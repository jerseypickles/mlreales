import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmtFecha } from '../lib/formato.js'

const ACCION_TEXTO = {
  avanzar_a_pedido: 'avanzar a pedido',
  cotizar: 'mandar a cotizar',
  renegociar: 'renegociar',
  descartar: 'descartar',
  poner_lupa: 'poner lupa (scan diario)',
  regenerar_analisis: 'regenerar análisis',
  esperar: 'esperar',
}

// Informe del estratega semanal: el tablero completo pasado por IA con las
// jugadas de la semana. Se regenera solo cada lunes; el botón fuerza una pasada.
export function PlanSemana({ onAbrirNicho }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [generando, setGenerando] = useState(false)
  const [abierto, setAbierto] = useState(true)

  useEffect(() => {
    let vigente = true
    api
      .estratega()
      .then((d) => vigente && setDatos(d))
      .catch((e) => vigente && setError(e.message))
    return () => {
      vigente = false
    }
  }, [])

  async function generar() {
    setGenerando(true)
    setError(null)
    try {
      const r = await api.generarEstratega()
      setDatos((previo) => ({ ...r, historia: previo?.historia ?? [] }))
      setAbierto(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerando(false)
    }
  }

  const informe = datos?.informe
  return (
    <section className="plan-semana">
      <div className="plan-encabezado">
        <div>
          <h3>Plan de la semana</h3>
          {informe ? (
            <p className="plan-meta">
              generado el {fmtFecha(datos.generadoEl)} · se regenera solo cada lunes 08:45
            </p>
          ) : (
            <p className="plan-meta">
              el estratega revisa el tablero completo cada lunes 08:45 y deja acá las jugadas de la
              semana
            </p>
          )}
        </div>
        <div className="plan-botones">
          {informe ? (
            <button className="enlace-boton" onClick={() => setAbierto(!abierto)}>
              {abierto ? 'plegar' : 'desplegar'}
            </button>
          ) : null}
          <button className="boton-secundario" onClick={generar} disabled={generando}>
            {generando ? 'Pensando… (~1 min)' : informe ? 'Regenerar ahora' : 'Generar ahora'}
          </button>
        </div>
      </div>

      {error ? <p className="error-bloque">{error}</p> : null}

      {informe && abierto ? (
        <>
          <p className="plan-resumen">{informe.resumen}</p>

          <div className="plan-focos">
            {(informe.focoSemana ?? []).map((f, i) => (
              <article className="plan-foco" key={i}>
                <div className="plan-foco-titulo">
                  <span className="op-rank">#{i + 1}</span>
                  <strong>{f.titulo}</strong>
                </div>
                <p>{f.porQue}</p>
                <p className="plan-paso">
                  → {f.siguientePaso}
                  {Number.isFinite(f.inversionUsd) ? ` · ~US$ ${f.inversionUsd}` : ''}
                </p>
                {f.nichoId ? (
                  <button className="enlace-boton" onClick={() => onAbrirNicho(f.nichoId)}>
                    abrir {f.keyword}
                  </button>
                ) : null}
              </article>
            ))}
          </div>

          {(informe.acciones ?? []).length ? (
            <ul className="plan-lista">
              {informe.acciones.map((a, i) => (
                <li key={i}>
                  <span className={`badge ${a.urgencia === 'esta_semana' ? 'badge-cn' : 'badge-neutro'}`}>
                    {a.urgencia === 'esta_semana' ? 'esta semana' : 'próxima'}
                  </span>{' '}
                  <strong>{ACCION_TEXTO[a.accion] ?? a.accion}</strong>{' '}
                  {a.nichoId ? (
                    <button className="enlace-boton" onClick={() => onAbrirNicho(a.nichoId)}>
                      {a.keyword}
                    </button>
                  ) : (
                    a.keyword
                  )}
                  <span className="plan-motivo"> — {a.motivo}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {(informe.riesgos ?? []).length ? (
            <p className="plan-riesgos">⚠ {informe.riesgos.join(' · ')}</p>
          ) : null}
          {informe.salud ? <p className="plan-meta">{informe.salud}</p> : null}
        </>
      ) : null}
    </section>
  )
}
