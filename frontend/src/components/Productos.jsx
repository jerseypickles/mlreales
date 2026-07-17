import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { Badge, IconoExterno, RepSeller, Cargando } from './ui.jsx'
import { MiniSerie } from './graficos.jsx'
import { fmtNum, fmtPrecio, fmtFecha } from '../lib/formato.js'

const ORDENES = {
  posicion: { etiqueta: 'Posición', fn: (a, b) => (a.posicion ?? Infinity) - (b.posicion ?? Infinity) },
  precioAsc: { etiqueta: 'Precio ↑', fn: (a, b) => (a.precio ?? Infinity) - (b.precio ?? Infinity) },
  precioDesc: { etiqueta: 'Precio ↓', fn: (a, b) => (b.precio ?? -1) - (a.precio ?? -1) },
  reviews: { etiqueta: 'Reseñas ↓', fn: (a, b) => (b.numReviews ?? -1) - (a.numReviews ?? -1) },
  rating: { etiqueta: 'Rating ↓', fn: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) },
  descuento: { etiqueta: 'Descuento ↓', fn: (a, b) => (b.descuentoPct ?? -1) - (a.descuentoPct ?? -1) },
}

function FilaProducto({ p, onAbrir }) {
  return (
    <tr onClick={() => onAbrir(p)} className="fila-clickable" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(p) }}>
      <td className="num">{p.posicion ?? '—'}</td>
      <td className="celda-imagen">
        {p.imagen ? <img src={p.imagen} alt="" loading="lazy" width="36" height="36" /> : <span className="sin-imagen" />}
      </td>
      <td className="celda-titulo" title={p.titulo ?? p.sku}>
        {p.titulo ?? p.sku}
      </td>
      <td className="num">{fmtPrecio(p.precio)}</td>
      <td className="num">{Number.isFinite(p.descuentoPct) ? `-${p.descuentoPct}%` : '—'}</td>
      <td className="num">{p.rating || '—'}</td>
      <td className="num">{fmtNum(p.numReviews)}</td>
      <td>
        <span className="celda-vendedor">
          <span>{p.vendedor ?? '—'}</span>
          {p.esTiendaOficial ? <Badge tipo="oficial">Oficial</Badge> : null}
          <RepSeller reputacion={p.reputacionSeller} powerSeller={p.powerSeller} />
        </span>
      </td>
      <td>
        {p.esFull ? <Badge tipo="full">Full</Badge> : null}
        {p.origenCrossBorder ? <Badge tipo="cn" title="Despachado desde China (cross-border)">CN</Badge> : null}
      </td>
      <td>
        {p.url ? (
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="enlace-icono"
            aria-label={`Abrir ${p.titulo ?? p.sku} en Mercado Libre`}
            onClick={(e) => e.stopPropagation()}
          >
            <IconoExterno />
          </a>
        ) : null}
      </td>
    </tr>
  )
}

