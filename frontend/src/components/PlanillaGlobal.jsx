import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Planilla } from './Planilla.jsx'
import { Cargando, IconoExterno } from './ui.jsx'
import { fmtPrecio, fmtFecha } from '../lib/formato.js'

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

export function PlanillaGlobal() {
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

  if (error) return <main><p className="error-bloque">Error: {error}</p></main>
  if (!datos) return <main><Cargando texto="Cargando todos los productos…" /></main>

  const columnas = [{ clave: 'nicho', titulo: 'Nicho', tipo: 'texto', fija: true }, ...COLUMNAS_PRODUCTO]

  return (
    <main>
      <div className="reporte-encabezado">
        <div>
          <h2>Planilla</h2>
          <p className="reporte-fecha">
            Todos los productos del último scan de cada nicho activo. Ordena con click en la columna,
            filtra bajo el encabezado, y descarga lo que estés viendo.
          </p>
        </div>
      </div>

      <Planilla
        columnas={columnas}
        filas={datos.productos}
        nombreArchivo="productos-meli-intel.csv"
        filaKey={(p) => `${p.nicho}:${p.sku}`}
      />
    </main>
  )
}
