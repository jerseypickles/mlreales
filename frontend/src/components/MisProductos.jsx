import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { IconoExterno, Cargando } from './ui.jsx'
import { MiniSerie } from './graficos.jsx'
import {
  Tag,
  ShoppingCart,
  DollarSign,
  PiggyBank,
  Percent,
  Eye,
  Star,
  Package,
  Sparkles,
  PackagePlus,
} from 'lucide-react'
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

// estado: 'buena' | 'mala' | 'atenta' | undefined — pinta el tile según el negocio
function Metrica({ etiqueta, children, alerta, estado, Icono }) {
  const clase = ['propio-metrica']
  if (estado) clase.push(`m-${estado}`)
  else if (alerta) clase.push('propio-metrica-alerta')
  return (
    <span className={clase.join(' ')}>
      <span className="propio-metrica-etiqueta">
        {Icono ? <Icono aria-hidden="true" /> : null}
        {etiqueta}
      </span>
      <span className="propio-metrica-valor">{children}</span>
    </span>
  )
}

// Tarjeta por producto: arriba lo que ES (foto, título, estado), al medio lo
// que MIDE (chips), abajo la optimización de Fable (nicho + estado + resumen)
function TarjetaPropio({ p, nichos, onEliminar, onAbrir, onCablear, onAuditar, onVerAuditoria }) {
  const d = deltas(p.mediciones)
  const a = p.auditoria
  const generando =
    a?.estado === 'generando' &&
    (!a.solicitadaEl || Date.now() - new Date(a.solicitadaEl).getTime() < 30 * 60e3)
  // ventas reales de órdenes en ventana de 7 días (igual que visitas y
  // conversión) — el delta de mediciones quedó obsoleto con el ciclo de 45 min
  const ventas = p.ventas7d
    ? `${fmtNum(p.ventas7d.unidades)} · 7d real`
    : p.ventas30d
      ? '0 · 7d real'
      : d?.dVendidos != null
        ? `${fmtNum(d.dVendidos)} real`
        : Number.isFinite(d?.ultima?.vendidos)
          ? `${fmtNum(d.ultima.vendidos)} acum.`
          : d?.dReviews != null
            ? `~${fmtNum(d.dReviews * FACTOR_VENTAS)}`
            : '—'
  return (
    <article className="propio-card">
      <div className="propio-encabezado">
        <button className="propio-foto" onClick={() => onAbrir(p)} aria-label="Ver series del producto">
          {p.imagen ? <img src={p.imagen} alt="" loading="lazy" width="56" height="56" /> : <span className="sin-imagen" />}
        </button>
        <div className="propio-titular">
          <h3 onClick={() => onAbrir(p)}>{p.titulo ?? p.sku}</h3>
          <p className="propio-sub">
            {p.estadoMl && p.estadoMl !== 'active' ? (
              <span className="badge badge-neutro">{p.estadoMl === 'paused' ? 'pausada' : p.estadoMl}</span>
            ) : null}
            {p.envioMl?.logistica ? (
              <span
                className={p.envioMl.logistica === 'fulfillment' ? 'badge badge-full' : 'badge badge-neutro'}
                title={`Logística según ML: ${p.envioMl.logistica}${p.envioMl.envioGratis ? ' · envío gratis' : ''}`}
              >
                {p.envioMl.logistica === 'fulfillment' ? 'Full' : p.envioMl.flex ? 'Flex' : 'colecta'}
              </span>
            ) : null}{' '}
            {p.posicionReciente
              ? `#${p.posicionReciente.posicion} en “${p.posicionReciente.keyword}”`
              : 'fuera de los listados trackeados'}
            {p.buyBox
              ? p.buyBox.estado === 'winning'
                ? ' · ganando la caja de compra'
                : Number.isFinite(p.buyBox.precioParaGanar)
                  ? ` · caja de compra: gana con ${fmtPrecio(p.buyBox.precioParaGanar)}`
                  : ' · compitiendo por la caja de compra'
              : ''}
          </p>
        </div>
        <div className="propio-acciones">
          <a href={p.url} target="_blank" rel="noreferrer" className="enlace-icono" aria-label="Abrir en Mercado Libre">
            <IconoExterno />
          </a>
          <button className="enlace-boton" onClick={() => onEliminar(p)}>
            quitar
          </button>
        </div>
      </div>

      <div className="propio-metricas" onClick={() => onAbrir(p)}>
        <Metrica etiqueta="Precio" Icono={Tag}>
          {fmtPrecio(d?.ultima?.precio)}
          {d?.dPrecio ? (
            <span className={d.dPrecio > 0 ? 'delta delta-sube' : 'delta delta-baja'}>{d.dPrecio > 0 ? '▲' : '▼'}</span>
          ) : null}
        </Metrica>
        <Metrica
          etiqueta="Ventas"
          Icono={ShoppingCart}
          estado={p.ventas7d?.unidades > 0 ? 'buena' : ventas.startsWith('0') || ventas === '—' ? 'mala' : undefined}
        >
          {ventas}
        </Metrica>
        <Metrica etiqueta="Ingresos 30d" Icono={DollarSign}>
          {p.ventas30d ? `${fmtPrecio(p.ventas30d.ingresosClp)} · ${fmtNum(p.ventas30d.unidades)}u` : '—'}
        </Metrica>
        <Metrica
          etiqueta="Margen 30d"
          Icono={PiggyBank}
          estado={p.margen30d ? (p.margen30d.margenClp < 0 ? 'mala' : 'buena') : p.ventas30d ? 'atenta' : undefined}
        >
          {p.margen30d
            ? fmtPrecio(p.margen30d.margenClp)
            : p.ventas30d && p.costoUnitarioClp == null
              ? 'falta costo'
              : '—'}
        </Metrica>
        <Metrica
          etiqueta="Conversión 7d"
          Icono={Percent}
          estado={p.conversion7d != null ? (p.conversion7d >= 3 ? 'buena' : undefined) : undefined}
        >
          {p.conversion7d != null ? `${p.conversion7d}%` : '—'}
        </Metrica>
        <Metrica etiqueta="Visitas 7d" Icono={Eye} estado={(d?.ultima?.visitas ?? 0) < 10 ? 'mala' : undefined}>
          {fmtNum(d?.ultima?.visitas)}
        </Metrica>
        <Metrica etiqueta="Reseñas" Icono={Star} estado={!d?.ultima?.numReviews ? 'mala' : 'buena'}>
          {fmtNum(d?.ultima?.numReviews)}
          {d?.dReviews > 0 ? <span className="delta delta-sube">+{d.dReviews}</span> : null}
          {d?.ultima?.rating ? ` ★${d.ultima.rating}` : ''}
        </Metrica>
        <Metrica
          etiqueta="Stock"
          Icono={Package}
          estado={Number.isFinite(d?.ultima?.stock) && d.ultima.stock <= 3 ? 'atenta' : undefined}
        >
          {fmtNum(d?.ultima?.stock)}
        </Metrica>
      </div>

      {p.impacto?.intervenciones?.length ? (
        <div className="lupa">
          <span className="lupa-titulo">Lupa · qué se cambió y si sirvió</span>
          <ul className="lupa-lista">
            {p.impacto.intervenciones.slice(-3).reverse().map((i, idx) => (
              <li key={idx} className={`lupa-${i.veredicto.replace('ó', 'o')}`}>
                <span className="lupa-que">
                  {i.tipo === 'titulo'
                    ? 'título'
                    : i.tipo === 'descripcion'
                      ? 'descripción'
                      : i.tipo === 'logistica'
                        ? 'logística'
                        : i.tipo}
                </span>
                <span className="lupa-fecha">{fmtFecha(i.fecha)}</span>
                <span className="lupa-veredicto">{i.veredicto}</span>
                <span className="lupa-lectura">{i.lectura}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {p.surtido?.sugeridos?.length ? (
        <div className="surtido">
          <span className="surtido-titulo">
            <PackagePlus aria-hidden="true" />
            Surtido que te falta · formatos que venden en “{p.surtido.keyword}” y no tienes
          </span>
          <div className="surtido-lista">
            {p.surtido.sugeridos.map((s) => (
              <a
                key={s.sku}
                className="surtido-item"
                href={s.url}
                target="_blank"
                rel="noreferrer"
                title={s.titulo}
              >
                <img src={s.imagen} alt="" loading="lazy" width="52" height="52" />
                <span className="surtido-datos">
                  <strong>
                    {s.unidades ? `${s.unidades} pcs` : 'formato premium'} · {fmtPrecio(s.precio)}
                  </strong>
                  <span className="surtido-prueba">
                    {s.ventasDia ? `${fmtNum(s.ventasDia)}/día` : `${fmtNum(s.numReviews)} reseñas`}
                    {s.esFull ? ' · Full' : ' · sin Full'}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <div className="propio-optimizacion">
        <span className="propio-optimizacion-marca">
          <Sparkles aria-hidden="true" />
          Fable
        </span>
        <select
          className="selector-nicho"
          value={p.nichoId ?? ''}
          onChange={(e) => onCablear(p, e.target.value || null)}
          aria-label="Nicho contra el que se optimiza"
        >
          <option value="">— elegir nicho —</option>
          {nichos.map((n) => (
            <option key={n._id} value={n._id}>
              {n.keyword}
            </option>
          ))}
        </select>
        {!p.nichoId ? (
          <span className="vacio">cablea un nicho para comparar contra los peces gordos</span>
        ) : generando ? (
          <span className="badge badge-neutro">leyendo a los ganadores del nicho…</span>
        ) : a?.estado === 'ok' ? (
          <>
            <button className="boton-secundario boton-chico" onClick={() => onVerAuditoria(p)}>
              ver optimización{a.resultado?.quickWins?.length ? ` (${a.resultado.quickWins.length})` : ''}
            </button>
            {a.resultado?.quickWins?.[0] ? (
              <span className="propio-quickwin" title={a.resultado.quickWins[0]}>
                1º: {a.resultado.quickWins[0]}
              </span>
            ) : null}
            {a.resultado?.expansionSurtido ? (
              <span className="propio-quickwin" title={a.resultado.expansionSurtido}>
                🧺 Surtido: {a.resultado.expansionSurtido}
              </span>
            ) : null}
          </>
        ) : (
          <button
            className="boton-secundario boton-chico"
            title={
              a?.estado === 'error'
                ? `la anterior falló: ${a.error}`
                : 'Fable lee título, descripción, ficha y fotos reales de los peces gordos del nicho'
            }
            onClick={() => onAuditar(p)}
          >
            {a?.estado === 'error' ? 'reintentar optimización' : 'optimizar con Fable'}
          </button>
        )}
      </div>
    </article>
  )
}

function PanelPropio({ propio, onCerrar, onGuardarCosto }) {
  const serie = (campo) => (propio.mediciones ?? []).map((m) => ({ fecha: m.fecha, valor: m[campo] }))
  const [costo, setCosto] = useState(propio.costoUnitarioClp ?? '')
  const [guardando, setGuardando] = useState(false)
  async function guardarCosto(e) {
    e.preventDefault()
    setGuardando(true)
    try {
      await onGuardarCosto(propio, costo === '' ? null : Number(costo))
    } finally {
      setGuardando(false)
    }
  }
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
        <form className="form-nicho" onSubmit={guardarCosto}>
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Costo por unidad en bodega (CLP)"
            value={costo}
            onChange={(e) => setCosto(e.target.value)}
            aria-label="Costo unitario en CLP"
          />
          <button type="submit" className="boton-secundario" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar costo'}
          </button>
        </form>
        <p className="panel-meta">
          Con el costo real por unidad, cada venta calcula su margen: precio − comisión ML exacta − costo.
        </p>
        <div className="panel-graficos">
          <MiniSerie titulo="Vendidos acumulados (real)" puntos={serie('vendidos')} alto={110} />
          <MiniSerie titulo="Visitas (ventana 7d)" puntos={serie('visitas')} alto={110} />
          <MiniSerie titulo="Precio" puntos={serie('precio')} formato={fmtPrecio} alto={110} />
          <MiniSerie titulo="Stock" puntos={serie('stock')} alto={110} />
          <MiniSerie titulo="Reseñas acumuladas" puntos={serie('numReviews')} alto={110} />
          <MiniSerie titulo="Rating" puntos={serie('rating')} alto={110} />
        </div>
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
function PanelAuditoria({ propio, onCerrar, onRegenerar, onAplicar, aplicando, onRevisarFicha, revisandoFicha }) {
  const a = propio.auditoria
  const r = a?.resultado
  if (!r) return null
  const aplicadoTitulo = (a.aplicado ?? []).filter((x) => x.campo === 'titulo').map((x) => x.valor)
  const descripcionAplicada = (a.aplicado ?? []).some((x) => x.campo === 'descripcion')
  const miPrimeraFoto = a.miPublicacion?.fotos?.[0] ?? propio.imagen ?? null
  return (
    <div className="panel-fondo" onClick={onCerrar}>
      <aside className="panel panel-ancho" onClick={(e) => e.stopPropagation()} aria-label="Auditoría de listing">
        <div className="panel-encabezado">
          {propio.imagen ? <img className="panel-imagen" src={propio.imagen} alt="" width="64" height="64" /> : null}
          <div>
            <h3>{propio.titulo ?? propio.sku}</h3>
            <p className="panel-meta">
              Fable leyó el título, la descripción, la ficha
              {a.fotosAnalizadas ? ' y las fotos reales' : ''} de los {a.competidores?.length ?? 0} peces
              gordos de “{a.keyword}” y los comparó con tu publicación · {fmtFecha(a.generadoEl)} · US${' '}
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
          <h4>Los peces gordos que Fable leyó</h4>
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th aria-label="imagen" />
                  <th>Publicación</th>
                  <th className="num">Pos.</th>
                  <th className="num">Precio</th>
                  <th className="num">Reseñas</th>
                  <th className="num">Rating</th>
                  <th className="num">Ventas/día</th>
                  <th className="num">Fotos</th>
                </tr>
              </thead>
              <tbody>
                <tr className="fila-mia">
                  <td className="celda-imagen">
                    {propio.imagen ? <img src={propio.imagen} alt="" width="36" height="36" /> : null}
                  </td>
                  <td className="celda-titulo" title={a.miPublicacion?.titulo ?? ''}>
                    <strong>Tu publicación</strong>
                  </td>
                  <td className="num">
                    {a.miPublicacion?.posicionEnElListado ? `#${a.miPublicacion.posicionEnElListado}` : 'fuera'}
                  </td>
                  <td className="num">{fmtPrecio(a.miPublicacion?.precio)}</td>
                  <td className="num">{fmtNum(a.miPublicacion?.numReviews)}</td>
                  <td className="num">{a.miPublicacion?.rating ?? '—'}</td>
                  <td className="num">—</td>
                  <td className="num">{fmtNum(a.miPublicacion?.numFotos)}</td>
                </tr>
                {(a.competidores ?? []).map((c) => (
                  <tr key={c.sku}>
                    <td className="celda-imagen">
                      {c.imagen ? <img src={c.imagen} alt="" loading="lazy" width="36" height="36" /> : null}
                    </td>
                    <td className="celda-titulo" title={c.titulo}>
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noreferrer">
                          {c.titulo}
                        </a>
                      ) : (
                        c.titulo
                      )}
                    </td>
                    <td className="num">{c.posicion ? `#${c.posicion}` : '—'}</td>
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
          <h4>Primera foto: tú contra ellos</h4>
          <p className="auditoria-diagnostico">
            La primera foto decide el clic en una miniatura de 100 px. Compárala tú también:
          </p>
          <div className="fotos-cara-a-cara">
            <figure className="foto-vs foto-vs-mia">
              {miPrimeraFoto ? <img src={miPrimeraFoto} alt="Tu primera foto" loading="lazy" /> : <span className="sin-imagen" />}
              <figcaption>Tú</figcaption>
            </figure>
            {(a.competidores ?? []).map((c) => {
              const foto = c.fotos?.[0] ?? c.imagen
              return foto ? (
                <figure className="foto-vs" key={c.sku}>
                  <a href={c.url ?? undefined} target="_blank" rel="noreferrer">
                    <img src={foto} alt="" loading="lazy" />
                  </a>
                  <figcaption>{fmtNum(c.numReviews)} reseñas</figcaption>
                </figure>
              ) : null
            })}
          </div>
        </section>

        <section>
          <h4>Título</h4>
          <p className="auditoria-diagnostico">{r.titulo?.diagnostico}</p>
          {a.pesos?.length ? (
            <>
              <p className="dato-label">Peso de búsqueda medido (autocompletado de ML)</p>
              <div className="chips listing-chips">
                {a.pesos.map((p) => (
                  <span
                    className={`chip chip-peso-${p.peso}`}
                    key={p.frase}
                    title={
                      p.peso === 'nulo'
                        ? 'ML no la sugiere: nadie la escribe así'
                        : `aparece tecleando “${p.prefijo}”${p.posicion ? `, en posición ${p.posicion}` : ''}`
                    }
                  >
                    {p.frase} · {p.peso}
                  </span>
                ))}
              </div>
            </>
          ) : a.busquedasReales && Object.keys(a.busquedasReales).length ? (
            <>
              <p className="dato-label">Lo que la gente escribe de verdad (autocompletado ML, por volumen)</p>
              <div className="chips listing-chips">
                {[...new Set(Object.values(a.busquedasReales).flat())].slice(0, 14).map((b) => (
                  <span className="chip" key={b}>
                    {b}
                  </span>
                ))}
              </div>
            </>
          ) : null}
          {!a.busquedasReales || !Object.keys(a.busquedasReales).length ? (
            <p className="error-bloque">
              El autocompletado de ML no respondió en esta corrida: estas propuestas NO están validadas por
              volumen de búsqueda. Vuelve a optimizar antes de usarlas.
            </p>
          ) : a.arranquesSinVolumen?.length ? (
            <p className="error-bloque">
              Ojo: {a.arranquesSinVolumen.length} propuesta(s) arrancan con una frase que el autocompletado no
              registra — prefiere las que parten con una búsqueda real.
            </p>
          ) : null}
          <p className="nota">
            ML no deja cambiar el título por API en publicaciones nuevas (formato user products): copia el
            texto y pégalo en tu publicación. El color final ("Negro", "Rosa"…) lo agrega ML solo.
          </p>
          <SeccionFallas fallas={r.titulo?.fallas} />
          {a.miPublicacion?.titulo ? (
            <div className="listing-titulo titulo-actual">
              <span className="listing-titulo-texto">{a.miPublicacion.titulo}</span>
              <span className="contador">{a.miPublicacion.titulo.length}/60 · actual</span>
            </div>
          ) : null}
          <div className="listing-titulos">
            {(r.titulo?.propuestas ?? []).map((t, i) => (
              <div className="listing-titulo" key={i}>
                <span className="listing-titulo-texto">{t}</span>
                <span className={t.length > 60 ? 'contador excedido' : 'contador'}>{t.length}/60</span>
                <BotonCopiar texto={t} etiqueta="Copiar" />
                <a
                  className="copiar"
                  href={`https://www.mercadolibre.cl/publicaciones/${propio.itemIdMl ?? propio.sku}/modificar`}
                  target="_blank"
                  rel="noreferrer"
                  title="Abre la publicación en Mercado Libre para pegar el título (ML no permite cambiarlo por API en publicaciones nuevas)"
                >
                  Copiar y editar en ML ↗
                </a>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="listing-seccion-encabezado">
            <h4>Descripción</h4>
            {r.descripcion?.propuesta ? (
              <span className="acciones-inline">
                <BotonCopiar texto={r.descripcion.propuesta} etiqueta="Copiar propuesta" />
                {descripcionAplicada ? (
                  <span className="badge badge-full">en ML ✓</span>
                ) : (
                  <button
                    className="copiar"
                    disabled={aplicando}
                    onClick={() => {
                      if (confirm('¿Reemplazar la descripción de la publicación en Mercado Libre por la propuesta?')) {
                        onAplicar(propio, { descripcion: r.descripcion.propuesta })
                      }
                    }}
                  >
                    {aplicando ? 'Aplicando…' : 'Aplicar en ML'}
                  </button>
                )}
              </span>
            ) : null}
          </div>
          <p className="auditoria-diagnostico">{r.descripcion?.diagnostico}</p>
          <SeccionFallas fallas={r.descripcion?.fallas} />
          {a.miPublicacion?.descripcion ? (
            <details className="descripcion-actual">
              <summary>Ver tu descripción actual</summary>
              <pre className="listing-descripcion">{a.miPublicacion.descripcion}</pre>
            </details>
          ) : null}
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

        <section>
          <div className="listing-seccion-encabezado">
            <h4>Características (ficha técnica)</h4>
            <button className="copiar" disabled={revisandoFicha} onClick={() => onRevisarFicha(propio)}>
              {revisandoFicha ? 'Revisando…' : a.ficha ? 'Revisar de nuevo' : 'Revisar ficha con Fable'}
            </button>
          </div>
          {a.ficha ? (
            <>
              <p className="auditoria-diagnostico">{a.ficha.diagnostico}</p>
              {a.ficha.correcciones?.length ? (
                <>
                  <div className="tabla-envoltura">
                    <table>
                      <thead>
                        <tr>
                          <th>Atributo</th>
                          <th>Valor propuesto</th>
                          <th>Por qué</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.ficha.correcciones.map((c) => (
                          <tr key={c.id}>
                            <td className="celda-secundaria sin-corte">{c.nombre}</td>
                            <td><strong>{c.valor}</strong></td>
                            <td className="celda-secundaria">{c.razon}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(a.aplicado ?? []).some((x) => x.campo === 'atributos') ? (
                    <p className="nota">Ficha aplicada en ML ✓</p>
                  ) : (
                    <button
                      className="boton-secundario boton-chico"
                      disabled={aplicando}
                      onClick={() => {
                        if (confirm(`¿Escribir ${a.ficha.correcciones.length} atributo(s) de la ficha en Mercado Libre?`)) {
                          onAplicar(propio, { atributos: a.ficha.correcciones.map((c) => ({ id: c.id, valor: c.valor })) })
                        }
                      }}
                    >
                      {aplicando ? 'Aplicando…' : 'Aplicar ficha en ML'}
                    </button>
                  )}
                </>
              ) : (
                <p className="nota">La ficha está bien: sin correcciones con evidencia.</p>
              )}
              {a.ficha.faltanSinDato?.length ? (
                <p className="vacio">
                  Faltan datos que solo tú sabes: {a.ficha.faltanSinDato.join(' · ')}
                </p>
              ) : null}
            </>
          ) : (
            <p className="vacio">
              Fable compara tus Características contra lo que la categoría define y lo que los ganadores
              llenan — y las corrige por API.
            </p>
          )}
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
  const [aplicando, setAplicando] = useState(false)
  const [revisandoFicha, setRevisandoFicha] = useState(false)

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

  async function aplicarEnMl(p, cambios) {
    setAplicando(true)
    setError(null)
    try {
      const { resultado } = await api.aplicarPropio(p._id, cambios)
      const fallas = Object.entries(resultado)
        .filter(([, v]) => !v.ok)
        .map(([campo, v]) => `${campo}: ${v.error}`)
      if (fallas.length) setError(`Mercado Libre rechazó ${fallas.join(' · ')}`)
      else setAviso('Cambio aplicado en Mercado Libre ✓ (puede tardar unos minutos en verse)')
      cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setAplicando(false)
    }
  }

  async function revisarFicha(p) {
    setRevisandoFicha(true)
    setError(null)
    try {
      await api.revisarFicha(p._id)
      cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setRevisandoFicha(false)
    }
  }

  async function auditar(p) {
    setError(null)
    setAuditoriaDe(null)
    try {
      await api.auditarPropio(p._id)
      setAviso(
        'Fable está leyendo el título, la descripción, la ficha y las fotos de los peces gordos del nicho — la optimización aparece aquí en 2-5 minutos.',
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
            Se actualiza solo: ventas, visitas y stock por API oficial cada ~45 min; detalle completo y
            publicaciones nuevas a diario; optimización los martes.
          </p>
          {datos?.calibracion ? (
            <p
              className="reporte-fecha"
              title="Ventas reales de tu cuenta vs reseñas nuevas de tus publicaciones desde la primera venta: el ancla que convierte el factor teórico 25 en dato. Converge a medida que vendes."
            >
              Calibración reseñas→ventas: {fmtNum(datos.calibracion.ventas)} venta(s) real(es) ·{' '}
              {fmtNum(datos.calibracion.resenasNuevas)} reseña(s) nueva(s) →{' '}
              {datos.calibracion.factorObservado != null
                ? `factor observado ${datos.calibracion.factorObservado} (teórico 25)`
                : 'factor aún sin datos: falta la primera reseña propia (teórico 25)'}
            </p>
          ) : null}
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
        <div className="propios-lista">
          {datos.propios.map((p) => (
            <TarjetaPropio
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
        </div>
      )}

      <p className="nota">
        Con la cuenta de Mercado Libre conectada, stock, ventas, visitas, ingresos y caja de compra
        vienen de la API oficial (exactos). "Caja de compra" aplica a publicaciones de catálogo: si
        no estás ganando, muestra el precio que la ganaría. "Ingresos 30d" suma tus órdenes pagadas
        reales. La chapa "real" marca ventas del período medidas por ML; la cifra con ~ es la
        estimación por reseñas (~{FACTOR_VENTAS} por reseña nueva). Cablea un nicho del tablero y
        "optimizar con Fable" lee el título, la descripción, la ficha y las fotos reales de los
        peces gordos del listado (los que más han vendido) y te dice dónde estás fallando, con
        títulos, descripción y plan de fotos listos para pegar.
      </p>

      {abierto ? (
        <PanelPropio
          propio={abierto}
          onCerrar={() => setAbierto(null)}
          onGuardarCosto={async (p, costo) => {
            try {
              await api.ajustarPropio(p._id, { costoUnitarioClp: costo })
              cargar()
            } catch (err) {
              setError(err.message)
            }
          }}
        />
      ) : null}
      {(() => {
        // el panel lee del listado fresco: si se re-audita, se actualiza solo
        const propioAuditado = datos?.propios?.find((x) => x._id === auditoriaDe)
        return propioAuditado?.auditoria?.estado === 'ok' ? (
          <PanelAuditoria
            propio={propioAuditado}
            onCerrar={() => setAuditoriaDe(null)}
            onRegenerar={auditar}
            onAplicar={aplicarEnMl}
            aplicando={aplicando}
            onRevisarFicha={revisarFicha}
            revisandoFicha={revisandoFicha}
          />
        ) : null
      })()}
    </main>
  )
}
