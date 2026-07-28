import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { IconoExterno, Cargando } from './ui.jsx'
import { MiniSerie } from './graficos.jsx'
import { BotonCopiar } from './Listing.jsx'
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

// Celda de auditoría: cablear el nicho + lanzar/ver la auditoría de listing
function CeldaAuditoria({ p, nichos, onCablear, onAuditar, onVerAuditoria }) {
  const a = p.auditoria
  // >30 min "generando" = job perdido (deploy en el medio): volver a ofrecer el botón
  const generando =
    a?.estado === 'generando' &&
    (!a.solicitadaEl || Date.now() - new Date(a.solicitadaEl).getTime() < 30 * 60e3)
  return (
    <td className="celda-auditoria" onClick={(e) => e.stopPropagation()}>
      <select
        className="selector-nicho"
        value={p.nichoId ?? ''}
        onChange={(e) => onCablear(p, e.target.value || null)}
        aria-label="Nicho contra el que se audita"
      >
        <option value="">— sin nicho —</option>
        {nichos.map((n) => (
          <option key={n._id} value={n._id}>
            {n.keyword}
          </option>
        ))}
      </select>
      {p.nichoId ? (
        generando ? (
          <span className="badge badge-neutro">auditando…</span>
        ) : a?.estado === 'ok' ? (
          <button className="enlace-boton" onClick={() => onVerAuditoria(p)}>
            ver auditoría
          </button>
        ) : (
          <button
            className="enlace-boton"
            title={a?.estado === 'error' ? `la anterior falló: ${a.error}` : undefined}
            onClick={() => onAuditar(p)}
          >
            {a?.estado === 'error' ? 'reintentar' : 'auditar'}
          </button>
        )
      ) : null}
    </td>
  )
}