function PanelHistoria({ producto, onCerrar, onSimular }) {
  const [historia, setHistoria] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true
    setHistoria(null)
    setError(null)
    api
      .historia(producto.sku)
      .then((h) => vigente && setHistoria(h))
      .catch((e) => vigente && setError(e.message))
    return () => {
      vigente = false
    }
  }, [producto.sku])

  const serie = (campo) =>
    (historia?.snapshots ?? []).map((s) => ({ fecha: s.fecha, valor: s[campo] }))

  return (
    <div className="panel-fondo" onClick={onCerrar}>
      <aside className="panel" onClick={(e) => e.stopPropagation()} aria-label="Historia del producto">
        <div className="panel-encabezado">
          {producto.imagen ? (
            <img className="panel-imagen" src={producto.imagen} alt="" width="64" height="64" />
          ) : null}
          <div>
            <h3>{producto.titulo ?? producto.sku}</h3>
            <p className="panel-meta">
              {producto.sku} · {producto.tipoListing === 'catalogo' ? 'catálogo' : 'listing'} ·{' '}
              {producto.vendedor ?? 'vendedor desconocido'}
              {producto.esTiendaOficial ? ' · tienda oficial' : ''}
              {producto.origenCrossBorder ? ' · despacha desde China' : ''}
            </p>
          </div>
          <button className="boton-cerrar" onClick={onCerrar} aria-label="Cerrar panel">
            ✕
          </button>
        </div>

        <div className="panel-acciones">
          {producto.url ? (
            <a className="boton-secundario" href={producto.url} target="_blank" rel="noreferrer">
              Ver en ML <IconoExterno />
            </a>
          ) : null}
          <button className="boton-secundario" onClick={() => onSimular(producto)}>
            Simular margen a {fmtPrecio(producto.precio)}
          </button>
        </div>

        {producto.preguntas?.length ? (
          <section className="panel-preguntas">
            <h4>Preguntas de compradores</h4>
            {producto.preguntas.map((q, i) => (
              <div className="pregunta" key={i}>
                <p className="pregunta-texto">{q.texto}</p>
                {q.respuesta ? <p className="pregunta-respuesta">{q.respuesta}</p> : null}
              </div>
            ))}
          </section>
        ) : null}

        {error ? <p className="error-bloque">{error}</p> : null}
        {!historia && !error ? <Cargando texto="Cargando historia…" /> : null}
        {historia ? (
          <>
            <MiniSerie titulo="Precio" puntos={serie('precio')} formato={fmtPrecio} />
            <MiniSerie titulo="Posición en el listado (1 = arriba)" puntos={serie('posicion')} invertirY />
            <MiniSerie titulo="Reseñas acumuladas" puntos={serie('numReviews')} />
            <h4>Snapshots ({historia.snapshots.length})</h4>
            <div className="tabla-envoltura">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th className="num">Precio</th>
                    <th className="num">Pos.</th>
                    <th className="num">Reseñas</th>
                    <th className="num">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {[...historia.snapshots].reverse().map((s) => (
                    <tr key={s._id}>
                      <td>{fmtFecha(s.fecha)}</td>
                      <td className="num">{fmtPrecio(s.precio)}</td>
                      <td className="num">{s.posicion ?? '—'}</td>
                      <td className="num">{fmtNum(s.numReviews)}</td>
                      <td className="num">{s.rating || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </aside>
    </div>
  )
}

export function Productos({ nichoId, onSimular }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState('posicion')
  const [filtros, setFiltros] = useState({ full: false, oficial: false, cn: false, catalogo: false })
  const [abierto, setAbierto] = useState(null)

  useEffect(() => {
    let vigente = true
    setDatos(null)
    setError(null)
    api
      .productosNicho(nichoId)
      .then((d) => vigente && setDatos(d))
      .catch((e) => vigente && setError(e.message))
    return () => {
      vigente = false
    }
  }, [nichoId])

  const visibles = useMemo(() => {
    if (!datos) return []
    const q = busqueda.trim().toLowerCase()
    return datos.productos
      .filter((p) => {
        if (q && !`${p.titulo ?? ''} ${p.vendedor ?? ''} ${p.sku}`.toLowerCase().includes(q)) return false
        if (filtros.full && !p.esFull) return false
        if (filtros.oficial && !p.esTiendaOficial) return false
        if (filtros.cn && !p.origenCrossBorder) return false
        if (filtros.catalogo && p.tipoListing !== 'catalogo') return false
        return true
      })
      .sort(ORDENES[orden].fn)
  }, [datos, busqueda, orden, filtros])

  if (error) return <p className="error-bloque">{error}</p>
  if (!datos) return <Cargando texto="Cargando productos…" />

  const chip = (clave, etiqueta, title) => (
    <button
      className={filtros[clave] ? 'chip activo' : 'chip'}
      onClick={() => setFiltros((f) => ({ ...f, [clave]: !f[clave] }))}
      aria-pressed={filtros[clave]}
      title={title}
    >
      {etiqueta}
    </button>
  )

  return (
    <div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por título, vendedor o SKU…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar productos"
        />
        <div className="chips">
          {chip('full', 'Full', 'Solo items con Mercado Envíos Full')}
          {chip('oficial', 'Tienda oficial', 'Solo tiendas oficiales')}
          {chip('cn', 'Desde China', 'Solo cross-border (competencia directa de importación)')}
          {chip('catalogo', 'Catálogo', 'Solo publicaciones de catálogo')}
        </div>
        <label className="orden">
          Ordenar
          <select value={orden} onChange={(e) => setOrden(e.target.value)}>
            {Object.entries(ORDENES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <span className="conteo">
          {visibles.length} de {datos.total}
        </span>
      </div>

      <div className="tabla-envoltura tabla-productos">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th aria-label="imagen" />
              <th>Producto</th>
              <th className="num">Precio</th>
              <th className="num">Desc.</th>
              <th className="num">Rating</th>
              <th className="num">Reseñas</th>
              <th>Vendedor</th>
              <th>Flags</th>
              <th aria-label="enlace" />
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <FilaProducto key={p.sku} p={p} onAbrir={setAbierto} />
            ))}
          </tbody>
        </table>
        {!visibles.length ? <p className="vacio con-margen">Ningún producto pasa los filtros.</p> : null}
      </div>

      {abierto ? (
        <PanelHistoria producto={abierto} onCerrar={() => setAbierto(null)} onSimular={onSimular} />
      ) : null}
    </div>
  )
}
