import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { IconoExterno, Cargando } from './ui.jsx'
import { MiniSerie } from './graficos.jsx'
import { fmtNum, fmtPrecio, fmtFecha } from '../lib/formato.js'

const FACTOR_VENTAS = 25 // misma heurística del score: ~1 reseña por cada 25 ventas

function deltas(mediciones) {
  if (!mediciones?.length) return null
  const ultima = mediciones[mediciones.length - 1]
  const previa = mediciones.length > 1 ? mediciones[mediciones.length - 2] : null
  const delta = (campo) =>
    previa && Number.isFinite(ultima[campo]) && Number.isFinite(previa[campo])
      ? ultima[campo] - previa[campo]
      : null
  return { ultima, dReviews: delta('numReviews'), dPrecio: delta('precio'), dVendidos: delta('vendidos') }
}

function FilaPropio({ p, onEliminar, onAbrir }) {
  const d = deltas(p.mediciones)
  return (
    <tr className="fila-clickable" onClick={() => onAbrir(p)} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(p) }}>
      <td className="celda-imagen">
        {p.imagen ? <img src={p.imagen} alt="" loading="lazy" width="36" height="36" /> : <span className="sin-imagen" />}
      </td>
      <td className="celda-titulo" title={p.titulo ?? p.sku}>
        {p.titulo ?? p.sku}
        {p.estadoMl && p.estadoMl !== 'active' ? (
          <span className="badge badge-neutro">{p.estadoMl === 'paused' ? 'pausada' : p.estadoMl}</span>
        ) : null}
      </td>
      <td className="num">
        {fmtPrecio(d?.ultima?.precio)}
        {d?.dPrecio ? (
          <span className={d.dPrecio > 0 ? 'delta delta-sube' : 'delta delta-baja'}>
            {d.dPrecio > 0 ? '▲' : '▼'}
          </span>
        ) : null}
      </td>
      <td>
        {p.buyBox ? (
          p.buyBox.estado === 'winning' ? (
            <span className="badge badge-full">ganando</span>
          ) : (
            <span className="badge badge-cn" title={p.buyBox.estado ?? ''}>
              {Number.isFinite(p.buyBox.precioParaGanar)
                ? `gana con ${fmtPrecio(p.buyBox.precioParaGanar)}`
                : 'compitiendo'}
            </span>
          )
        ) : (
          '—'
        )}
      </td>
      <td className="num">{fmtNum(d?.ultima?.stock)}</td>
      <td className="num">
        {fmtNum(d?.ultima?.numReviews)}
        {d?.dReviews > 0 ? <span className="delta delta-sube">+{d.dReviews}</span> : null}
      </td>
      <td className="num">
        {d?.dVendidos != null ? (
          <>
            {fmtNum(d.dVendidos)} <span className="badge badge-full">real</span>
          </>
        ) : Number.isFinite(d?.ultima?.vendidos) ? (
          `${fmtNum(d.ultima.vendidos)} acum.`
        ) : d?.dReviews != null ? (
          `~${fmtNum(d.dReviews * FACTOR_VENTAS)}`
        ) : (
          '—'
        )}
      </td>
      <td className="num">
        {p.ventas30d ? `${fmtPrecio(p.ventas30d.ingresosClp)} · ${fmtNum(p.ventas30d.unidades)}u` : '—'}
      </td>
      <td className="num">{fmtNum(d?.ultima?.visitas)}</td>
      <td className="num">{d?.ultima?.rating ?? '—'}</td>
      <td>
        {p.posicionReciente
          ? `#${p.posicionReciente.posicion} en “${p.posicionReciente.keyword}”`
          : <span className="vacio">fuera de listados trackeados</span>}
      </td>
      <td>
        <a href={p.url} target="_blank" rel="noreferrer" className="enlace-icono"
           aria-label="Abrir en Mercado Libre" onClick={(e) => e.stopPropagation()}>
          <IconoExterno />
        </a>
        <button className="enlace-boton" onClick={(e) => { e.stopPropagation(); onEliminar(p) }}>
          quitar
        </button>
      </td>
    </tr>
  )
}

function PanelPropio({ propio, onCerrar }) {
  const serie = (campo) => (propio.mediciones ?? []).map((m) => ({ fecha: m.fecha, valor: m[campo] }))
  return (
    <div className="panel-fondo" onClick={onCerrar}>
      <aside className="panel" onClick={(e) => e.stopPropagation()} aria-label="Serie del producto propio">
        <div className="panel-encabezado">
          {propio.imagen ? <img className="panel-imagen" src={propio.imagen} alt="" width="64" height="64" /> : null}
          <div>
            <h3>{propio.titulo ?? propio.sku}</h3>
            <p className="panel-meta">
              {propio.sku} · seguido desde {fmtFecha(propio.creadoEl)} ·{' '}
              {propio.mediciones?.length ?? 0} mediciones
            </p>
          </div>
          <button className="boton-cerrar" onClick={onCerrar} aria-label="Cerrar panel">✕</button>
        </div>
        <MiniSerie titulo="Precio" puntos={serie('precio')} formato={fmtPrecio} />
        <MiniSerie titulo="Vendidos acumulados (real)" puntos={serie('vendidos')} />
        <MiniSerie titulo="Stock" puntos={serie('stock')} />
        <MiniSerie titulo="Visitas (ventana 7d)" puntos={serie('visitas')} />
        <MiniSerie titulo="Reseñas acumuladas" puntos={serie('numReviews')} />
        <MiniSerie titulo="Rating" puntos={serie('rating')} />
      </aside>
    </div>
  )
}

