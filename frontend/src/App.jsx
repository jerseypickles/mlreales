import { useCallback, useEffect, useRef, useState } from 'react'
import { api, claveApi } from './api.js'
import { Resumen } from './components/Resumen.jsx'
import { Productos } from './components/Productos.jsx'
import { Simulador } from './components/Simulador.jsx'
import { Analisis } from './components/Analisis.jsx'
import { Listing } from './components/Listing.jsx'
import { MisProductos } from './components/MisProductos.jsx'
import { Tendencias } from './components/Tendencias.jsx'
import { Oportunidades } from './components/Oportunidades.jsx'
import { Radar } from './components/Sugerencias.jsx'
import { Cargando, ScoreRing, MarcaIcono } from './components/ui.jsx'
import { fmtNum, fmtPrecio, fmtFecha } from './lib/formato.js'

function PresupuestoChip() {
  const [gastos, setGastos] = useState(null)

  useEffect(() => {
    let vigente = true
    const cargar = () => api.gastos().then((g) => vigente && setGastos(g)).catch(() => {})
    cargar()
    const intervalo = setInterval(cargar, 5 * 60_000)
    return () => {
      vigente = false
      clearInterval(intervalo)
    }
  }, [])

  if (!gastos) return null
  const pct = Math.min(100, Math.round((gastos.gastadoUsd / gastos.presupuestoUsd) * 100))
  return (
    <div className="presupuesto" title={`Gasto de ${gastos.mes}: Apify + IA`}>
      <span className="presupuesto-texto">
        US$ {gastos.gastadoUsd.toFixed(2)} <span className="presupuesto-tope">/ {gastos.presupuestoUsd} este mes</span>
      </span>
      <span className="presupuesto-riel" aria-hidden="true">
        <span className={pct >= 80 ? 'presupuesto-uso alto' : 'presupuesto-uso'} style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

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

const ETAPAS = {
  cola: 'en cola, esperando turno…',
  escaneando: 'escaneando listado…',
  detalle: 'leyendo detalle de productos…',
  analizando: 'analizando con IA…',
  reintento: 'ML bloqueó el detalle — reintento programado (horas)…',
}

function NichoItem({ n, seleccionado, onSeleccionar }) {
  const score = n.ultimoReporte?.scoreOportunidad
  return (
    <li>
      <button className={n._id === seleccionado ? 'nicho activo' : 'nicho'} onClick={() => onSeleccionar(n._id)}>
        <span className="nicho-fila">
          <span className="nicho-keyword">
            {n.origen === 'radar' ? <span className="punto-radar" title="descubierto por el radar" /> : null}
            {n.keyword}
          </span>
          {score != null ? <ScoreRing valor={score} size={30} grosor={3.5} /> : null}
        </span>
        <span className="nicho-meta">
          {n.enProceso ? (
            <span className="en-proceso">
              <span className="spinner" aria-hidden="true" />
              {ETAPAS[n.enProceso] ?? 'procesando…'}
            </span>
          ) : (
            <>
              {n.veredicto ? (
                <span className={`veredicto veredicto-${n.veredicto}`}>{n.veredicto.replace(/_/g, ' ')}</span>
              ) : null}
              {n.ultimoReporte
                ? `mediana ${fmtPrecio(n.ultimoReporte.precioMediana)}`
                : n.ultimoScanEl
                  ? 'scan hecho, sin reporte'
                  : 'scan pendiente…'}
            </>
          )}
        </span>
      </button>
    </li>
  )
}

function ListaNichos({ nichos, seleccionado, onSeleccionar }) {
  const [filtro, setFiltro] = useState('')

  if (!nichos.length) {
    return <p className="vacio">Sin nichos todavía. Crea el primero con una keyword.</p>
  }

  const q = filtro.trim().toLowerCase()
  const visibles = q ? nichos.filter((n) => n.keyword.includes(q)) : nichos

  const puntaje = (n) => n.ultimoReporte?.scoreOportunidad ?? -1
  const descartado = (n) => n.veredicto === 'no_entrar' || n.estado === 'pausado'
  const oportunidades = visibles.filter((n) => !descartado(n) && n.veredicto).sort((a, b) => puntaje(b) - puntaje(a))
  const evaluando = visibles.filter((n) => !descartado(n) && !n.veredicto)
  const descartados = visibles.filter(descartado).sort((a, b) => puntaje(b) - puntaje(a))

  const render = (lista) =>
    lista.map((n) => <NichoItem key={n._id} n={n} seleccionado={seleccionado} onSeleccionar={onSeleccionar} />)

  return (
    <div className="lista-envoltura">
      {nichos.length > 6 ? (
        <input
          type="search"
          className="filtro-nichos"
          placeholder="Filtrar nichos…"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          aria-label="Filtrar nichos"
        />
      ) : null}

      {oportunidades.length ? (
        <>
          <p className="grupo-titulo">Oportunidades</p>
          <ul className="lista-nichos">{render(oportunidades)}</ul>
        </>
      ) : null}

      {evaluando.length ? (
        <>
          <p className="grupo-titulo">En evaluación</p>
          <ul className="lista-nichos">{render(evaluando)}</ul>
        </>
      ) : null}

      {descartados.length ? (
        <details className="grupo-descartados">
          <summary>Descartados ({descartados.length})</summary>
          <ul className="lista-nichos">{render(descartados)}</ul>
        </details>
      ) : null}
    </div>
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
    ['listing', nicho.listingDraft ? 'Listing ✓' : 'Listing'],
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

      {pestana === 'resumen' ? (
        <Resumen reporte={reporte} productos={productos?.productos} nichoId={nichoId} nicho={nicho} />
      ) : null}
      {pestana === 'productos' ? <Productos nichoId={nichoId} onSimular={simularProducto} /> : null}
      {pestana === 'analisis' ? <Analisis nichoId={nichoId} analisisInicial={reporte.analisis} /> : null}
      {pestana === 'listing' ? <Listing nichoId={nichoId} listingInicial={nicho.listingDraft} /> : null}
      {pestana === 'simulador' ? (
        <Simulador nicho={nicho} reporte={reporte} precioInicial={precioSimulador} />
      ) : null}
    </div>
  )
}

function Candado() {
  const [clave, setClave] = useState('')
  return (
    <div className="candado">
      <h2>Acceso</h2>
      <p className="vacio">Esta herramienta es privada. Ingresa la clave de acceso.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          claveApi.guardar(clave.trim())
          location.reload()
        }}
      >
        <input
          type="password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          placeholder="Clave de acceso"
          aria-label="Clave de acceso"
          autoFocus
        />
        <button type="submit" className="boton-primario" disabled={!clave.trim()}>
          Entrar
        </button>
      </form>
    </div>
  )
}

