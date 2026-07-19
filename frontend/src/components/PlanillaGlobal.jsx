import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Planilla } from './Planilla.jsx'
import { Cargando, IconoExterno } from './ui.jsx'
import { fmtPrecio, fmtFecha } from '../lib/formato.js'

// ── Planilla de cotización para el proveedor (RFQ) ───────────────────────
// Una fila por nicho con veredicto de entrada. Las columnas del CSV van en
// inglés y sin datos internos (nunca el EXW máximo: es tu tope de negociación);
// las columnas de precio/MOQ/tiempos van vacías para que las llene el
// proveedor. Veredicto/confianza/nicho en español quedan solo en pantalla.

const COLUMNAS_IA = [
  { clave: 'keyword', titulo: 'Nicho', tipo: 'texto', fija: true, soloVista: true },
  {
    clave: 'veredicto',
    titulo: 'Veredicto',
    tipo: 'texto',
    soloVista: true,
    render: (o) => (
      <span className={`veredicto veredicto-${o.veredicto}`}>{o.veredicto.replace(/_/g, ' ')}</span>
    ),
  },
  { clave: 'confianza', titulo: 'Confianza', tipo: 'texto', soloVista: true },
  {
    clave: 'confirmacion',
    titulo: 'Validación',
    tipo: 'texto',
    soloVista: true,
    render: (o) =>
      o.confirmacion ? (
        <span
          className={`op-confianza ${o.confirmacion === 'confirmado' ? 'op-confianza-alta' : 'op-confianza-media'}`}
          title={`${o.scansConDemanda ?? 0} scan(s) con demanda`}
        >
          {o.confirmacion}
        </span>
      ) : (
        '—'
      ),
  },
  {
    clave: 'nichoIngles',
    titulo: 'Niche',
    tipo: 'texto',
    anchoXlsx: 24,
    render: (o) => o.nichoIngles ?? <span className="vacio" title="El acotador corre solo tras cada análisis; también puedes forzarlo con el botón de arriba">(pendiente)</span>,
  },
  {
    clave: 'productoIngles',
    titulo: 'Product',
    tipo: 'texto',
    ancha: true,
    anchoXlsx: 42,
    // nunca volcar la especificación larga aquí: o está acotado o está pendiente
    render: (o) =>
      o.productoIngles ?? (
        <span className="vacio" title="El acotador corre solo tras cada análisis; también puedes forzarlo con el botón de arriba">
          (pendiente de acotar)
        </span>
      ),
    csv: (o) => o.productoIngles ?? null,
  },
  { clave: 'especificacionProducto', titulo: 'Specification', tipo: 'texto', ancha: true, anchoXlsx: 60 },
  {
    clave: 'unidadesPrueba',
    titulo: 'Quantity (units)',
    tipo: 'numero',
    anchoXlsx: 15,
    render: (o) => (o.unidadesPrueba != null ? o.unidadesPrueba : (o.primeraCompra ?? '—')),
    csv: (o) => o.unidadesPrueba ?? o.primeraCompra ?? null,
  },
  {
    clave: 'exwObjetivoUsd',
    titulo: 'Target price (USD)',
    tipo: 'numero',
    anchoXlsx: 16,
    render: (o) => (o.exwObjetivoUsd != null ? `US$ ${o.exwObjetivoUsd}` : '—'),
  },
  { clave: 'exwUnitario', titulo: 'Your EXW price (USD)', tipo: 'texto', anchoXlsx: 18 },
  { clave: 'moq', titulo: 'MOQ', tipo: 'texto', anchoXlsx: 10 },
  { clave: 'tiempoProduccion', titulo: 'Production time (days)', tipo: 'texto', anchoXlsx: 18 },
  { clave: 'linkProducto', titulo: 'Product link / photos', tipo: 'texto', anchoXlsx: 30 },
  { clave: 'notas', titulo: 'Notes', tipo: 'texto', anchoXlsx: 30 },
]

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

export const ETAPAS = ['evaluando', 'cotizando', 'muestra', 'pedido', 'vendiendo', 'en-espera', 'descartado']
export const etiquetaEtapa = (e) => e.replace(/-/g, ' ')

