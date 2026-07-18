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
  { clave: 'exwUnitario', titulo: 'EXW unit price (USD)', tipo: 'texto', anchoXlsx: 18 },
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
      resultado.push(o)
      continue
    }
    const grupo = porClave.get(o.productoClave)
    if (!grupo) {
      const fila = { ...o, nichosDelGrupo: [o.keyword] }
      porClave.set(o.productoClave, fila)
      resultado.push(fila)
    } else {
      grupo.nichosDelGrupo.push(o.keyword)
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

function PlanillaIA({ onAbrirNicho }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [acotando, setAcotando] = useState(false)
  const [aviso, setAviso] = useState(null)

  const cargar = () =>
    // solo entrar / entrar_con_condiciones de nichos activos: esta es la
    // planilla de compra que se trabaja con proveedores
    api.oportunidades().then((d) => ({
      ...d,
      // trámites como texto para que la grilla y la descarga lo traten plano;
      // nichos que comparten producto de fábrica se fusionan en una fila
      oportunidades: fusionarCompras(
        d.oportunidades.map((o) => ({
          ...o,
          tramites: (o.tramites ?? []).join(', ') || null,
        })),
      ),
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

  return (
    <div>
      <div className="toolbar">
        <button className="boton-secundario" onClick={acotarConIA} disabled={acotando}>
          {acotando
            ? 'Acotando con IA…'
            : `Acotar en inglés con IA${pendientes ? ` (${pendientes} pendientes)` : ''}`}
        </button>
        {aviso ? <span className="conteo">{aviso}</span> : null}
      </div>
      <Planilla
        columnas={COLUMNAS_IA}
        filas={datos.oportunidades}
        nombreArchivo="supplier-quote-request.xlsx"
        hojaXlsx="Quote request"
        formatoDescarga="xlsx"
        filaKey={(o) => o.nichoId}
        onFilaClick={onAbrirNicho ? (o) => onAbrirNicho(o.nichoId) : undefined}
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