function FilaPropio({ p, nichos, onEliminar, onAbrir, onCablear, onAuditar, onVerAuditoria }) {
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
      <CeldaAuditoria
        p={p}
        nichos={nichos}
        onCablear={onCablear}
        onAuditar={onAuditar}
        onVerAuditoria={onVerAuditoria}
      />
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

function SeccionFallas({ fallas }) {
  if (!fallas?.length) return null
  return (
    <ul className="lista-riesgos">
      {fallas.map((f, i) => (
        <li key={i}>{f}</li>
      ))}
    </ul>
  )
}

// Auditoría de listing: mi título/descripción/fotos vs los ganadores del nicho
function PanelAuditoria({ propio, onCerrar, onRegenerar }) {
  const a = propio.auditoria
  const r = a?.resultado
  if (!r) return null
  return (
    <div className="panel-fondo" onClick={onCerrar}>
      <aside className="panel panel-ancho" onClick={(e) => e.stopPropagation()} aria-label="Auditoría de listing">
        <div className="panel-encabezado">
          {propio.imagen ? <img className="panel-imagen" src={propio.imagen} alt="" width="64" height="64" /> : null}
          <div>
            <h3>{propio.titulo ?? propio.sku}</h3>
            <p className="panel-meta">
              auditado contra “{a.keyword}” · {fmtFecha(a.generadoEl)} ·{' '}
              {a.fotosAnalizadas ? 'fotos analizadas por IA' : 'fotos evaluadas solo por cantidad'} · US${' '}
              {a.costoUsd?.toFixed(2) ?? '—'}
            </p>
          </div>
          <div className="panel-acciones">
            <button className="boton-secundario" onClick={() => onRegenerar(propio)}>
              Re-auditar
            </button>
            <button className="boton-cerrar" onClick={onCerrar} aria-label="Cerrar panel">✕</button>
          </div>
        </div>

        <p className="auditoria-veredicto">{r.veredicto}</p>

        {r.quickWins?.length ? (
          <section>
            <h4>Primero lo que más mueve</h4>
            <ol className="lista-riesgos">
              {r.quickWins.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </section>
        ) : null}

        <section>
          <h4>Contra quién compites</h4>
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th>Publicación</th>
                  <th className="num">Precio</th>
                  <th className="num">Reseñas</th>
                  <th className="num">Rating</th>
                  <th className="num">Ventas/día</th>
                  <th className="num">Fotos</th>
                </tr>
              </thead>
              <tbody>
                <tr className="fila-mia">
                  <td className="celda-titulo" title={a.miPublicacion?.titulo ?? ''}>
                    <strong>Tu publicación</strong>
                  </td>
                  <td className="num">{fmtPrecio(a.miPublicacion?.precio)}</td>
                  <td className="num">{fmtNum(a.miPublicacion?.numReviews)}</td>
                  <td className="num">{a.miPublicacion?.rating ?? '—'}</td>
                  <td className="num">—</td>
                  <td className="num">{fmtNum(a.miPublicacion?.numFotos)}</td>
                </tr>
                {(a.competidores ?? []).map((c) => (
                  <tr key={c.sku}>
                    <td className="celda-titulo" title={c.titulo}>
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noreferrer">
                          {c.titulo}
                        </a>
                      ) : (
                        c.titulo
                      )}
                    </td>
                    <td className="num">{fmtPrecio(c.precio)}</td>
                    <td className="num">{fmtNum(c.numReviews)}</td>
                    <td className="num">{c.rating ?? '—'}</td>
                    <td className="num">{c.ventasDia != null ? `~${fmtNum(c.ventasDia)}` : '—'}</td>
                    <td className="num">{c.numFotos ? fmtNum(c.numFotos) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h4>Título</h4>
          <p className="auditoria-diagnostico">{r.titulo?.diagnostico}</p>
          <SeccionFallas fallas={r.titulo?.fallas} />
          <div className="listing-titulos">
            {(r.titulo?.propuestas ?? []).map((t, i) => (
              <div className="listing-titulo" key={i}>
                <span className="listing-titulo-texto">{t}</span>
                <span className={t.length > 60 ? 'contador excedido' : 'contador'}>{t.length}/60</span>
                <BotonCopiar texto={t} />
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="listing-seccion-encabezado">
            <h4>Descripción</h4>
            {r.descripcion?.propuesta ? <BotonCopiar texto={r.descripcion.propuesta} etiqueta="Copiar propuesta" /> : null}
          </div>
          <p className="auditoria-diagnostico">{r.descripcion?.diagnostico}</p>
          <SeccionFallas fallas={r.descripcion?.fallas} />
          {r.descripcion?.propuesta ? <pre className="listing-descripcion">{r.descripcion.propuesta}</pre> : null}
        </section>

        <section>
          <h4>Fotos</h4>
          <p className="auditoria-diagnostico">{r.fotos?.diagnostico}</p>
          <SeccionFallas fallas={r.fotos?.fallas} />
          {r.fotos?.plan?.length ? (
            <>
              <p className="dato-label">Plan de fotos (en orden)</p>
              <ol className="lista-riesgos">
                {r.fotos.plan.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ol>
            </>
          ) : null}
        </section>

        {r.otrasBrechas?.length ? (
          <section>
            <h4>Otras brechas</h4>
            <ul className="lista-riesgos">
              {r.otrasBrechas.map((b, i) => (
                <li key={i}>
                  <strong>{b.aspecto}:</strong> {b.detalle}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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
  const [nichos, setNichos] = useState([])
  const [auditoriaDe, setAuditoriaDe] = useState(null) // _id del propio con el panel de auditoría abierto

  const cargar = useCallback(() => {
    api.listarPropios().then(setDatos).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    cargar()
    const intervalo = setInterval(cargar, 30_000)
    return () => clearInterval(intervalo)
  }, [cargar])

  const cargarNichos = useCallback(() => {
    api
      .listarNichos()
      .then(({ nichos: lista }) => setNichos([...lista].sort((a, b) => a.keyword.localeCompare(b.keyword))))
      .catch(() => setNichos([]))
  }, [])

  useEffect(() => {
    cargarNichos()
  }, [cargarNichos])

  // mientras hay una auditoría generándose, refrescar más seguido que los 30 s de base
  const hayAuditoriaEnCurso = datos?.propios?.some(
    (p) =>
      p.auditoria?.estado === 'generando' &&
      (!p.auditoria.solicitadaEl || Date.now() - new Date(p.auditoria.solicitadaEl).getTime() < 30 * 60e3),
  )
  useEffect(() => {
    if (!hayAuditoriaEnCurso) return
    const intervalo = setInterval(cargar, 10_000)
    return () => clearInterval(intervalo)
  }, [hayAuditoriaEnCurso, cargar])

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

  async function cablearNicho(p, nichoId) {
    setError(null)
    try {
      await api.ajustarPropio(p._id, { nichoId })
      cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  async function autoCablear() {
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      const { resultados = [], omitido, motivo } = await api.autoCablearPropios()
      if (omitido) {
        setAviso(motivo)
        return
      }
      const cuenta = (accion) => resultados.filter((r) => r.accion === accion).length
      const partes = []
      const rankea = cuenta('rankea') + cuenta('existente')
      if (rankea) partes.push(`${rankea} cableado(s) a nichos existentes`)
      if (cuenta('creado'))
        partes.push(`${cuenta('creado')} nicho(s) nuevo(s) creados y escaneando (primeros datos en ~10-15 min)`)
      if (cuenta('presupuesto')) partes.push(`${cuenta('presupuesto')} sin crear por presupuesto mensual agotado`)
      if (cuenta('sin-keyword') + cuenta('sin-titulo'))
        partes.push(`${cuenta('sin-keyword') + cuenta('sin-titulo')} sin keyword clara (cablea a mano)`)
      if (cuenta('sin-ia')) partes.push(`${cuenta('sin-ia')} sin IA configurada`)
      setAviso(partes.length ? `Auto-cableado: ${partes.join(' · ')}.` : 'Auto-cableado sin cambios.')
      cargar()
      cargarNichos()
    } catch (err) {
      setError(err.message)
    } finally {
      setOcupado(false)
    }
  }

  async function auditar(p) {
    setError(null)
    setAuditoriaDe(null)
    try {
      await api.auditarPropio(p._id)
      setAviso(
        'Auditoría en curso: el actor está leyendo las publicaciones ganadoras del nicho — el resultado aparece aquí en 2-5 minutos.',
      )
      cargar()
    } catch (err) {
      setError(err.message)
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
          {datos?.propios?.some((p) => !p.nichoId) ? (
            <button
              className="boton-secundario"
              onClick={autoCablear}
              disabled={ocupado}
              title="Detecta el nicho de cada producto (por ranking o por título con IA); si no existe en el tablero, lo crea y lo escanea"
            >
              {ocupado ? 'Cableando…' : 'Cablear nichos (auto)'}
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
                <th>Nicho / auditoría</th>
                <th aria-label="acciones" />
              </tr>
            </thead>
            <tbody>
              {datos.propios.map((p) => (
                <FilaPropio
                  key={p._id}
                  p={p}
                  nichos={nichos}
                  onEliminar={eliminar}
                  onAbrir={setAbierto}
                  onCablear={cablearNicho}
                  onAuditar={auditar}
                  onVerAuditoria={(x) => setAuditoriaDe(x._id)}
                />
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
        estimación por reseñas (~{FACTOR_VENTAS} por reseña nueva). Cablea un nicho del tablero y
        "auditar" compara tu título, descripción y fotos contra las publicaciones que más han
        vendido en ese listado (la IA ve las fotos reales) y te dice dónde estás fallando, con
        arreglos listos para pegar.
      </p>

      {abierto ? <PanelPropio propio={abierto} onCerrar={() => setAbierto(null)} /> : null}
      {(() => {
        // el panel lee del listado fresco: si se re-audita, se actualiza solo
        const propioAuditado = datos?.propios?.find((x) => x._id === auditoriaDe)
        return propioAuditado?.auditoria?.estado === 'ok' ? (
          <PanelAuditoria
            propio={propioAuditado}
            onCerrar={() => setAuditoriaDe(null)}
            onRegenerar={auditar}
          />
        ) : null
      })()}
    </main>
  )
}