export default function App() {
  const [nichos, setNichos] = useState([])
  const [seleccionado, setSeleccionado] = useState(null)
  const [errorLista, setErrorLista] = useState(null)
  const [bloqueada, setBloqueada] = useState(false)
  const [vista, setVista] = useState('oportunidades')

  useEffect(() => {
    const alBloquear = () => {
      claveApi.borrar()
      setBloqueada(true)
    }
    window.addEventListener('api-bloqueada', alBloquear)
    return () => window.removeEventListener('api-bloqueada', alBloquear)
  }, [])

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
    // el radar y los scans corren solos: refrescar la lista para ver el avance en vivo
    const intervalo = setInterval(cargarNichos, 15_000)
    return () => clearInterval(intervalo)
  }, [cargarNichos])

  if (bloqueada) return <Candado />

  return (
    <div className="app">
      <header>
        <div className="marca">
          <span className="marca-icono" aria-hidden="true">
            <MarcaIcono />
          </span>
          <div className="marca-texto">
            <h1>MELI Intel</h1>
            <span className="subtitulo">inteligencia de nichos · mercadolibre.cl</span>
          </div>
        </div>
        <nav className="secciones" aria-label="Secciones">
          <button
            className={vista === 'oportunidades' ? 'seccion activa' : 'seccion'}
            onClick={() => setVista('oportunidades')}
          >
            Oportunidades
          </button>
          <button
            className={vista === 'nichos' ? 'seccion activa' : 'seccion'}
            onClick={() => setVista('nichos')}
          >
            Nichos
          </button>
          <button
            className={vista === 'propios' ? 'seccion activa' : 'seccion'}
            onClick={() => setVista('propios')}
          >
            Mis productos
          </button>
          <button
            className={vista === 'tendencias' ? 'seccion activa' : 'seccion'}
            onClick={() => setVista('tendencias')}
          >
            Tendencias
          </button>
        </nav>
        <PresupuestoChip />
      </header>
      {vista === 'oportunidades' ? (
        <Oportunidades
          onAbrirNicho={(id) => {
            setSeleccionado(id)
            setVista('nichos')
          }}
        />
      ) : vista === 'propios' ? (
        <MisProductos />
      ) : vista === 'tendencias' ? (
        <Tendencias />
      ) : (
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
          <Radar />
        </aside>
        <main>
          {seleccionado ? (
            <VistaNicho key={seleccionado} nichoId={seleccionado} alCambiarNichos={cargarNichos} />
          ) : (
            <p className="vacio">Selecciona o crea un nicho para ver su reporte.</p>
          )}
        </main>
      </div>
      )}
    </div>
  )
}
