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
          El análisis se genera solo después de cada scan. También puedes generarlo ahora: lee el
          top 50, lo segmenta por atributos y responde directo qué traer, a qué precio y cuánto
          pagar en China.
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
      {/* ---- LA DECISIÓN ---- */}
      <div className={`decision decision-${analisis.veredicto}`}>
        <div className="decision-fila">
          <Badge tipo={v.tipo}>{v.etiqueta}</Badge>
          <span className="analisis-confianza">confianza {analisis.confianza}</span>
          <button className="boton-secundario boton-regenerar" onClick={generar} disabled={generando}>
            {generando ? 'Analizando…' : 'Regenerar'}
          </button>
        </div>

        {rec?.aplica ? (
          <>
            <h2 className="decision-titular">{rec.titular ?? rec.segmento}</h2>
            <div className="decision-datos">
              <div>
                <span className="dato-label">Vender a</span>
                <span className="dato-valor">{fmtPrecio(rec.precioVentaClp)}</span>
              </div>
              <div>
                <span className="dato-label">Pagar máx en China</span>
                <span className="dato-valor">US$ {rec.exwMaximoUsd ?? rec.fobMaximoUsd}</span>
              </div>
              <div>
                <span className="dato-label">Pedido de prueba</span>
                <span className="dato-valor">{rec.primeraCompra ?? '50-100 u'}</span>
              </div>
            </div>
          </>
        ) : (
          <h2 className="decision-titular">{rec?.titular ?? 'No traigas nada de este nicho.'}</h2>
        )}
        <p className="decision-resumen">{analisis.resumen}</p>
        {error ? <p className="error-bloque">{error}</p> : null}
      </div>

      {/* ---- DETALLE PLEGADO ---- */}
      {rec?.aplica ? (
        <details className="pliegue" open>
          <summary>Qué buscar en Alibaba/1688 y cómo validar</summary>
          <p>
            <strong>Especificación:</strong> {rec.especificacionProducto}
          </p>
          <p>
            <strong>Validación antes del embarque:</strong> {rec.comoValidar}
          </p>
        </details>
      ) : null}

      <details className="pliegue">
        <summary>Segmentos del nicho ({analisis.segmentos.length})</summary>
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
      </details>

      <details className="pliegue">
        <summary>Plan de entrada y riesgos</summary>
        <h4>Plan</h4>
        <p className="analisis-jugada">{analisis.jugada}</p>
        <h4>Riesgos</h4>
        <ul className="lista-riesgos">
          {analisis.riesgos.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </details>

      <p className="nota">
        Generado {fmtFecha(analisis.generadoEl)} con Claude sobre el último scan + calculadora de
        importación. Valida con muestras antes de comprar un embarque.
      </p>
      {generando ? <Cargando texto="Regenerando…" /> : null}
    </div>
  )
}
