import { useState } from 'react'
import { api } from '../api.js'
import { Badge, Cargando } from './ui.jsx'
import { fmtPrecio, fmtPct, fmtFecha } from '../lib/formato.js'

const VEREDICTOS = {
  entrar: { etiqueta: 'ENTRAR', tipo: 'full' },
  entrar_con_condiciones: { etiqueta: 'ENTRAR CON CONDICIONES', tipo: 'cn' },
  no_entrar: { etiqueta: 'NO ENTRAR', tipo: 'peligro' },
}

function ContextoImportador({ nichoId, contextoInicial }) {
  const [contexto, setContexto] = useState(contextoInicial ?? '')
  const [guardado, setGuardado] = useState(contextoInicial ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      await api.ajustarNicho(nichoId, { contextoUsuario: contexto })
      setGuardado(contexto)
    } catch (err) {
      setError(err.message)
    } finally {
      setGuardando(false)
    }
  }

  const sinGuardar = contexto.trim() !== guardado.trim()

  return (
    <details className="contexto-analista" open={Boolean(guardado)}>
      <summary>Tu experiencia con este nicho (el analista la lee y la pesa sobre los datos)</summary>
      <textarea
        rows={3}
        value={contexto}
        onChange={(e) => setContexto(e.target.value)}
        placeholder="ej: nosotros ya vendimos esta paleta de sombras 88 colores genérica en ML — se vendía bien a $X; el comprador de este segmento no busca marca"
        aria-label="Contexto del importador para el analista"
      />
      <div className="contexto-analista-acciones">
        <button className="boton-secundario" onClick={guardar} disabled={guardando || !sinGuardar}>
          {guardando ? 'Guardando…' : sinGuardar ? 'Guardar contexto' : 'Guardado ✓'}
        </button>
        {guardado && !sinGuardar ? (
          <span className="ayuda-campo">regenera el análisis para que lo considere</span>
        ) : null}
      </div>
      {error ? <p className="error-bloque">{error}</p> : null}
    </details>
  )
}

// Fecha de re-evaluación de un descartado estacional: la agenda el analista al
// rechazar por ventana; aquí se ve y se ajusta. El programador reactiva el
// nicho solo cuando llega (siempre a scan semanal — nunca activa la lupa).
function RevisionTemporada({ nichoId, revisarElInicial }) {
  const [fecha, setFecha] = useState(revisarElInicial ? String(revisarElInicial).slice(0, 10) : '')
  const [guardando, setGuardando] = useState(false)

  async function guardar(valor) {
    setGuardando(true)
    try {
      await api.ajustarNicho(nichoId, { revisarEl: valor || null })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <p className="revision-temporada">
      <span>Volver a evaluar el</span>
      <input
        type="date"
        value={fecha}
        disabled={guardando}
        onChange={(e) => {
          setFecha(e.target.value)
          guardar(e.target.value)
        }}
        aria-label="Fecha de re-evaluación"
      />
      <span className="ayuda-campo">
        {fecha
          ? 'el sistema lo reactivará y re-escaneará solo en esa fecha'
          : 'sin fecha: queda descartado sin re-evaluación programada'}
      </span>
    </p>
  )
}

export function Analisis({ nichoId, analisisInicial, contextoInicial, revisarElInicial, scans, onRegenerado }) {
  const [analisis, setAnalisis] = useState(analisisInicial ?? null)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState(null)

  async function generar() {
    setGenerando(true)
    setError(null)
    try {
      const { analisis: nuevo } = await api.analizarNicho(nichoId)
      setAnalisis(nuevo)
      // refrescar el conteo de scans en la vista padre: el aviso de "análisis
      // desactualizado" se apaga recién cuando el servidor confirma
      onRegenerado?.()
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
        <ContextoImportador nichoId={nichoId} contextoInicial={contextoInicial} />
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
      {/* el veredicto que estás leyendo, ¿vio el último scan o quedó atrás? */}
      {scans?.trasAnalisis > 0 ? (
        <div className="analisis-desfase">
          ⚠️ Este veredicto se generó con el scan del <strong>{fmtFecha(scans.analisisDe)}</strong> y no
          vio {scans.trasAnalisis === 1 ? 'el scan más nuevo' : `los ${scans.trasAnalisis} scans más nuevos`} —
          hay deltas de reseñas, sellers gemelos y precios frescos que no están reflejados. Dale{' '}
          <strong>Regenerar</strong> para incorporarlos.
        </div>
      ) : scans?.total ? (
        <p className="analisis-al-dia">
          ✓ Al día con el último scan · {scans.total} scan{scans.total === 1 ? '' : 's'} acumulado
          {scans.total === 1 ? '' : 's'}
        </p>
      ) : null}
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
                <span className="dato-label">Pagar máx en China (EXW)</span>
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
        {analisis.veredicto === 'no_entrar' ? (
          <RevisionTemporada nichoId={nichoId} revisarElInicial={revisarElInicial} />
        ) : null}
        {error ? <p className="error-bloque">{error}</p> : null}
      </div>

      <ContextoImportador nichoId={nichoId} contextoInicial={contextoInicial} />

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
        importación. Valida con el pedido mínimo (MOQ) antes de comprar un embarque grande.
      </p>
      {generando ? <Cargando texto="Regenerando…" /> : null}
    </div>
  )
}
