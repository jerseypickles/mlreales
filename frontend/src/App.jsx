import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

const CLP = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
})
const fmtPrecio = (v) => (Number.isFinite(v) ? CLP.format(v) : '—')
const fmtPct = (v) => (Number.isFinite(v) ? `${v}%` : '—')
const fmtNum = (v) => (Number.isFinite(v) ? new Intl.NumberFormat('es-CL').format(v) : '—')
const fmtFecha = (iso) =>
  iso ? new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

function StatTile({ label, value, detalle }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {detalle ? <div className="tile-detalle">{detalle}</div> : null}
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
      />
      <button type="submit" disabled={enviando || keyword.trim().length < 2}>
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
            <span className="nicho-keyword">{n.keyword}</span>
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

function TablaProductos({ productos }) {
  return (
    <div className="tabla-envoltura">
      <table>
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Producto</th>
            <th className="num">Precio</th>
            <th className="num">Desc.</th>
            <th className="num">Rating</th>
            <th>Vendedor</th>
            <th>Tipo</th>
            <th>Full</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.sku}>
              <td className="num">{p.posicion ?? '—'}</td>
              <td className="celda-titulo">
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.titulo ?? p.sku}
                  </a>
                ) : (
                  (p.titulo ?? p.sku)
                )}
              </td>
              <td className="num">{fmtPrecio(p.precio)}</td>
              <td className="num">{Number.isFinite(p.descuentoPct) ? `-${p.descuentoPct}%` : '—'}</td>
              <td className="num">{p.rating ?? '—'}</td>
              <td>{p.vendedor ?? '—'}</td>
              <td>{p.tipoListing === 'catalogo' ? 'catálogo' : 'listing'}</td>
              <td>{p.esFull ? 'Sí' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TablaSellers({ sellers }) {
  if (!sellers?.length) return <p className="vacio">Nivel 1 no identifica todos los vendedores; el nivel 2 (Fase 2) completa esta tabla.</p>
  return (
    <div className="tabla-envoltura">
      <table>
        <thead>
          <tr>
            <th>Vendedor</th>
            <th className="num">Items en top 50</th>
            <th className="num">% del listado</th>
          </tr>
        </thead>
        <tbody>
          {sellers.map((s) => (
            <tr key={s.vendedor}>
              <td>{s.vendedor}</td>
              <td className="num">{s.items}</td>
              <td className="num">{fmtPct(s.pctItems)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VistaReporte({ nichoId, alCambiarNichos }) {
  const [datos, setDatos] = useState(null)
  const [estado, setEstado] = useState('cargando') // cargando | listo | sin-datos | error
  const [error, setError] = useState(null)
  const [escaneando, setEscaneando] = useState(false)
  const encuesta = useRef(null)

  const cargar = useCallback(async () => {
    try {
      const cuerpo = await api.reporte(nichoId)
      setDatos(cuerpo)
      setEstado('listo')
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
    cargar()
    return () => clearInterval(encuesta.current)
  }, [cargar])

  // tras disparar un scan, refrescar hasta que llegue un reporte con fecha nueva
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

  if (estado === 'cargando') return <p className="vacio">Cargando reporte…</p>
  if (estado === 'error') return <p className="error-bloque">Error: {error}</p>
  if (estado === 'sin-datos') {
    return (
      <div>
        <p className="vacio">Aún no hay scans completados para este nicho (el primero corre solo al crearlo, toma ~1 min).</p>
        <button onClick={cargar}>Revisar de nuevo</button>
      </div>
    )
  }

  const { nicho, reporte } = datos
  const m = reporte.metricas

  return (
    <div>
      <div className="reporte-encabezado">
        <div>
          <h2>{nicho.keyword}</h2>
          <p className="reporte-fecha">
            Último scan: {fmtFecha(reporte.fecha)}
            {m.universo.totalResultadosBusqueda
              ? ` · ${fmtNum(m.universo.totalResultadosBusqueda)}${m.universo.totalEsMinimo ? '+' : ''} resultados en ML`
              : ''}
          </p>
        </div>
        <button onClick={escanear} disabled={escaneando}>
          {escaneando ? 'Escaneando…' : 'Re-escanear ahora'}
        </button>
      </div>

      <div className="tiles">
        <StatTile label="Productos analizados" value={fmtNum(m.universo.productosAnalizados)} detalle="top del listado" />
        <StatTile
          label="Precio mediana"
          value={fmtPrecio(m.precio.mediana)}
          detalle={`p25 ${fmtPrecio(m.precio.p25)} · p75 ${fmtPrecio(m.precio.p75)}`}
        />
        <StatTile
          label="Banda dominante"
          value={m.precio.bandaDominante ? `${fmtPrecio(m.precio.bandaDominante.desde)}–${fmtPrecio(m.precio.bandaDominante.hasta)}` : '—'}
          detalle={m.precio.bandaDominante ? `${fmtPct(m.precio.bandaDominante.pctItems)} de los items` : ''}
        />
        <StatTile
          label="Descuento promedio"
          value={fmtPct(m.precio.descuentoPromedioPct)}
          detalle={`${fmtPct(m.precio.pctConDescuento)} de items con descuento`}
        />
        <StatTile label="Sellers únicos" value={fmtNum(m.competencia.sellersUnicos)} detalle={`concentración top 3: ${fmtPct(m.competencia.concentracionTop3Pct)}`} />
        <StatTile label="Tiendas oficiales" value={fmtPct(m.competencia.pctTiendaOficial)} detalle="del top 50" />
        <StatTile label="Items con Full" value={fmtPct(m.competencia.pctFull)} detalle={`envío rápido: ${fmtPct(m.competencia.pctEnvioRapido)}`} />
        <StatTile label="Rating promedio" value={m.calidad.ratingPromedio ?? '—'} detalle={`${fmtPct(m.calidad.pctConRating)} con rating`} />
      </div>

      <section>
        <h3>Top productos</h3>
        <TablaProductos productos={reporte.topProductos ?? []} />
      </section>

      <section>
        <h3>Top sellers</h3>
        <TablaSellers sellers={reporte.topSellers} />
      </section>

      <p className="nota">
        Demanda (vendidos) y score de oportunidad llegan con la Fase 2 (scraper de detalle).
      </p>
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
        <span className="subtitulo">nichos en mercadolibre.cl</span>
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
        </aside>
        <main>
          {seleccionado ? (
            <VistaReporte key={seleccionado} nichoId={seleccionado} alCambiarNichos={cargarNichos} />
          ) : (
            <p className="vacio">Selecciona o crea un nicho para ver su reporte.</p>
          )}
        </main>
      </div>
    </div>
  )
}
