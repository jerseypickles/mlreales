import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { Resumen } from './components/Resumen.jsx'
import { Productos } from './components/Productos.jsx'
import { Simulador } from './components/Simulador.jsx'
import { Analisis } from './components/Analisis.jsx'
import { Sugerencias } from './components/Sugerencias.jsx'
import { Cargando } from './components/ui.jsx'
import { fmtNum, fmtPrecio, fmtFecha } from './lib/formato.js'

function FormNuevoNicho({ onCreado }) {
  const [keyword, setKeyword] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)

  async function enviar(e) {
    e.preventDefault()
    if (keyword.trim().length < 2) return
    setEnviando(true)
    setError(null)
    try {
      const { nicho } = await api.crearNicho(keyword.trim())
      setKeyword('')
      onCreado(nicho)
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="form-nicho" onSubmit={enviar}>
      <input
        type="text"
        placeholder="Nueva keyword, ej: foco solares"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        disabled={enviando}
        aria-label="Keyword del nuevo nicho"
      />
      <button type="submit" className="boton-primario" disabled={enviando || keyword.trim().length < 2}>
        {enviando ? 'Creando…' : 'Crear nicho'}
      </button>
      {error ? <span className="error-inline">{error}</span> : null}
    </form>
  )
}

function ListaNichos({ nichos, seleccionado, onSeleccionar }) {
  if (!nichos.length) {
    return <p className="vacio">Sin nichos todavía. Crea el primero con una keyword.</p>
  }
  return (
    <ul className="lista-nichos">
      {nichos.map((n) => (
        <li key={n._id}>
          <button
            className={n._id === seleccionado ? 'nicho activo' : 'nicho'}
            onClick={() => onSeleccionar(n._id)}
          >
            <span className="nicho-fila">
              <span className="nicho-keyword">{n.keyword}</span>
              {n.ultimoReporte?.scoreOportunidad != null ? (
                <span className="nicho-score">{n.ultimoReporte.scoreOportunidad}</span>
              ) : null}
            </span>
            <span className="nicho-meta">
              {n.ultimoReporte
                ? `${fmtNum(n.ultimoReporte.productosAnalizados)} productos · mediana ${fmtPrecio(n.ultimoReporte.precioMediana)}`
                : n.ultimoScanEl
                  ? 'scan hecho, sin reporte'
                  : 'scan pendiente…'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function VistaNicho({ nichoId, alCambiarNichos }) {
  const [datos, setDatos] = useState(null)
  const [estado, setEstado] = useState('cargando')
  const [error, setError] = useState(null)
  const [pestana, setPestana] = useState('resumen')
  const [productos, setProductos] = useState(null)
  const [escaneando, setEscaneando] = useState(false)
  const [precioSimulador, setPrecioSimulador] = useState(null)
  const encuesta = useRef(null)

  const cargar = useCallback(async () => {
    try {
      const cuerpo = await api.reporte(nichoId)
      setDatos(cuerpo)
      setEstado('listo')
      api.productosNicho(nichoId).then(setProductos).catch(() => setProductos(null))
      return cuerpo
    } catch (err) {
      if (String(err.message).includes('aún no hay scans')) setEstado('sin-datos')
      else {
        setEstado('error')
        setError(err.message)
      }
      return null
    }
  }, [nichoId])

  useEffect(() => {
    setEstado('cargando')
    setDatos(null)
    setProductos(null)
    setPestana('resumen')
    setPrecioSimulador(null)
    cargar()
    return () => clearInterval(encuesta.current)
  }, [cargar])

  function vigilarNuevoReporte(fechaAnterior) {
    clearInterval(encuesta.current)
    encuesta.current = setInterval(async () => {
      const cuerpo = await cargar()
      const fechaNueva = cuerpo?.reporte?.fecha
      if (fechaNueva && fechaNueva !== fechaAnterior) {
        clearInterval(encuesta.current)
        setEscaneando(false)
        alCambiarNichos()
      }
    }, 10_000)
  }

  async function escanear() {
    setEscaneando(true)
    try {
      await api.escanear(nichoId)
      vigilarNuevoReporte(datos?.reporte?.fecha ?? null)
    } catch (err) {
      setEscaneando(false)
      setError(err.message)
    }
  }

  function simularProducto(producto) {
    setPrecioSimulador(producto.precio)
    setPestana('simulador')
  }

  if (estado === 'cargando') return <Cargando texto="Cargando reporte…" />
  if (estado === 'error') return <p className="error-bloque">Error: {error}</p>
  if (estado === 'sin-datos') {
    return (
      <div>
        <p className="vacio">
          Aún no hay scans completados (el primero corre solo al crear el nicho, toma 1-5 min con el
          nivel de detalle).
        </p>
        <button onClick={cargar} className="boton-secundario">
          Revisar de nuevo
        </button>
      </div>
    )
  }

  const { nicho, reporte } = datos
  const pestanas = [
    ['resumen', 'Resumen'],
    ['productos', productos ? `Productos (${productos.total})` : 'Productos'],
    ['analisis', reporte.analisis ? `Análisis: ${reporte.analisis.veredicto?.replace(/_/g, ' ')}` : 'Análisis IA'],
    ['simulador', 'Simulador'],
  ]

  return (
    <div>
      <div className="reporte-encabezado">
        <div>
          <h2>{nicho.keyword}</h2>
          <p className="reporte-fecha">
            Último scan: {fmtFecha(reporte.fecha)}
            {escaneando ? ' · escaneando…' : ''}
          </p>
        </div>
        <button onClick={escanear} disabled={escaneando} className="boton-primario">
          {escaneando ? 'Escaneando…' : 'Re-escanear ahora'}
        </button>
      </div>

      <nav className="pestanas" role="tablist">
        {pestanas.map(([clave, etiqueta]) => (
          <button
            key={clave}
            role="tab"
            aria-selected={pestana === clave}
            className={pestana === clave ? 'pestana activa' : 'pestana'}
            onClick={() => setPestana(clave)}
          >
            {etiqueta}
          </button>
        ))}
      </nav>

      {pestana === 'resumen' ? <Resumen reporte={reporte} productos={productos?.productos} /> : null}
      {pestana === 'productos' ? <Productos nichoId={nichoId} onSimular={simularProducto} /> : null}
      {pestana === 'analisis' ? <Analisis nichoId={nichoId} analisisInicial={reporte.analisis} /> : null}
      {pestana === 'simulador' ? (
        <Simulador nicho={nicho} reporte={reporte} precioInicial={precioSimulador} />
      ) : null}
    </div>
  )
}

export default function App() {
  const [nichos, setNichos] = useState([])
  const [seleccionado, setSeleccionado] = useState(null)
  const [errorLista, setErrorLista] = useState(null)

  const cargarNichos = useCallback(async () => {
    try {
      const { nichos: lista } = await api.listarNichos()
      setNichos(lista)
      setErrorLista(null)
      setSeleccionado((actual) => actual ?? lista[0]?._id ?? null)
    } catch (err) {
      setErrorLista(err.message)
    }
  }, [])

  useEffect(() => {
    cargarNichos()
  }, [cargarNichos])

  return (
    <div className="app">
      <header>
        <h1>MELI Intel</h1>
        <span className="subtitulo">inteligencia de nichos · mercadolibre.cl</span>
      </header>
      <div className="cuerpo">
        <aside>
          <FormNuevoNicho
            onCreado={(nicho) => {
              cargarNichos()
              setSeleccionado(nicho._id)
            }}
          />
          {errorLista ? <p className="error-bloque">No se pudo cargar la lista: {errorLista}</p> : null}
          <ListaNichos nichos={nichos} seleccionado={seleccionado} onSeleccionar={setSeleccionado} />
          <Sugerencias
            onCrear={(nicho) => {
              cargarNichos()
              setSeleccionado(nicho._id)
            }}
          />
        </aside>
        <main>
          {seleccionado ? (
            <VistaNicho key={seleccionado} nichoId={seleccionado} alCambiarNichos={cargarNichos} />
          ) : (
            <p className="vacio">Selecciona o crea un nicho para ver su reporte.</p>
          )}
        </main>
      </div>
    </div>
  )
}
