import { useMemo, useState } from 'react'
import { aCsvExcel, descargarCsv } from '../lib/csv.js'
import { descargarXlsx } from '../lib/xlsx.js'

// Grilla estilo hoja de cálculo, reutilizable.
// columna: { clave, titulo, tipo: 'texto'|'numero'|'bool', render?(fila), csv?(fila),
//            fija?, ancha?, soloVista? (pantalla, no se exporta),
//            soloDescarga? (se exporta, no se muestra), banda? (id de banda) }
// - ordenar: click en el encabezado (asc/desc, nulos al final)
// - filtrar: fila de inputs bajo el encabezado (conFiltros) o buscador global
//   · texto: contiene (sin tildes ni mayúsculas)
//   · número: "50" (mínimo), ">50", "<50", "10-25"
//   · bool: si / no
// - bandas: { id: { titulo, nota, clase } } agrupa columnas contiguas bajo un
//   encabezado de color (ej: qué es interno vs qué se exporta al proveedor)

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
  onDescarga, // callback con las filas visibles tras una descarga exitosa
  onFilaClick,
  filaKey,
  bandas, // agrupación visual de columnas contiguas
  conFiltros = true, // fila de filtros por columna
  buscador = false, // búsqueda global en la toolbar (reemplaza a los filtros finos)
  resumen, // nodo a la izquierda de la toolbar (estado del tab)
  acciones, // nodos extra en la toolbar, antes del botón de descarga
  pie, // (visibles) => contenido del tfoot (fila de totales)
}) {
  const [orden, setOrden] = useState(null) // { clave, dir: 1|-1 }
  const [filtros, setFiltros] = useState({})
  const [busqueda, setBusqueda] = useState('')
  const [descargando, setDescargando] = useState(false)

  // en pantalla: todo menos las columnas que existen solo para la descarga
  const colsPantalla = useMemo(() => columnas.filter((c) => !c.soloDescarga), [columnas])

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim())
    let resultado = filas.filter(
      (f) =>
        colsPantalla.every((c) => pasaFiltro(c, f[c.clave], filtros[c.clave] ?? '')) &&
        (!q || columnas.some((c) => normalizar(f[c.clave]).includes(q))),
    )
    if (orden) {
      const col = colsPantalla.find((c) => c.clave === orden.clave)
      if (col) resultado = [...resultado].sort((a, b) => comparar(col, a, b) * orden.dir)
    }
    return resultado
  }, [filas, columnas, colsPantalla, filtros, busqueda, orden])

  const hayFiltros = Object.values(filtros).some((v) => v?.trim()) || busqueda.trim()

  // bandas: agrupar columnas de pantalla contiguas con el mismo id de banda
  const grupos = useMemo(() => {
    if (!bandas) return null
    const acc = []
    for (const c of colsPantalla) {
      const ult = acc[acc.length - 1]
      if (ult && ult.banda === (c.banda ?? null)) ult.n++
      else acc.push({ banda: c.banda ?? null, n: 1 })
    }
    return acc
  }, [bandas, colsPantalla])

  // marca el inicio de cada banda para el borde vertical de corte
  const cortes = useMemo(() => {
    if (!bandas) return new Set()
    const s = new Set()
    let previa = null
    for (const c of colsPantalla) {
      const banda = c.banda ?? null
      if (banda !== previa && previa !== null) s.add(c.clave)
      previa = banda
    }
    return s
  }, [bandas, colsPantalla])

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
    } else {
      descargarCsv(nombreArchivo, aCsvExcel(visibles, exportables))
    }
    if (onDescarga) await onDescarga(visibles)
  }

  const claseCelda = (c) =>
    [
      c.tipo === 'numero' ? 'num' : '',
      c.fija ? 'planilla-fija' : '',
      c.ancha ? 'planilla-ancha' : '',
      cortes.has(c.clave) ? `planilla-corte planilla-corte-${c.banda}` : '',
    ].join(' ')

  return (
    <div>
      <div className="toolbar">
        {resumen ?? (
          <span className="conteo">
            {visibles.length} de {filas.length}
            {hayFiltros ? ' (filtrado)' : ''}
          </span>
        )}
        {hayFiltros ? (
          <button
            className="enlace-boton"
            onClick={() => {
              setFiltros({})
              setBusqueda('')
            }}
          >
            limpiar filtros
          </button>
        ) : null}
        {buscador ? (
          <input
            type="search"
            className="planilla-buscador"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="🔍 Buscar producto o nicho…"
            aria-label="Buscar en la planilla"
          />
        ) : null}
        {acciones}
        <button className="boton-secundario" onClick={descargar} disabled={!visibles.length || descargando}>
          {descargando
            ? 'Generando…'
            : `⬇ Descargar ${formatoDescarga === 'xlsx' ? 'Excel' : 'CSV'} (${visibles.length})`}
        </button>
      </div>

      <div className="tabla-envoltura planilla-envoltura">
        <table className="planilla">
          <thead>
            {grupos ? (
              <tr className="planilla-bandas">
                {grupos.map((g, i) => {
                  const info = g.banda ? bandas[g.banda] : null
                  return (
                    <th key={i} colSpan={g.n} className={info?.clase ?? ''}>
                      {info ? (
                        <span className="banda-etiqueta">
                          {info.titulo} {info.nota ? <span className="banda-nota">· {info.nota}</span> : null}
                        </span>
                      ) : null}
                    </th>
                  )
                })}
              </tr>
            ) : null}
            <tr>
              {colsPantalla.map((c) => (
                <th key={c.clave} className={claseCelda(c)}>
                  <button className="planilla-orden" onClick={() => ordenarPor(c.clave)}>
                    {c.titulo}
                    {orden?.clave === c.clave ? (orden.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
            {conFiltros ? (
              <tr className="planilla-filtros">
                {colsPantalla.map((c) => (
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
            ) : null}
          </thead>
          <tbody>
            {visibles.map((f, i) => (
              <tr
                key={filaKey ? filaKey(f) : i}
                className={onFilaClick ? 'fila-clickable' : ''}
                onClick={onFilaClick ? () => onFilaClick(f) : undefined}
              >
                {colsPantalla.map((c) => (
                  <td key={c.clave} className={claseCelda(c)}>
                    {c.render ? c.render(f) : formatoCelda(f[c.clave])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {pie ? <tfoot className="planilla-pie">{pie(visibles)}</tfoot> : null}
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
