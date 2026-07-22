import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Planilla } from './Planilla.jsx'
import { Cargando, IconoExterno } from './ui.jsx'
import { fmtPrecio, fmtFecha } from '../lib/formato.js'

// ── Planilla de cotización para el proveedor (RFQ) ───────────────────────
// Rediseño "mesa de compra": la tabla se agrupa en tres bandas — Tu decisión
// (interno), Hoja del proveedor (lo único que se exporta) y Cotización
// recibida (interno). El detalle completo de cada producto vive en un panel
// lateral (drawer) para que la tabla quede liviana.

// Nichos con la misma productoClave son la MISMA compra (un producto de
// fábrica, varias jugadas de listing): se fusionan en una fila — cantidad
// combinada, datos del miembro de mayor score, nichos listados en pantalla.
export function fusionarCompras(oportunidades) {
  const porClave = new Map()
  const resultado = []
  for (const o of oportunidades) {
    if (!o.productoClave) {
      resultado.push({ ...o, nichoIds: [o.nichoId] })
      continue
    }
    const grupo = porClave.get(o.productoClave)
    if (!grupo) {
      const fila = { ...o, nichosDelGrupo: [o.keyword], nichoIds: [o.nichoId] }
      porClave.set(o.productoClave, fila)
      resultado.push(fila)
    } else {
      grupo.nichosDelGrupo.push(o.keyword)
      grupo.nichoIds.push(o.nichoId)
      grupo.keyword = grupo.nichosDelGrupo.join(' + ')
      if (o.unidadesPrueba != null) {
        grupo.unidadesPrueba = (grupo.unidadesPrueba ?? 0) + o.unidadesPrueba
      }
      // el veredicto más fuerte del grupo manda en pantalla
      if (o.veredicto === 'entrar' && grupo.veredicto !== 'entrar') grupo.veredicto = 'entrar'
    }
  }
  return resultado
}

// sin etapa "muestra": la prueba real es el pedido mínimo (MOQ) que pida el
// proveedor — cotizando pasa directo a pedido y de ahí a vendiendo
export const ETAPAS = ['evaluando', 'cotizando', 'pedido', 'vendiendo', 'en-espera', 'descartado']
export const etiquetaEtapa = (e) => (e === 'pedido' ? 'pedido mínimo' : e.replace(/-/g, ' '))

const SIGUIENTE_ETAPA = { evaluando: 'cotizando', cotizando: 'pedido', pedido: 'vendiendo' }

const TABS_ETAPA = [
  ['por-cotizar', 'Por cotizar', (e) => e === 'evaluando'],
  ['cotizando', 'Cotizando', (e) => e === 'cotizando'],
  ['avanzados', 'Pedido mínimo · Vendiendo', (e) => ['pedido', 'vendiendo'].includes(e)],
  ['en-espera', 'En espera', (e) => e === 'en-espera'],
  ['todos', 'Todos', () => true],
]

const BANDAS = {
  decision: { titulo: 'Tu decisión', nota: 'solo en pantalla', clase: 'banda-decision' },
  proveedor: { titulo: 'Hoja del proveedor', nota: 'esto es lo que se exporta', clase: 'banda-proveedor' },
  cotiza: { titulo: 'Cotización recibida', nota: 'solo en pantalla', clase: 'banda-cotiza' },
}

function SelectorEtapa({ fila, onCambiada }) {
  const [cambiando, setCambiando] = useState(false)
  return (
    <select
      className="selector-etapa"
      value={fila.etapaCompra ?? 'evaluando'}
      disabled={cambiando}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        e.stopPropagation()
        setCambiando(true)
        try {
          await api.avanzarNichos(fila.nichoIds ?? [fila.nichoId], e.target.value)
          await onCambiada()
        } finally {
          setCambiando(false)
        }
      }}
      aria-label="Etapa de compra"
    >
      {ETAPAS.map((e) => (
        <option key={e} value={e}>{etiquetaEtapa(e)}</option>
      ))}
    </select>
  )
}

// Nota corta de la etapa ("esperando registro ISP", "pensándolo"): se edita
// en la misma fila y se guarda al salir del campo o con Enter.
function NotaEtapa({ fila, onCambiada }) {
  const [nota, setNota] = useState(fila.notaEtapa ?? '')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    if ((fila.notaEtapa ?? '') === nota.trim()) return
    setGuardando(true)
    try {
      const ids = fila.nichoIds ?? [fila.nichoId]
      await Promise.all(ids.map((id) => api.ajustarNicho(id, { notaEtapa: nota })))
      await onCambiada()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <input
      type="text"
      className="nota-etapa"
      value={nota}
      disabled={guardando}
      placeholder="nota…"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setNota(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur()
      }}
      aria-label="Nota de la etapa"
    />
  )
}

