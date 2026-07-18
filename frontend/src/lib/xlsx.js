// Excel real (.xlsx) con formato: encabezado con color, anchos por columna,
// texto largo con ajuste de línea, autofiltro y primera fila congelada.
// exceljs se carga on-demand (import dinámico): no pesa en el bundle inicial.

const BORDE = { style: 'thin', color: { argb: 'FFD9DEE8' } }

export async function descargarXlsx({ nombreArchivo, hoja = 'Hoja 1', columnas, filas }) {
  const { default: ExcelJS } = await import('exceljs')
  const libro = new ExcelJS.Workbook()
  const ws = libro.addWorksheet(hoja, { views: [{ state: 'frozen', ySplit: 1 }] })

  ws.columns = columnas.map((c) => ({
    header: c.titulo,
    key: c.clave,
    width: c.anchoXlsx ?? (c.ancha ? 46 : 16),
  }))

  for (const fila of filas) {
    const valores = {}
    for (const c of columnas) {
      let v = c.csv ? c.csv(fila) : fila[c.clave]
      if (v === true) v = 'sí'
      if (v === false) v = 'no'
      valores[c.clave] = v ?? ''
    }
    ws.addRow(valores)
  }

  ws.eachRow((fila, n) => {
    fila.eachCell((celda, col) => {
      celda.border = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE }
      if (n === 1) {
        celda.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
        celda.alignment = { vertical: 'middle', wrapText: true }
      } else {
        celda.alignment = { vertical: 'top', wrapText: Boolean(columnas[col - 1]?.ancha) }
      }
    })
  })
  ws.getRow(1).height = 26
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } }

  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  a.click()
  URL.revokeObjectURL(url)
}
