import { useState } from 'react'
import { api } from '../api.js'

export function Sugerencias({ onCrear }) {
  const [abierto, setAbierto] = useState(false)
  const [sugerencias, setSugerencias] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [creando, setCreando] = useState(null)

  async function pedir() {
    setAbierto(true)
    setCargando(true)
    setError(null)
    try {
      const { sugerencias: lista } = await api.sugerirNichos()
      setSugerencias(lista)
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  async function crear(keyword) {
    setCreando(keyword)
    try {
      const { nicho } = await api.crearNicho(keyword)
      onCrear(nicho)
      setSugerencias((s) => s.filter((x) => x.keyword !== keyword))
    } catch (err) {
      setError(err.message)
    } finally {
      setCreando(null)
    }
  }

  return (
    <div className="sugerencias">
      <button className="boton-secundario boton-ancho" onClick={pedir} disabled={cargando}>
        {cargando ? 'Buscando nichos…' : 'Sugerir nichos (IA)'}
      </button>
      {error ? <p className="error-inline">{error}</p> : null}
      {abierto && sugerencias ? (
        <ul className="lista-sugerencias">
          {sugerencias.map((s) => (
            <li key={s.keyword} className="sugerencia">
              <div className="sugerencia-fila">
                <strong>{s.keyword}</strong>
                <button
                  className="boton-mini"
                  onClick={() => crear(s.keyword)}
                  disabled={creando === s.keyword}
                >
                  {creando === s.keyword ? '…' : 'Escanear'}
                </button>
              </div>
              <p className="sugerencia-razon">{s.razon}</p>
              <p className="sugerencia-meta">
                {s.estacionalidad?.tipo}
                {s.estacionalidad?.mesesPico?.length ? ` · pico: ${s.estacionalidad.mesesPico.join(', ')}` : ''}
              </p>
              <p className="sugerencia-meta">Comprar en China: {s.ventanaImportacion}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
