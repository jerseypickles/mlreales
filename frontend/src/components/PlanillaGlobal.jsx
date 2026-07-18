import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Planilla } from './Planilla.jsx'
import { Cargando, IconoExterno } from './ui.jsx'
import { fmtPrecio, fmtFecha } from '../lib/formato.js'

// ── Planilla de recomendaciones IA: una fila por nicho analizado ─────────
// Es la hoja de sourcing: qué traer, a cuánto vender, cuánto pagar en China,
// pedido de prueba, especificación para Alibaba y cómo validar.

const COLUMNAS_IA = [
  { clave: 'keyword', titulo: 'Nicho', tipo: 'texto', fija: true },
  {
    clave: 'veredicto',
    titulo: 'Veredicto',
    tipo: 'texto',
    render: (o) => (
      <span className={`veredicto veredicto-${o.veredicto}`}>{o.veredicto.replace(/_/g, ' ')}</span>
    ),
  },
  { clave: 'confianza', titulo: 'Confianza', tipo: 'texto' },
  { clave: 'score', titulo: 'Score', tipo: 'numero' },
  { clave: 'titular', titulo: 'Producto a traer', tipo: 'texto', ancha: true },
  {
    clave: 'precioVentaClp',
    titulo: 'Vender a',
    tipo: 'numero',
    render: (o) => (o.precioVentaClp ? fmtPrecio(o.precioVentaClp) : '—'),
  },
  { clave: 'fobMaximoUsd', titulo: 'FOB máx US$', tipo: 'numero' },
  { clave: 'primeraCompra', titulo: 'Pedido de prueba', tipo: 'texto' },
  { clave: 'inversionEstimadaUsd', titulo: 'Inversión ~US$', tipo: 'numero' },
  { clave: 'comisionMlPct', titulo: 'Comisión ML %', tipo: 'numero' },
  { clave: 'segmento', titulo: 'Segmento', tipo: 'texto', ancha: true },
  { clave: 'tramites', titulo: 'Trámites', tipo: 'texto' },
  { clave: 'ventanaImportacion', titulo: 'Ventana compra', tipo: 'texto', ancha: true },
  { clave: 'ventasDia', titulo: '~Ventas/día', tipo: 'numero' },
  {
    clave: 'mediana',
    titulo: 'Mediana nicho',
    tipo: 'numero',
    render: (o) => (o.mediana ? fmtPrecio(o.mediana) : '—'),
  },
  { clave: 'especificacionProducto', titulo: 'Especificación (Alibaba/1688)', tipo: 'texto', ancha: true },
  { clave: 'comoValidar', titulo: 'Cómo validar', tipo: 'texto', ancha: true },
  {
    clave: 'fechaAnalisis',
    titulo: 'Análisis',
    tipo: 'texto',
    render: (o) => (o.fechaAnalisis ? fmtFecha(o.fechaAnalisis) : '—'),
    csv: (o) => (o.fechaAnalisis ? String(o.fechaAnalisis).slice(0, 16).replace('T', ' ') : null),
  },
]

function PlanillaIA({ onAbrirNicho }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true
    // solo entrar / entrar_con_condiciones de nichos activos: esta es la
    // planilla de compra que se trabaja con proveedores
    api
      .oportunidades()
      .then((d) => {
        if (!vigente) return
        // trámites como texto para que la grilla y el CSV lo traten plano
        setDatos({
          ...d,
          oportunidades: d.oportunidades.map((o) => ({
            ...o,
            tramites: (o.tramites ?? []).join(', ') || null,
          })),
        })
      })
      .catch((e) => vigente && setError(e.message))
    return () => {
      vigente = false
    }
  }, [])

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

  return (
    <Planilla
      columnas={COLUMNAS_IA}
      filas={datos.oportunidades}
      nombreArchivo="recomendaciones-ia-meli-intel.csv"
      filaKey={(o) => o.nichoId}
      onFilaClick={onAbrirNicho ? (o) => onAbrirNicho(o.nichoId) : undefined}
    />
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
              ? 'La planilla de compra: solo los nichos con veredicto de entrada — qué traer, a cuánto vender, cuánto pagar en China y cómo validar. Ordena, filtra y descarga para trabajar con el proveedor.'
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
