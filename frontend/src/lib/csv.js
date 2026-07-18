// CSV para Excel chileno (mismas reglas que el backend): separador ';',
// BOM UTF-8, CRLF y decimales con coma.

export function celdaCsv(valor) {
  if (valor == null) return ''
  if (typeof valor === 'boolean') return valor ? 'sí' : 'no'
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return ''
    return String(valor).replace('.', ',')
  }
  const s = String(valor)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function aCsvExcel(filas, columnas) {
  const encabezado = columnas.map((c) => celdaCsv(c.titulo)).join(';')
  const lineas = filas.map((f) =>
    columnas.map((c) => celdaCsv(c.csv ? c.csv(f) : f[c.clave])).join(';'),
  )
  return '\ufeff' + [encabezado, ...lineas].join('\r\n') + '\r\n'
}

export function descargarCsv(nombreArchivo, contenido) {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  a.click()
  URL.revokeObjectURL(url)
}
