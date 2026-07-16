import { useState } from 'react'
import { api } from '../api.js'
import { Badge, Cargando } from './ui.jsx'
import { fmtPrecio, fmtPct, fmtFecha } from '../lib/formato.js'

const VEREDICTOS = {
  entrar: { etiqueta: 'ENTRAR', tipo: 'full' },
  entrar_con_condiciones: { etiqueta: 'ENTRAR CON CONDICIONES', tipo: 'cn' },
  no_entrar: { etiqueta: 'NO ENTRAR', tipo: 'peligro' },
}

export function Analisis({ nichoId, analisisInicial }) {
  const [analisis, setAnalisis] = useState(analisisInicial ?? null)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState(null)

  async function generar() {
    setGenerando(true)
    setError(null)
    try {
      const { analisis: nuevo } = await api.analizarNicho(nichoId)
      setAnalisis(nuevo)
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerando(false)
    }
  }

  if (!analisis) {
    return (
      <div className="analisis-vacio">
        <p className="vacio">
          El análisis con IA lee el top 50 del nicho, lo segmenta por atributos (watts, packs,
          tipo), cruza la demanda con la calculadora de importación y entrega un veredicto:
          entrar o no, en qué segmento, a qué precio vender y cuánto pagar máximo en China.
        </p>
        <button className="boton-primario" onClick={generar} disabled={generando}>
          {generando ? 'Analizando… (30-90 s)' : 'Generar análisis'}
        </button>
        {error ? <p className="error-bloque">{error}</p> : null}
      </div>
    )
  }

  const v = VEREDICTOS[analisis.veredicto] ?? VEREDICTOS.entrar_con_condiciones
  const rec = analisis.recomendacion

  return (
    <div className="analisis">
      <div className="analisis-encabezado">
        <div className="analisis-veredicto">
          <Badge tipo={v.tipo}>{v.etiqueta}</Badge>
          <span className="analisis-confianza">confianza {analisis.confianza}</span>
        </div>
        <button className="boton-secundario" onClick={generar} disabled={generando}>
          {generando ? 'Analizando…' : 'Regenerar'}
        </button>
      </div>

      <p className="analisis-resumen">{analisis.resumen}</p>
      {error ? <p className="error-bloque">{error}</p> : null}

      {rec?.aplica ? (
        <div className="recomendacion">
          <h3>La jugada recomendada</h3>
          <div className="tiles">
            <div className="tile tile-destacado">
              <div className="tile-label">Segmento</div>
              <div className="tile-value tile-texto">{rec.segmento}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Precio de entrada</div>
              <div className="tile-value">{fmtPrecio(rec.precioVentaClp)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">FOB máximo en China</div>
              <div className="tile-value">US$ {rec.fobMaximoUsd}</div>
              <div className="tile-detalle">por unidad, margen objetivo incluido</div>
            </div>
          </div>
          <p>
            <strong>Qué buscar en Alibaba/1688:</strong> {rec.especificacionProducto}
          </p>
          <p>
            <strong>Antes de comprar el embarque:</strong> {rec.comoValidar}
          </p>
        </div>
      ) : null}

      <section>
        <h3>Segmentos del nicho</h3>
        <div className="tabla-envoltura">
          <table>
            <thead>
              <tr>
                <th>Segmento</th>
                <th>Precio</th>
                <th className="num">% demanda</th>
                <th>Competencia</th>
                <th>Atractivo</th>
                <th>Por qué</th>
              </tr>
            </thead>
            <tbody>
              {analisis.segmentos.map((s) => (
                <tr key={s.nombre} className={s.atractivo === 'alto' ? 'fila-destacada' : ''}>
                  <td>
                    <strong>{s.nombre}</strong>
                    <div className="celda-secundaria">{s.criterio}</div>
                  </td>
                  <td className="sin-corte">
                    {fmtPrecio(s.rangoPrecioClp?.desde)}–{fmtPrecio(s.rangoPrecioClp?.hasta)}
                  </td>
                  <td className="num">{fmtPct(s.shareReviewsPct)}</td>
                  <td>{s.nivelCompetencia}</td>
                  <td>
                    <Badge tipo={s.atractivo === 'alto' ? 'full' : s.atractivo === 'medio' ? 'neutro' : 'peligro'}>
                      {s.atractivo}
                    </Badge>
                  </td>
                  <td className="celda-razon">{s.razon}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3>Plan de entrada</h3>
        <p className="analisis-jugada">{analisis.jugada}</p>
      </section>

      <section>
        <h3>Riesgos</h3>
        <ul className="lista-riesgos">
          {analisis.riesgos.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </section>

      <p className="nota">
        Generado {fmtFecha(analisis.generadoEl)} con Claude sobre los datos del último scan y la
        calculadora de importación. Es una recomendación, no una garantía: valida con muestras
        antes de comprar un embarque.
      </p>
      {generando ? <Cargando texto="Regenerando análisis…" /> : null}
    </div>
  )
}
