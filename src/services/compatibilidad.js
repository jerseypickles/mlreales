// Nichos de repuestos: la decisión no es "entro o no", es PARA QUÉ AUTOS traer.
// El mercado se navega por el selector de compatibilidad de ML (marca/modelo/
// año), así que el top de una keyword mezcla decenas de vehículos: sin
// desglosar por marca, la mediana y el %Full describen a nadie.
const MARCAS = [
  'Chevrolet', 'Toyota', 'Hyundai', 'Nissan', 'Suzuki', 'Kia', 'Mazda', 'Ford', 'Chery', 'MG',
  'Mitsubishi', 'Peugeot', 'Renault', 'Volkswagen', 'Honda', 'Subaru', 'JAC', 'Great Wall',
  'Haval', 'SsangYong', 'Citroen', 'Citroën', 'Fiat', 'Jeep', 'BMW', 'Mercedes', 'Audi', 'Dodge',
  'Changan', 'Baic', 'Maxus', 'Foton', 'DFSK',
]

const norm = (s) => String(s ?? '').toLowerCase()

export function marcaDelTitulo(titulo) {
  const t = norm(titulo)
  for (const m of MARCAS) if (t.includes(norm(m))) return m === 'Citroën' ? 'Citroen' : m
  return null
}

// ¿Este nicho es de repuestos con compatibilidad? (la ruta de categoría manda)
export function esNichoDeRepuesto(categoriaRuta) {
  const r = norm(categoriaRuta)
  return r.includes('vehículo') || r.includes('vehiculo') || r.includes('repuesto') || r.includes('camioneta')
}

// Desglose del top por marca de vehículo: cuántos listings, qué precio y qué
// tanto Full tiene cada una. Responde "¿para qué autos conviene traer?".
export function desglosePorMarca(productos, { max = 8 } = {}) {
  const porMarca = new Map()
  for (const p of productos ?? []) {
    const marca = marcaDelTitulo(p.titulo)
    if (!marca) continue
    const acc = porMarca.get(marca) ?? { items: 0, precios: [], full: 0, conDatoFull: 0, reviews: 0, ventasDia: 0 }
    acc.items++
    if (Number.isFinite(p.precio)) acc.precios.push(p.precio)
    if (p.esFull != null) {
      acc.conDatoFull++
      if (p.esFull) acc.full++
    }
    acc.reviews += p.numReviews ?? 0
    acc.ventasDia += p.ventasDia ?? 0
    porMarca.set(marca, acc)
  }
  if (!porMarca.size) return null
  const total = [...porMarca.values()].reduce((s, m) => s + m.items, 0)
  const red = (n, d = 0) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null)
  return [...porMarca.entries()]
    .map(([marca, m]) => {
      const orden = [...m.precios].sort((a, b) => a - b)
      return {
        marca,
        items: m.items,
        pctItems: red((m.items / total) * 100, 1),
        medianaPrecio: orden.length ? orden[Math.floor(orden.length / 2)] : null,
        pctFull: m.conDatoFull ? red((m.full / m.conDatoFull) * 100) : null,
        reviews: m.reviews,
        ventasDia: red(m.ventasDia, 1),
      }
    })
    // el que más se vende primero: reseñas acumuladas es la mejor señal por marca
    .sort((a, b) => b.reviews - a.reviews || b.items - a.items)
    .slice(0, max)
}