// EXW real que cotizó el proveedor: se anota aquí mismo y el sistema responde
// al instante si cierra contra el máximo y cuánto deja por unidad (mismo motor
// del simulador, con el flete real del contenedor). Se guarda al salir del campo.
function CotizacionExw({ fila, onCambiada }) {
  const [valor, setValor] = useState(fila.cotizacion?.exwUsd ?? '')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    setValor(fila.cotizacion?.exwUsd ?? '')
  }, [fila.nichoId, fila.cotizacion?.exwUsd])

  async function guardar() {
    const previo = fila.cotizacion?.exwUsd ?? ''
    if (String(previo) === String(valor).trim()) return
    setGuardando(true)
    try {
      const ids = fila.nichoIds ?? [fila.nichoId]
      await Promise.all(ids.map((id) => api.ajustarNicho(id, { exwCotizadoUsd: valor === '' ? null : Number(valor) })))
      await onCambiada()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <input
      type="number"
      className="exw-cotizado"
      value={valor}
      min="0"
      step="0.01"
      disabled={guardando}
      placeholder="US$…"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValor(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur()
      }}
      aria-label="EXW cotizado por el proveedor (USD)"
    />
  )
}

// Semáforo de la cotización: verde = cierra (con la ganancia estimada por
// unidad al precio recomendado), rojo = el proveedor se pasó del máximo.
function MargenCotizacion({ fila }) {
  const c = fila.cotizacion
  if (!c) return <span className="vacio">— esperando</span>
  if (c.cierra === false) {
    return (
      <span className="margen-cotizacion">
        <span className="veredicto veredicto-no_entrar" title={`Tu máximo pagable es US$ ${fila.exwMaximoUsd}`}>
          ✗ no cierra
        </span>
        <span className="margen-cifra mal">máx US$ {fila.exwMaximoUsd}</span>
      </span>
    )
  }
  if (c.margenClp != null) {
    return (
      <span
        className="margen-cotizacion"
        title={`Al precio recomendado (${fmtPrecio(fila.precioVentaClp)}), con flete de contenedor prorrateado. Afinación fina: simulador.`}
      >
        <span className={`veredicto ${c.viable ? 'veredicto-entrar' : 'veredicto-no_entrar'}`}>
          {c.viable ? '✓ cierra' : '✗ pierde'}
        </span>
        <span className={`margen-cifra ${c.viable ? '' : 'mal'}`}>
          {fmtPrecio(c.margenClp)}/u · {Math.round(c.margenPct)}%
        </span>
      </span>
    )
  }
  return <span className="veredicto veredicto-entrar">✓ cierra</span>
}

// Primera columna: el producto en inglés como identidad de compra, el o los
// nichos en chips debajo (con la marca de "misma compra" cuando se fusionan).
function CeldaProducto({ o }) {
  const kws = o.nichosDelGrupo ?? [o.keyword]
  return (
    <div className="pl-prod">
      <div className="pl-prod-en">
        {o.productoIngles ?? o.keyword}
        {!o.productoIngles ? <span className="pl-pend"> (pendiente de acotar)</span> : null}
      </div>
      <div className="pl-prod-chips">
        {o.nichosDelGrupo ? <span className="kw-chip kw-grupo">🔁 misma compra</span> : null}
        {(o.productoIngles ? kws : o.nichosDelGrupo ? kws : []).map((k) => (
          <span key={k} className="kw-chip">{k}</span>
        ))}
      </div>
    </div>
  )
}

function CeldaVeredicto({ o }) {
  return (
    <div className="pl-veredicto">
      <span className={`veredicto veredicto-${o.veredicto}`}>{o.veredicto.replace(/_/g, ' ')}</span>
      {o.confirmacion ? (
        <span className={`valida-linea ${o.confirmacion === 'confirmado' ? 'ok' : ''}`}>
          {o.confirmacion === 'confirmado' ? '✓ confirmado' : 'preliminar'}
          {o.scansConDemanda ? ` · ${o.scansConDemanda} scans` : ''}
          {o.frecuenciaScan === 'diario' ? ' · 🔍 lupa' : ''}
        </span>
      ) : null}
      {(o.tramites ? String(o.tramites).split(', ').filter(Boolean) : []).map((t) => (
        <span key={t} className="tramite-chip">{t}</span>
      ))}
    </div>
  )
}

