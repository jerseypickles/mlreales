import { useEffect, useState } from 'react'
import { api } from '../api.js'

// Libreta de criterios del importador: cada regla se inyecta en los prompts
// del sugeridor y del analista desde el análisis siguiente, sin deploy.
export function Criterios() {
  const [criterios, setCriterios] = useState(null)
  const [nuevo, setNuevo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)

  const cargar = () =>
    api
      .listarCriterios()
      .then((d) => setCriterios(d.criterios))
      .catch((e) => setError(e.message))

  useEffect(() => {
    cargar()
  }, [])

  async function agregar(e) {
    e.preventDefault()
    if (nuevo.trim().length < 5) return
    setOcupado(true)
    setError(null)
    try {
      await api.crearCriterio(nuevo.trim())
      setNuevo('')
      await cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setOcupado(false)
    }
  }

  async function alternar(c) {
    await api.ajustarCriterio(c._id, { activo: !c.activo }).catch(() => {})
    await cargar()
  }

  async function eliminar(c) {
    await api.eliminarCriterio(c._id).catch(() => {})
    await cargar()
  }

  return (
    <details className="contexto-analista criterios" open={Boolean(criterios?.length)}>
      <summary>
        Criterios del importador — tus reglas para la IA
        {criterios?.length ? ` (${criterios.filter((c) => c.activo).length} activos)` : ''}
      </summary>
      <p className="ayuda-campo">
        Cada regla que escribas aquí la cumplen el radar y el analista desde el próximo análisis.
        Ej: "el genérico vende en belleza", "nunca productos con tallas", "prefiero ticket $10-40k".
      </p>

      {criterios === null ? null : (
        <ul className="criterios-lista">
          {criterios.map((c) => (
            <li key={c._id} className={c.activo ? '' : 'criterio-inactivo'}>
              <span className="criterio-texto">{c.texto}</span>
              <span className="criterio-acciones">
                <button className="enlace-boton" onClick={() => alternar(c)}>
                  {c.activo ? 'pausar' : 'activar'}
                </button>
                <button className="enlace-boton" onClick={() => eliminar(c)}>
                  quitar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className="criterio-form" onSubmit={agregar}>
        <input
          type="text"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          placeholder="Escribe una regla nueva para la IA…"
          maxLength={300}
          disabled={ocupado}
          aria-label="Nuevo criterio"
        />
        <button className="boton-secundario" type="submit" disabled={ocupado || nuevo.trim().length < 5}>
          Agregar
        </button>
      </form>
      {error ? <p className="error-bloque">{error}</p> : null}
    </details>
  )
}
