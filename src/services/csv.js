// CSV pensado para el Excel chileno: separador ';' (es-CL usa coma decimal),
// BOM UTF-8 para que las tildes abran bien a la primera, CRLF y decimales con
// coma. Un CSV "estándar" con comas se abre roto en ese Excel.

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

// columnas: [{ clave, titulo, valor?: (fila) => any }]
export function aCsvExcel(filas, columnas) {
  const encabezado = columnas.map((c) => celdaCsv(c.titulo)).join(';')
  const lineas = filas.map((f) =>
    columnas.map((c) => celdaCsv(c.valor ? c.valor(f) : f[c.clave])).join(';'),
  )
  return '\ufeff' + [encabezado, ...lineas].join('\r\n') + '\r\n'
}

export function fechaCsv(fecha) {
  if (!fecha) return null
  const d = new Date(fecha)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 16).replace('T', ' ')
}

// Columnas compartidas por los dos exports de productos (global y por nicho).
export const COLUMNAS_PRODUCTO_CSV = [
  { clave: 'posicion', titulo: 'Posición' },
  { clave: 'titulo', titulo: 'Producto' },
  { clave: 'precio', titulo: 'Precio CLP' },
  { clave: 'precioAnterior', titulo: 'Precio anterior' },
  { clave: 'descuentoPct', titulo: 'Descuento %' },
  { clave: 'numReviews', titulo: 'Reseñas' },
  { clave: 'rating', titulo: 'Rating' },
  { clave: 'vendedor', titulo: 'Vendedor' },
  { clave: 'reputacionSeller', titulo: 'Reputación seller' },
  { clave: 'powerSeller', titulo: 'Power seller' },
  { clave: 'esTiendaOficial', titulo: 'Tienda oficial' },
  { clave: 'esFull', titulo: 'Full' },
  { clave: 'origenCrossBorder', titulo: 'Despacha desde China' },
  { clave: 'tipoListing', titulo: 'Tipo publicación' },
  { clave: 'categoriaRuta', titulo: 'Categoría' },
  { clave: 'cuotas', titulo: 'Cuotas' },
  { clave: 'sku', titulo: 'SKU' },
  { clave: 'url', titulo: 'URL' },
  { clave: 'fechaScan', titulo: 'Fecha scan', valor: (f) => fechaCsv(f.fechaScan) },
]
