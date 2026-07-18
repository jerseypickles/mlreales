import { useMemo, useState } from 'react'
import { aCsvExcel, descargarCsv } from '../lib/csv.js'
import { descargarXlsx } from '../lib/xlsx.js'

// Grilla estilo hoja de cálculo, reutilizable.
// columna: { clave, titulo, tipo: 'texto'|'numero'|'bool', render?(fila), csv?(fila), fija?, ancha? }
// - ordenar: click en el encabezado (asc/desc, nulos al final)
// - filtrar: fila de inputs bajo el encabezado
//   · texto: contiene (sin tildes ni mayúsculas)
//   · número: "50" (mínimo), ">50", "<50", "10-25"
//   · bool: si / no

const normalizar = (t) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

function pasaFiltro(columna, valor, filtro) {
  const f = filtro.trim()
  if (!f) return true
  if (columna.tipo === 'bool') {
    const quiere = normalizar(f)
    if (quiere.startsWith('s')) return valor === true
    if (quiere.startsWith('n')) return !valor
    return true
  }
  if (columna.tipo === 'numero') {
    if (!Number.isFinite(valor)) return false
    const num = (s) => Number(String(s).replace(',', '.'))
    let m
    if ((m = f.match(/^>\s*(-?[\d.,]+)$/))) return valor > num(m[1])
    if ((m = f.match(/^<\s*(-?[\d.,]+)$/))) return valor < num(m[1])
    if ((m = f.match(/^(-?[\d.,]+)\s*-\s*(-?[\d.,]+)$/))) return valor >= num(m[1]) && valor <= num(m[2])
    if ((m = f.match(/^(-?[\d.,]+)$/))) return valor >= num(m[1])
    return true
  }
  return normalizar(valor).includes(normalizar(f))
}

function comparar(columna, a, b) {
  const va = a[columna.clave]
  const vb = b[columna.clave]
  const nuloA = va == null || va === ''
  const nuloB = vb == null || vb === ''
  if (nuloA && nuloB) return 0
  if (nuloA) return 1 // nulos siempre al final
  if (nuloB) return -1
  if (columna.tipo === 'numero' || columna.tipo === 'bool') return Number(va) - Number(vb)
  return String(va).localeCompare(String(vb), 'es')
}

export function Planilla({
  columnas,
  filas,
  nombreArchivo = 'planilla.csv',
  hojaXlsx,
  formatoDescarga = 'csv', // 'csv' | 'xlsx'
  onFilaClick,
  filaKey,
}) {
  const [orden, setOrden] = useState(null) // { clave, dir: 1|-1 }
  const [filtros, setFiltros] = useState({})
  const [descargando, setDescargando] = useState(false)

  const visibles = useMemo(() => {
    let resultado = filas.filter((f) =>
      columnas.every((c) => pasaFiltro(c, f[c.clave], filtros[c.clave] ?? '')),
    )
    if (orden) {
      const col = columnas.find((c) => c.clave === orden.clave)
      if (col) resultado = [...resultado].sort((a, b) => comparar(col, a, b) * orden.dir)
    }
    return resultado
  }, [filas, columnas, filtros, orden])

  const hayFiltros = Object.values(filtros).some((v) => v?.trim())

  function ordenarPor(clave) {
    setOrden((actual) =>
      actual?.clave === clave ? (actual.dir === 1 ? { clave, dir: -1 } : null) : { clave, dir: 1 },
    )
  }

  async function descargar() {
    // soloVista = contexto interno en pantalla que NO viaja en la descarga
    // (ej: veredicto/confianza en la hoja que se le manda al proveedor)
    const exportables = columnas.filter((c) => !c.soloVista)
    if (formatoDescarga === 'xlsx') {
      setDescargando(true)
      try {
        await descargarXlsx({ nombreArchivo, hoja: hojaXlsx, columnas: exportables, filas: visibles })
      } finally {
        setDescargando(false)
      }
      return
    }
    descargarCsv(nombreArchivo, aCsvExcel(visibles, exportables))
  }

  return (
    <div>
      <div className="toolbar">
        <span className="conteo">
          {visibles.length} de {filas.length}
          {hayFiltros ? ' (filtrado)' : ''}
        </span>
        {hayFiltros ? (
          <button className="enlace-boton" onClick={() => setFiltros({})}>
            limpiar filtros
          </button>
        ) : null}
        <button className="boton-secundario" onClick={descargar} disabled={!visibles.length || descargando}>
          {descargando
            ? 'Generando…'
            : `Descargar ${formatoDescarga === 'xlsx' ? 'Excel' : 'CSV'} (${visibles.length})`}
        </button>
      </div>

      <div className="tabla-envoltura planilla-envoltura">
        <table className="planilla">
          <thead>
            <tr>
              {columnas.map((c) => (
                <th
                  key={c.clave}
                  className={[
                    c.tipo === 'numero' ? 'num' : '',
                    c.fija ? 'planilla-fija' : '',
                    c.ancha ? 'planilla-ancha' : '',
                  ].join(' ')}
                >
                  <button className="planilla-orden" onClick={() => ordenarPor(c.clave)}>
                    {c.titulo}
                    {orden?.clave === c.clave ? (orden.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
            <tr className="planilla-filtros">
              {columnas.map((c) => (
                <th key={c.clave} className={c.fija ? 'planilla-fija' : ''}>
                  <input
                    type="text"
                    value={filtros[c.clave] ?? ''}
                    onChange={(e) => setFiltros((f) => ({ ...f, [c.clave]: e.target.value }))}
                    placeholder={c.tipo === 'numero' ? '>n, a-b' : c.tipo === 'bool' ? 'si/no' : 'filtrar'}
                    aria-label={`Filtrar ${c.titulo}`}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((f, i) => (
              <tr
                key={filaKey ? filaKey(f) : i}
                className={onFilaClick ? 'fila-clickable' : ''}
                onClick={onFilaClick ? () => onFilaClick(f) : undefined}
              >
                {columnas.map((c) => (
                  <td
                    key={c.clave}
                    className={[
                      c.tipo === 'numero' ? 'num' : '',
                      c.fija ? 'planilla-fija' : '',
                      c.ancha ? 'planilla-ancha' : '',
                    ].join(' ')}
                  >
                    {c.render ? c.render(f) : formatoCelda(f[c.clave])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!visibles.length ? <p className="vacio con-margen">Ninguna fila pasa los filtros.</p> : null}
      </div>
    </div>
  )
}

function formatoCelda(valor) {
  if (valor == null || valor === '') return '—'
  if (valor === true) return 'sí'
  if (valor === false) return 'no'
  return String(valor)
}
