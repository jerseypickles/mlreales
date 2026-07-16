import { useState } from 'react'
import { api } from '../api.js'

// Panel del radar autónomo: corre solo (lunes 08:00 Chile por defecto) —
// propone nichos por temporada/tendencia, los escanea, los analiza con IA y
// pausa solo los que no valen la pena. Este panel solo informa y permite
// forzar una pasada extra.
export function Radar() {
  const [estado, setEstado] = useState(null)
  const [corriendo, setCorriendo] = useState(false)

  async function correrAhora() {
    setCorriendo(true)
    setEstado(null)
    try {
      const r = await api.correrRadar()
      setEstado(r.mensaje)
    } catch (err) {
      setEstado(err.message)
    } finally {
      setCorriendo(false)
    }
  }

  return (
    <div className="radar">
      <h4 className="radar-titulo">Radar de nichos</h4>
      <p className="radar-texto">
        Corre solo cada mañana y aprende de tu historial: propone vecinos de tus búsquedas y de los
        nichos ganadores, más apuestas de temporada. Los escanea, los analiza con IA y pausa los
        descartados. Los descubrimientos aparecen arriba con un punto azul.
      </p>
      <button className="boton-secundario boton-ancho" onClick={correrAhora} disabled={corriendo}>
        {corriendo ? 'Encolando…' : 'Explorar ahora'}
      </button>
      {estado ? <p className="radar-estado">{estado}</p> : null}
    </div>
  )
}