// Embudo de compra como flujo: las tres etapas de avance con flechas, y al
// costado los estados sin flujo (en espera, todos).
function Embudo({ tab, setTab, conteoEtapa }) {
  const pill = (clave, etiqueta, fn) => (
    <button
      key={clave}
      role="tab"
      aria-selected={tab === clave}
      className={tab === clave ? 'etapa-pill activa' : 'etapa-pill'}
      onClick={() => setTab(clave)}
    >
      {etiqueta} <span className="n">{conteoEtapa(fn)}</span>
    </button>
  )
  const [porCotizar, cotizando, avanzados, enEspera, todos] = TABS_ETAPA
  return (
    <div className="embudo" role="tablist" aria-label="Etapa de compra">
      {pill(...porCotizar)}
      <span className="embudo-flecha">→</span>
      {pill(...cotizando)}
      <span className="embudo-flecha">→</span>
      {pill(...avanzados)}
      <span className="embudo-sep" />
      {pill(...enEspera)}
      {pill(...todos)}
    </div>
  )
}

// Escalera de precios EXW: dónde cayó la cotización del proveedor entre tu
// precio objetivo (ancla de negociación) y tu máximo pagable (nunca se muestra).
function EscaleraPrecios({ fila }) {
  const max = fila.exwMaximoUsd
  const objetivo = fila.exwObjetivoUsd
  const cotizado = fila.cotizacion?.exwUsd ?? null
  if (max == null) return null
  const tope = Math.max(max, cotizado ?? 0) * 1.08
  const pos = (v) => `${Math.min(96, Math.max(2, (v / tope) * 100))}%`
  return (
    <div className="escalera">
      <div className="esc-barra">
        {objetivo != null ? (
          <div className="esc-marca" style={{ left: pos(objetivo) }}>
            <span className="esc-tag arriba">objetivo <b>{objetivo}</b></span>
          </div>
        ) : null}
        {cotizado != null ? (
          <div className="esc-marca cotizado" style={{ left: pos(cotizado) }}>
            <span className="esc-tag abajo">cotizado <b>{cotizado}</b></span>
          </div>
        ) : null}
        <div className="esc-marca maximo" style={{ left: pos(max) }}>
          <span className="esc-tag arriba">máximo <b>{max}</b></span>
        </div>
      </div>
      <p className="esc-nota">
        {cotizado == null
          ? 'Aún sin cotización: negocia hacia tu objetivo. El máximo jamás se le muestra al proveedor.'
          : cotizado <= objetivo
            ? 'El proveedor cotizó en o bajo tu objetivo: excelente precio.'
            : cotizado <= max
              ? 'Cotizó entre tu objetivo y tu máximo: hay espacio para contraofertar. El máximo jamás se le muestra.'
              : 'Se pasó de tu máximo: contraoferta con el precio objetivo o descarta.'}
      </p>
    </div>
  )
}