export function MisProductos() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [url, setUrl] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [abierto, setAbierto] = useState(null)
  const [meli, setMeli] = useState(null)
  const [aviso, setAviso] = useState(null)

  const cargar = useCallback(() => {
    api.listarPropios().then(setDatos).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    cargar()
    const intervalo = setInterval(cargar, 30_000)
    return () => clearInterval(intervalo)
  }, [cargar])

  useEffect(() => {
    // al volver del callback OAuth el dashboard aterriza con ?meli=…: avisar y limpiar la URL
    const params = new URLSearchParams(window.location.search)
    const resultado = params.get('meli')
    if (resultado === 'error') {
      setError(`la conexión con Mercado Libre falló: ${params.get('detalle') ?? 'sin detalle'}`)
    }
    if (resultado) window.history.replaceState(null, '', window.location.pathname)
    api.meliEstado().then(setMeli).catch(() => setMeli(null))
  }, [])

  async function conectarMeli() {
    setError(null)
    try {
      const { url: urlOauth } = await api.meliConectar()
      window.location = urlOauth
    } catch (err) {
      setError(err.message)
    }
  }

  async function importarMeli() {
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      const r = await api.meliImportar()
      setAviso(
        `${r.importados} publicación(es) importada(s), ${r.yaSeguidos} ya seguida(s) de ${r.total} en tu cuenta` +
          (r.importados ? ' — midiendo ahora, los números aparecen en un par de minutos' : ''),
      )
      cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setOcupado(false)
    }
  }

  async function agregar(e) {
    e.preventDefault()
    if (!url.trim()) return
    setOcupado(true)
    setError(null)
    try {
      await api.crearPropio(url.trim())
      setUrl('')
      cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setOcupado(false)
    }
  }

  async function eliminar(p) {
    if (!confirm(`¿Dejar de seguir "${p.titulo ?? p.sku}"?`)) return
    try {
      await api.eliminarPropio(p._id)
      cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  async function medirAhora() {
    setOcupado(true)
    try {
      await api.medirPropios()
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
          <h2>Mis productos</h2>
          <p className="reporte-fecha">
            Seguimiento diario de tus publicaciones: precio, reseñas (≈ ventas) y posición orgánica.
          </p>
        </div>
        <div className="toolbar">
          {meli?.conectado ? (
            <>
              <span className="badge badge-full" title={`conectado el ${fmtFecha(meli.conectadoEl)}`}>
                ML: {meli.nickname ?? meli.userId}
              </span>
              {/* re-autorizar tras cambiar permisos de la app en DevCenter:
                  la nueva autorización trae los scopes nuevos al mismo token */}
              <button className="enlace-boton" onClick={conectarMeli}>
                reconectar
              </button>
              <button className="boton-secundario" onClick={importarMeli} disabled={ocupado}>
                {ocupado ? 'Importando…' : 'Importar mis publicaciones'}
              </button>
            </>
          ) : (
            <button className="boton-secundario" onClick={conectarMeli}>
              Conectar Mercado Libre
            </button>
          )}
          {datos?.propios?.length ? (
            <button className="boton-secundario" onClick={medirAhora} disabled={ocupado}>
              {ocupado ? 'Encolando…' : 'Medir ahora'}
            </button>
          ) : null}
        </div>
      </div>

      <form className="form-propio" onSubmit={agregar}>
        <input
          type="text"
          placeholder="Pega la URL de tu publicación en Mercado Libre…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={ocupado}
          aria-label="URL de tu publicación"
        />
        <button className="boton-primario" type="submit" disabled={ocupado || !url.trim()}>
          Seguir producto
        </button>
      </form>
      {error ? <p className="error-bloque">{error}</p> : null}
      {aviso ? <p className="nota">{aviso}</p> : null}

      {!datos ? (
        <Cargando texto="Cargando tus productos…" />
      ) : !datos.propios.length ? (
        <p className="vacio">
          Aún no sigues ningún producto. Pega la URL de una publicación tuya y el sistema la medirá
          todos los días: si aparece en los listados de tus nichos, también verás tu posición.
        </p>
      ) : (
        <div className="tabla-envoltura">
          <table>
            <thead>
              <tr>
                <th aria-label="imagen" />
                <th>Producto</th>
                <th className="num">Precio</th>
                <th>Caja de compra</th>
                <th className="num">Stock</th>
                <th className="num">Reseñas</th>
                <th className="num">Ventas (último período)</th>
                <th className="num">Ingresos 30d</th>
                <th className="num">Visitas 7d</th>
                <th className="num">Rating</th>
                <th>Posición orgánica</th>
                <th aria-label="acciones" />
              </tr>
            </thead>
            <tbody>
              {datos.propios.map((p) => (
                <FilaPropio key={p._id} p={p} onEliminar={eliminar} onAbrir={setAbierto} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="nota">
        Con la cuenta de Mercado Libre conectada, stock, ventas, visitas, ingresos y caja de compra
        vienen de la API oficial (exactos). "Caja de compra" aplica a publicaciones de catálogo: si
        no estás ganando, muestra el precio que la ganaría. "Ingresos 30d" suma tus órdenes pagadas
        reales. La chapa "real" marca ventas del período medidas por ML; la cifra con ~ es la
        estimación por reseñas (~{FACTOR_VENTAS} por reseña nueva).
      </p>

      {abierto ? <PanelPropio propio={abierto} onCerrar={() => setAbierto(null)} /> : null}
    </main>
  )
}
