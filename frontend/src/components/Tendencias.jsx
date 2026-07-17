import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'

const PERIODOS = [
  [7, '7 días'],
  [14, '14 días'],
  [30, '30 días'],
]

function FilaMovimiento({ m }) {
  return (
    <tr>
      <td className="celda-titulo">{m.q}</td>
      <td>
        {m.nueva ? (
          <span className="delta delta-sube">entró al ranking (puesto {m.posicion})</span>
        ) : (
          <span className="delta delta-sube">
            subió {m.antes}→{m.posicion}
          </span>
        )}
      </td>
      <td>{m.prefijo}</td>
      <td className="num">
        {m.desde} → {m.hasta}
      </td>
      <td>
        <a
          href={`https://listado.mercadolibre.cl/${encodeURIComponent(m.q.replace(/ /g, '-'))}`}
          target="_blank"
          rel="noreferrer"
          className="enlace-boton"
        >
          ver listado
        </a>
      </td>
    </tr>
  )
}

export function Tendencias() {
  const [datos, setDatos] = useState(null)
  const [dias, setDias] = useState(7)
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState(null)

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.tendencias(dias))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [dias])

  useEffect(() => {
    setDatos(null)
    cargar()
  }, [cargar])

  async function capturarAhora() {
    setOcupado(true)
    setAviso(null)
    try {
      const r = await api.capturarTendencias()
      setAviso(`Captura encolada (${r.prefijos.length} prefijos, ~1 min). Refresca en un rato.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <main>
      <div className="reporte-encabezado">
        <div>
          <h2>Tendencias de búsqueda</h2>
          <p className="reporte-fecha">
            Lo que los compradores escriben más que antes, según el ranking del autocompletado real
            de ML (snapshot diario 08:30).
          </p>
        </div>
        <button className="boton-secundario" onClick={capturarAhora} disabled={ocupado}>
          {ocupado ? 'Encolando…' : 'Capturar ahora'}
        </button>
      </div>

      <nav className="pestanas" role="tablist" aria-label="Período de comparación">
        {PERIODOS.map(([valor, etiqueta]) => (
          <button
            key={valor}
            role="tab"
            aria-selected={dias === valor}
            className={dias === valor ? 'pestana activa' : 'pestana'}
            onClick={() => setDias(valor)}
          >
            vs {etiqueta}
          </button>
        ))}
      </nav>

      {aviso ? <p className="nota">{aviso}</p> : null}
      {error ? <p className="error-bloque">{error}</p> : null}

      {!datos ? (
        <Cargando texto="Cargando tendencias…" />
      ) : !datos.movimientos.length ? (
        <p className="vacio">
          Sin movimientos todavía: el tracker necesita al menos dos días de snapshots para comparar
          (el primero se está juntando hoy). Las subidas y entradas nuevas aparecerán aquí solas, y
          el radar las recibe como candidatas en cada pasada.
        </p>
      ) : (
        <div className="tabla-envoltura">
          <table>
            <thead>
              <tr>
                <th>Búsqueda</th>
                <th>Movimiento</th>
                <th>Ranking de</th>
                <th className="num">Período</th>
                <th aria-label="acciones" />
              </tr>
            </thead>
            <tbody>
              {datos.movimientos.map((m) => (
                <FilaMovimiento key={`${m.prefijo}:${m.q}`} m={m} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="nota">
        El autocompletado no entrega números de volumen, pero cada frase que aparece la escriben
        compradores reales y el orden es su popularidad. "Entró al ranking" o "subió posiciones" =
        demanda moviéndose ahora, semanas antes de que se note en reseñas.
      </p>
    </main>
  )
}