const TABS_ETAPA = [
  ['por-cotizar', 'Por cotizar', (e) => e === 'evaluando'],
  ['cotizando', 'Cotizando', (e) => e === 'cotizando'],
  ['avanzados', 'Avanzados', (e) => ['muestra', 'pedido', 'vendiendo'].includes(e)],
  ['en-espera', 'En espera', (e) => e === 'en-espera'],
  ['todos', 'Todos', () => true],
]

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
      placeholder="ej: esperando ISP…"
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

function PlanillaIA({ onAbrirNicho }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [acotando, setAcotando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [tab, setTab] = useState('por-cotizar')

  const cargar = () =>
    // solo entrar / entrar_con_condiciones de nichos activos: esta es la
    // planilla de compra que se trabaja con proveedores
    api.oportunidades().then((d) => ({
      ...d,
      // trámites como texto para que la grilla y la descarga lo traten plano
      oportunidades: d.oportunidades.map((o) => ({
        ...o,
        etapaCompra: o.etapaCompra ?? 'evaluando',
        tramites: (o.tramites ?? []).join(', ') || null,
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
      const r = await api.generarRfq()
      setDatos(await cargar())
      setAviso(
        r.generados
          ? `${r.generados} nicho(s) acotados en inglés (US$ ${r.costoUsd?.toFixed?.(3) ?? '?'}).`
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

  const pendientes = datos.oportunidades.filter((o) => !o.nichoIngles).length
  const filtroTab = TABS_ETAPA.find(([clave]) => clave === tab)?.[2] ?? (() => true)
  const filas = fusionarCompras(datos.oportunidades.filter((o) => filtroTab(o.etapaCompra)))
  const conteoEtapa = (fn) => datos.oportunidades.filter((o) => fn(o.etapaCompra)).length

  const columnas = [
    ...COLUMNAS_IA.slice(0, 3),
    {
      clave: 'etapaCompra',
      titulo: 'Etapa',
      tipo: 'texto',
      soloVista: true,
      render: (o) => <SelectorEtapa fila={o} onCambiada={async () => setDatos(await cargar())} />,
    },
    {
      clave: 'notaEtapa',
      titulo: 'Nota',
      tipo: 'texto',
      soloVista: true,
      render: (o) => <NotaEtapa fila={o} onCambiada={async () => setDatos(await cargar())} />,
    },
    ...COLUMNAS_IA.slice(3),
  ]

  // descargar la planilla de "Por cotizar" = esos productos avanzan a cotizando
  async function alDescargar(visibles) {
    if (tab !== 'por-cotizar' || !visibles.length) return
    const ids = visibles.flatMap((f) => f.nichoIds ?? [f.nichoId])
    const r = await api.avanzarNichos(ids, 'cotizando').catch(() => null)
    if (r) {
      setDatos(await cargar())
      setAviso(`${r.avanzados} nicho(s) avanzaron a "cotizando" — la próxima descarga solo trae lo nuevo.`)
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="chips" role="tablist" aria-label="Etapa de compra">
          {TABS_ETAPA.map(([clave, etiqueta, fn]) => (
            <button
              key={clave}
              role="tab"
              aria-selected={tab === clave}
              className={tab === clave ? 'chip activo' : 'chip'}
              onClick={() => setTab(clave)}
            >
              {etiqueta} ({conteoEtapa(fn)})
            </button>
          ))}
        </div>
        <button className="boton-secundario" onClick={acotarConIA} disabled={acotando}>
          {acotando
            ? 'Acotando con IA…'
            : `Acotar en inglés con IA${pendientes ? ` (${pendientes} pendientes)` : ''}`}
        </button>
        {aviso ? <span className="conteo">{aviso}</span> : null}
      </div>
      {!filas.length ? (
        <p className="vacio">Nada en esta etapa por ahora.</p>
      ) : (
        <Planilla
          columnas={columnas}
          filas={filas}
          nombreArchivo="supplier-quote-request.xlsx"
          hojaXlsx="Quote request"
          formatoDescarga="xlsx"
          onDescarga={alDescargar}
          filaKey={(o) => o.nichoId}
          onFilaClick={onAbrirNicho ? (o) => onAbrirNicho(o.nichoId) : undefined}
        />
      )}
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
              ? 'Hoja de cotización para el proveedor: producto y cantidades en inglés, con columnas en blanco (precio FOB, MOQ, tiempos) para que las llene él. El CSV sale limpio — veredicto y confianza se ven solo aquí.'
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