// Panel lateral con el detalle completo del producto: análisis, escalera de
// precios, desglose del margen y acciones — lo que antes saturaba la tabla.
function DetalleProducto({ fila, otras = [], onCerrar, onCambiada, onAbrirNicho }) {
  const [avanzando, setAvanzando] = useState(false)
  const [unirCon, setUnirCon] = useState('')
  const [uniendo, setUniendo] = useState(false)
  const [errorCompra, setErrorCompra] = useState(null)
  if (!fila) return null
  const c = fila.cotizacion
  const siguiente = SIGUIENTE_ETAPA[fila.etapaCompra ?? 'evaluando']

  async function avanzar() {
    setAvanzando(true)
    try {
      await api.avanzarNichos(fila.nichoIds ?? [fila.nichoId], siguiente)
      await onCambiada()
    } finally {
      setAvanzando(false)
    }
  }

  // unir/separar compras: la clave manual manda sobre el juicio del acotador
  async function unir() {
    const otra = otras.find((o) => o.nichoId === unirCon)
    if (!otra) {
      setErrorCompra('Primero elige en el selector con qué compra unir.')
      return
    }
    setUniendo(true)
    setErrorCompra(null)
    try {
      await api.unirCompras([...(fila.nichoIds ?? [fila.nichoId]), ...(otra.nichoIds ?? [otra.nichoId])])
      setUnirCon('')
      await onCambiada()
    } catch (err) {
      setErrorCompra(`No se pudo unir: ${err.message}`)
    } finally {
      setUniendo(false)
    }
  }

  async function separar() {
    setUniendo(true)
    setErrorCompra(null)
    try {
      await api.separarCompra(fila.nichoIds ?? [fila.nichoId])
      await onCambiada()
    } catch (err) {
      setErrorCompra(`No se pudo separar: ${err.message}`)
    } finally {
      setUniendo(false)
    }
  }

  return (
    <>
      <div className="velo-detalle" onClick={onCerrar} />
      <aside className="drawer-detalle" role="dialog" aria-label="Detalle del producto">
        <div className="drawer-cab">
          <div className="drawer-titulo">
            <h3>{fila.productoIngles ?? fila.keyword}</h3>
            <button className="drawer-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
          </div>
          {fila.nichosDelGrupo ? (
            <p className="drawer-kw">🔁 misma compra: {fila.nichosDelGrupo.join(' + ')}</p>
          ) : (
            <p className="drawer-kw">{fila.keyword}</p>
          )}
          <div className="drawer-chips">
            <span className={`veredicto veredicto-${fila.veredicto}`}>{fila.veredicto.replace(/_/g, ' ')}</span>
            {fila.confianza ? <span className="veredicto chip-neutro">confianza {fila.confianza}</span> : null}
            {fila.confirmacion ? (
              <span className={`veredicto ${fila.confirmacion === 'confirmado' ? 'veredicto-entrar' : 'chip-neutro'}`}>
                {fila.confirmacion === 'confirmado' ? `✓ confirmado · ${fila.scansConDemanda} scans` : `preliminar · ${fila.scansConDemanda} scans`}
              </span>
            ) : null}
          </div>
        </div>

        <div className="drawer-cuerpo">
          {fila.resumen ? (
            <div className="drawer-seccion">
              <h4>Análisis</h4>
              <p className="drawer-resumen">{fila.resumen}</p>
              {fila.gemelosDetalle ? (
                <p className="drawer-gemelos">👥 sellers gemelos creciendo: {fila.gemelosDetalle}</p>
              ) : null}
            </div>
          ) : null}

          {fila.exwMaximoUsd != null ? (
            <div className="drawer-seccion">
              <h4>Escalera de precios EXW (US$/unidad)</h4>
              <EscaleraPrecios fila={fila} />
            </div>
          ) : null}

          {c?.margenClp != null ? (
            <div className="drawer-seccion">
              <h4>Margen si compras a US$ {c.exwUsd}</h4>
              <table className="desglose">
                <tbody>
                  <tr><td>Precio de venta (ML)</td><td>{fmtPrecio(fila.precioVentaClp)}</td></tr>
                  {c.landedClp != null ? (
                    <tr><td>Costo puesto en Chile (EXW + flete contenedor + aduana)</td><td>{fmtPrecio(c.landedClp)}</td></tr>
                  ) : null}
                  {c.comisionClp != null ? (
                    <tr><td>Comisión ML + Full</td><td>{fmtPrecio(c.comisionClp)}</td></tr>
                  ) : null}
                  <tr className={c.viable ? 'total' : 'total mal'}>
                    <td>Margen por unidad · {Math.round(c.margenPct)}% sobre venta</td>
                    <td>{fmtPrecio(c.margenClp)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="drawer-seccion">
            <h4>Cotización del proveedor (EXW US$)</h4>
            <div className="drawer-linea">
              <CotizacionExw fila={fila} onCambiada={onCambiada} />
              <MargenCotizacion fila={fila} />
            </div>
            {c?.fecha ? <p className="drawer-meta">anotada el {fmtFecha(c.fecha)}</p> : null}
          </div>

          <div className="drawer-seccion">
            <h4>Etapa</h4>
            <div className="drawer-linea">
              <SelectorEtapa fila={fila} onCambiada={onCambiada} />
              <NotaEtapa fila={fila} onCambiada={onCambiada} />
            </div>
          </div>

          <div className="drawer-seccion">
            <h4>Compra</h4>
            {fila.nichosDelGrupo ? (
              <>
                <p className="drawer-meta">
                  🔁 Una sola compra de fábrica para: {fila.nichosDelGrupo.join(' + ')}
                </p>
                <button className="boton-secundario" onClick={separar} disabled={uniendo}>
                  {uniendo ? 'Separando…' : 'Separar en compras distintas'}
                </button>
              </>
            ) : otras.length ? (
              <div className="drawer-linea">
                <select
                  className="selector-etapa"
                  value={unirCon}
                  onChange={(e) => setUnirCon(e.target.value)}
                  aria-label="Unir con otra compra"
                >
                  <option value="">Unir con… (misma caja de fábrica)</option>
                  {otras.map((o) => (
                    <option key={o.nichoId} value={o.nichoId}>
                      {o.productoIngles ?? o.keyword}
                    </option>
                  ))}
                </select>
                <button className="boton-secundario" onClick={unir} disabled={uniendo}>
                  {uniendo ? 'Uniendo…' : '🔁 Unir'}
                </button>
              </div>
            ) : (
              <p className="drawer-meta">No hay otras compras con las que unir.</p>
            )}
            {errorCompra ? <p className="error-bloque">{errorCompra}</p> : null}
          </div>
        </div>

        <div className="drawer-pie">
          {onAbrirNicho ? (
            <button className="boton-secundario" onClick={() => onAbrirNicho(fila.nichoId)}>
              Abrir nicho
            </button>
          ) : null}
          {siguiente ? (
            <button className="boton-primario drawer-avanzar" onClick={avanzar} disabled={avanzando}>
              {avanzando ? 'Avanzando…' : `Pasar a ${etiquetaEtapa(siguiente)} →`}
            </button>
          ) : null}
        </div>
      </aside>
    </>
  )
}

function PlanillaIA({ onAbrirNicho }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [acotando, setAcotando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [tab, setTab] = useState('por-cotizar')
  const [detalleId, setDetalleId] = useState(null)

  const cargar = () =>
    // solo entrar / entrar_con_condiciones de nichos activos: esta es la
    // planilla de compra que se trabaja con proveedores
    api.oportunidades().then((d) => ({
      ...d,
      // trámites como texto para que la grilla y la descarga lo traten plano;
      // cotización aplanada para que ordenar/filtrar la vean
      oportunidades: d.oportunidades.map((o) => ({
        ...o,
        etapaCompra: o.etapaCompra ?? 'evaluando',
        tramites: (o.tramites ?? []).join(', ') || null,
        exwCotizado: o.cotizacion?.exwUsd ?? null,
        margenCotizacion: o.cotizacion?.margenClp ?? null,
      })),
    }))

  useEffect(() => {
    let vigente = true
    cargar()
      .then((d) => vigente && setDatos(d))
      .catch((e) => vigente && setError(e.message))
    return () => {
      vigente = false
    }
  }, [])

  async function acotarConIA() {
    setAcotando(true)
    setAviso(null)
    try {
      // el clic manual siempre regenera TODO con la evidencia de títulos: si
      // el usuario aprieta este botón es porque algo de la hoja está malo
      const r = await api.generarRfq(true)
      setDatos(await cargar())
      setAviso(
        r.generados
          ? `${r.generados} nicho(s) re-acotados en inglés con los títulos del top como evidencia (US$ ${r.costoUsd?.toFixed?.(3) ?? '?'}).`
          : 'Todos los nichos ya estaban al día.',
      )
    } catch (e) {
      setError(e.message)
    } finally {
      setAcotando(false)
    }
  }

  if (error) return <p className="error-bloque">Error: {error}</p>
  if (!datos) return <Cargando texto="Cargando recomendaciones…" />
  if (!datos.oportunidades.length) {
    return (
      <p className="vacio">
        Aún no hay nichos con veredicto de entrada. Cuando la IA recomiende entrar (o entrar con
        condiciones), cada recomendación aparece aquí como fila lista para trabajar con el proveedor.
      </p>
    )
  }

  const recargar = async () => setDatos(await cargar())
  const pendientes = datos.oportunidades.filter((o) => !o.nichoIngles).length
  const filtroTab = TABS_ETAPA.find(([clave]) => clave === tab)?.[2] ?? (() => true)
  const filas = fusionarCompras(datos.oportunidades.filter((o) => filtroTab(o.etapaCompra)))
  const todasLasFilas = fusionarCompras(datos.oportunidades)
  // las pastillas cuentan COMPRAS (filas fusionadas), igual que la tabla:
  // dos nichos unidos en una compra son 1, no 2
  const conteoEtapa = (fn) => fusionarCompras(datos.oportunidades.filter((o) => fn(o.etapaCompra))).length
  const filaDetalle = detalleId
    ? todasLasFilas.find((f) => (f.nichoIds ?? [f.nichoId]).includes(detalleId)) ?? null
    : null

  const cierran = filas.filter((f) => f.cotizacion && f.cotizacion.cierra !== false && f.cotizacion.viable !== false).length
  const noCierran = filas.filter((f) => f.cotizacion && (f.cotizacion.cierra === false || f.cotizacion.viable === false)).length
  const esperando = filas.length - cierran - noCierran

  const columnas = [
    // ── banda: tu decisión (solo pantalla) ──
    {
      clave: 'keyword',
      titulo: 'Producto / nicho',
      tipo: 'texto',
      fija: true,
      soloVista: true,
      banda: 'decision',
      render: (o) => <CeldaProducto o={o} />,
    },
    {
      clave: 'veredicto',
      titulo: 'Veredicto IA',
      tipo: 'texto',
      soloVista: true,
      banda: 'decision',
      render: (o) => <CeldaVeredicto o={o} />,
    },
    {
      clave: 'etapaCompra',
      titulo: 'Etapa',
      tipo: 'texto',
      soloVista: true,
      banda: 'decision',
      render: (o) => (
        <div className="pl-etapa">
          <SelectorEtapa fila={o} onCambiada={recargar} />
          <NotaEtapa fila={o} onCambiada={recargar} />
        </div>
      ),
    },
    // ── columnas que viajan solo en la descarga (encabezan la hoja) ──
    { clave: 'nichoIngles', titulo: 'Niche', tipo: 'texto', soloDescarga: true, anchoXlsx: 24 },
    {
      clave: 'productoIngles',
      titulo: 'Product',
      tipo: 'texto',
      soloDescarga: true,
      anchoXlsx: 42,
      // nunca volcar la especificación larga aquí: o está acotado o está pendiente
      csv: (o) => o.productoIngles ?? null,
    },
    // ── banda: hoja del proveedor (pantalla + descarga) ──
    {
      clave: 'especificacionProducto',
      titulo: 'Specification',
      tipo: 'texto',
      ancha: true,
      banda: 'proveedor',
      anchoXlsx: 60,
      render: (o) => <span className="pl-spec">{o.especificacionProducto ?? '—'}</span>,
    },
    {
      clave: 'unidadesPrueba',
      titulo: 'Qty',
      tipo: 'numero',
      banda: 'proveedor',
      anchoXlsx: 15,
      render: (o) => (o.unidadesPrueba != null ? o.unidadesPrueba : (o.primeraCompra ?? '—')),
      csv: (o) => o.unidadesPrueba ?? o.primeraCompra ?? null,
    },
    {
      // en productos de bulto, la Qty sin unidad se malinterpreta seguro:
      // esta columna dice EN QUÉ se pide y cotiza ("master case (12 packs × 80 wipes)")
      clave: 'unidadPedido',
      titulo: 'Unit',
      tipo: 'texto',
      banda: 'proveedor',
      anchoXlsx: 26,
      render: (o) => o.unidadPedido ?? <span className="vacio">unit</span>,
      csv: (o) => o.unidadPedido ?? 'unit',
    },
    {
      clave: 'exwObjetivoUsd',
      titulo: 'Target USD / unit',
      tipo: 'numero',
      banda: 'proveedor',
      anchoXlsx: 17,
      render: (o) => (o.exwObjetivoUsd != null ? `US$ ${o.exwObjetivoUsd}` : '—'),
    },
    {
      clave: 'proveedorLlena',
      titulo: 'Llena el proveedor',
      tipo: 'texto',
      soloVista: true,
      banda: 'proveedor',
      render: () => <span className="ghost-cell">EXW · MOQ · lead time</span>,
    },
    { clave: 'exwUnitario', titulo: 'Your EXW price / unit (USD)', tipo: 'texto', soloDescarga: true, anchoXlsx: 20 },
    { clave: 'moq', titulo: 'MOQ', tipo: 'texto', soloDescarga: true, anchoXlsx: 10 },
    { clave: 'tiempoProduccion', titulo: 'Production time (days)', tipo: 'texto', soloDescarga: true, anchoXlsx: 18 },
    { clave: 'linkProducto', titulo: 'Product link / photos', tipo: 'texto', soloDescarga: true, anchoXlsx: 30 },
    { clave: 'notas', titulo: 'Notes', tipo: 'texto', soloDescarga: true, anchoXlsx: 30 },
    // ── banda: cotización recibida (solo pantalla) ──
    {
      clave: 'exwCotizado',
      titulo: 'EXW cotizado',
      tipo: 'numero',
      soloVista: true,
      banda: 'cotiza',
      render: (o) => <CotizacionExw fila={o} onCambiada={recargar} />,
    },
    {
      clave: 'margenCotizacion',
      titulo: 'Margen real',
      tipo: 'numero',
      soloVista: true,
      banda: 'cotiza',
      render: (o) => <MargenCotizacion fila={o} />,
    },
    {
      clave: 'detalle',
      titulo: '',
      tipo: 'texto',
      soloVista: true,
      banda: 'cotiza',
      render: (o) => (
        <button
          className="detalle-btn"
          aria-label="Ver detalle"
          onClick={(e) => {
            e.stopPropagation()
            setDetalleId(o.nichoId)
          }}
        >
          ›
        </button>
      ),
    },
  ]

  // descargar la planilla de "Por cotizar" = esos productos avanzan a cotizando
  async function alDescargar(visibles) {
    if (tab !== 'por-cotizar' || !visibles.length) return
    const ids = visibles.flatMap((f) => f.nichoIds ?? [f.nichoId])
    const r = await api.avanzarNichos(ids, 'cotizando').catch(() => null)
    if (r) {
      await recargar()
      setAviso(`${r.avanzados} nicho(s) avanzaron a "cotizando" — la próxima descarga solo trae lo nuevo.`)
    }
  }

  const resumen = (
    <span className="resumen-tab">
      <span><span className="punto verde" /> <strong>{cierran}</strong> cierran</span>
      <span><span className="punto rojo" /> <strong>{noCierran}</strong> no cierran</span>
      <span><span className="punto gris" /> <strong>{esperando}</strong> esperando</span>
    </span>
  )

  const pie = (visibles) => {
    const unidades = visibles.reduce((s, o) => s + (o.unidadesPrueba ?? 0), 0)
    const inversion = visibles.reduce((s, o) => s + (o.inversionEstimadaUsd ?? 0), 0)
    const margenes = visibles.map((o) => o.cotizacion?.margenPct).filter(Number.isFinite)
    const margenProm = margenes.length
      ? Math.round(margenes.reduce((a, b) => a + b, 0) / margenes.length)
      : null
    return (
      <tr>
        <td colSpan={3}>{visibles.length} producto(s) en esta etapa</td>
        <td colSpan={2} className="num"><span className="dato">{unidades.toLocaleString('es-CL')}</span> unidades</td>
        <td colSpan={3}>inversión estimada <span className="dato">US$ {Math.round(inversion).toLocaleString('es-CL')}</span></td>
        <td colSpan={3}>
          {margenProm != null ? (
            <>margen promedio de lo cotizado <span className="dato ok">{margenProm}%</span></>
          ) : (
            'sin cotizaciones aún'
          )}
        </td>
      </tr>
    )
  }

  return (
    <div>
      <Embudo tab={tab} setTab={setTab} conteoEtapa={conteoEtapa} />
      {aviso ? <p className="conteo pl-aviso">{aviso}</p> : null}
      {!filas.length ? (
        <p className="vacio">Nada en esta etapa por ahora.</p>
      ) : (
        <Planilla
          columnas={columnas}
          filas={filas}
          bandas={BANDAS}
          conFiltros={false}
          buscador
          resumen={resumen}
          pie={pie}
          acciones={
            <button className="boton-secundario" onClick={acotarConIA} disabled={acotando}>
              {acotando
                ? 'Acotando con IA…'
                : `✨ Acotar en inglés${pendientes ? ` (${pendientes})` : ''}`}
            </button>
          }
          nombreArchivo="supplier-quote-request.xlsx"
          hojaXlsx="Quote request"
          formatoDescarga="xlsx"
          onDescarga={alDescargar}
          filaKey={(o) => o.nichoId}
          onFilaClick={(o) => setDetalleId(o.nichoId)}
        />
      )}
      <div className="pl-leyenda">
        <span><span className="cuadro c-decision" />Interno: veredicto, validación y embudo</span>
        <span><span className="cuadro c-proveedor" />Se exporta al proveedor (inglés, sin precios tuyos)</span>
        <span><span className="cuadro c-cotiza" />Cotización recibida: EXW real y si el margen cierra</span>
        <span className="pl-leyenda-nota">⬇ Descargar en "Por cotizar" avanza los productos a "Cotizando"</span>
      </div>
      <DetalleProducto
        fila={filaDetalle}
        otras={todasLasFilas.filter((f) => f.nichoId !== filaDetalle?.nichoId)}
        onCerrar={() => setDetalleId(null)}
        onCambiada={recargar}
        onAbrirNicho={onAbrirNicho}
      />
    </div>
  )
}

// ── Planilla cruda de productos (todos los nichos) ───────────────────────

export const COLUMNAS_PRODUCTO = [
  { clave: 'posicion', titulo: '#', tipo: 'numero' },
  {
    clave: 'titulo',
    titulo: 'Producto',
    tipo: 'texto',
    ancha: true,
    render: (p) => (
      <span className="planilla-producto" title={p.titulo ?? p.sku}>
        {p.titulo ?? p.sku}
        {p.url ? (
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="enlace-icono"
            aria-label="Abrir en Mercado Libre"
            onClick={(e) => e.stopPropagation()}
          >
            <IconoExterno />
          </a>
        ) : null}
      </span>
    ),
  },
  { clave: 'precio', titulo: 'Precio', tipo: 'numero', render: (p) => fmtPrecio(p.precio) },
  { clave: 'descuentoPct', titulo: 'Desc %', tipo: 'numero' },
  { clave: 'numReviews', titulo: 'Reseñas', tipo: 'numero' },
  { clave: 'ventasDia', titulo: 'Ventas/día', tipo: 'numero' },
  { clave: 'rating', titulo: 'Rating', tipo: 'numero' },
  { clave: 'vendedor', titulo: 'Vendedor', tipo: 'texto' },
  { clave: 'reputacionSeller', titulo: 'Reputación', tipo: 'texto' },
  { clave: 'esTiendaOficial', titulo: 'Oficial', tipo: 'bool' },
  { clave: 'esFull', titulo: 'Full', tipo: 'bool' },
  { clave: 'origenCrossBorder', titulo: 'China', tipo: 'bool' },
  { clave: 'tipoListing', titulo: 'Tipo', tipo: 'texto' },
  { clave: 'categoriaRuta', titulo: 'Categoría', tipo: 'texto', ancha: true },
  { clave: 'sku', titulo: 'SKU', tipo: 'texto' },
  {
    clave: 'fechaScan',
    titulo: 'Scan',
    tipo: 'texto',
    render: (p) => fmtFecha(p.fechaScan),
    csv: (p) => (p.fechaScan ? String(p.fechaScan).slice(0, 16).replace('T', ' ') : null),
  },
]

function PlanillaProductos() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true
    api
      .productosGlobal()
      .then((d) => vigente && setDatos(d))
      .catch((e) => vigente && setError(e.message))
    return () => {
      vigente = false
    }
  }, [])

  if (error) return <p className="error-bloque">Error: {error}</p>
  if (!datos) return <Cargando texto="Cargando todos los productos…" />

  const columnas = [{ clave: 'nicho', titulo: 'Nicho', tipo: 'texto', fija: true }, ...COLUMNAS_PRODUCTO]
  return (
    <Planilla
      columnas={columnas}
      filas={datos.productos}
      nombreArchivo="productos-meli-intel.csv"
      filaKey={(p) => `${p.nicho}:${p.sku}`}
    />
  )
}

export function PlanillaGlobal({ onAbrirNicho }) {
  const [modo, setModo] = useState('ia')

  return (
    <main>
      <div className="reporte-encabezado">
        <div>
          <h2>Planilla</h2>
          <p className="reporte-fecha">
            {modo === 'ia'
              ? 'Tu mesa de compra: cada fila es un producto recomendado por la IA. Lo azul se exporta al proveedor; lo gris y lo verde es solo tuyo.'
              : 'Todos los productos del último scan de cada nicho activo (materia prima de los análisis).'}
          </p>
        </div>
        <div className="chips" role="group" aria-label="Contenido de la planilla">
          <button
            className={modo === 'ia' ? 'chip activo' : 'chip'}
            onClick={() => setModo('ia')}
            aria-pressed={modo === 'ia'}
          >
            Recomendaciones IA
          </button>
          <button
            className={modo === 'productos' ? 'chip activo' : 'chip'}
            onClick={() => setModo('productos')}
            aria-pressed={modo === 'productos'}
          >
            Todos los productos
          </button>
        </div>
      </div>

      {modo === 'ia' ? <PlanillaIA onAbrirNicho={onAbrirNicho} /> : <PlanillaProductos />}
    </main>
  )
}
