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

// Lo que el propio selector de compatibilidad de ML Chile declara como "Más
// buscados" (leído del filtro de marca, 9-ago). Vale oro para elegir SKUs: es
// demanda declarada por ML, no inferida de un top de 50 items.
export const MARCAS_MAS_BUSCADAS_MLC = ['Chevrolet', 'Toyota', 'Hyundai', 'Nissan', 'Suzuki']

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

// ¿LOS MODELOS Y AÑOS DEL PLAN SON VERÍDICOS O LOS PUSO LA IA?
//
// ML no entrega la compatibilidad oficial de publicaciones ajenas (/items/{id}/
// compatibilities da 403, probado el 23-sep-2026 en 5 del top de pastillas).
// Lo verificable es el título: el vendedor escribe ahí para qué auto y años es
// ("Pastillas De Freno Kia Rio 4 2012-2023"). Cada fila del plan cita la
// posición del top de donde la sacó, y esto comprueba SIN la IA que el modelo
// y los años estén escritos en ese título. Es lo que declara un vendedor real,
// no una tabla oficial: sirve para separar dato de invención, no más.
const AÑO_MIN = 1985
export function aniosDe(texto) {
  const t = String(texto ?? '')
  const anios = new Set()
  for (const m of t.matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)) anios.add(Number(m[1]))
  // "12/20", "12-20", "2012/20": años abreviados en pares
  for (const m of t.matchAll(/\b(\d{2}|\d{4})\s*[/-]\s*(\d{2})\b/g)) {
    const a = m[1].length === 4 ? Number(m[1]) : 2000 + Number(m[1])
    const b = 2000 + Number(m[2])
    if (a >= AÑO_MIN && a <= 2049 && b >= a && b <= 2049) { anios.add(a); anios.add(b) }
  }
  return anios
}

// palabras de modelo: lo que no es año, cilindrada ni relleno
const RELLENO = new Set(['y', 'e', 'con', 'de', 'del', 'la', 'el', 'los', 'las', 'new', 'nuevo', 'motor', 'bencinero', 'diesel', 'diésel', 'sedan', 'sedán', 'hatch', 'hb'])
function palabrasModelo(modelos) {
  return String(modelos ?? '').toLowerCase().split(/[^a-z0-9áéíóúñ]+/)
    .filter((w) => w.length >= 2 && !RELLENO.has(w) && !/^\d+(\.\d+)?$/.test(w) && !/^(19|20)\d\d$/.test(w))
}

// Pura. {estado, fuente}: 'verificada' = modelo y años en el título citado;
// 'parcial' = el modelo está pero los años no calzan; 'no-calza' = el título
// citado es de otro auto; 'sin-fuente' = la IA no citó publicación.
export function verificarFilaRepuesto(fila, producto) {
  if (!producto) return { estado: 'sin-fuente', fuente: null }
  const fuente = { titulo: producto.titulo ?? null, url: producto.url ?? null, sku: producto.sku ?? null, precio: producto.precio ?? null, posicion: producto.posicion ?? null }
  const titulo = String(producto.titulo ?? '').toLowerCase()
  const palabras = palabrasModelo(fila.modelos)
  const modeloEnTitulo = palabras.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(titulo))
  if (!modeloEnTitulo) return { estado: 'no-calza', fuente }
  const delPlan = aniosDe(fila.modelos), delTitulo = aniosDe(producto.titulo)
  if (!delPlan.size) return { estado: 'parcial', fuente }
  const calzan = [...delPlan].every((a) => delTitulo.has(a))
  return { estado: calzan ? 'verificada' : 'parcial', fuente }
}

export function verificarPlanRepuestos(plan, productos) {
  if (!Array.isArray(plan)) return plan
  const porPosicion = new Map((productos ?? []).map((p) => [p.posicion, p]))
  return plan.map((f) => {
    const v = verificarFilaRepuesto(f, Number.isInteger(f.fuentePos) ? porPosicion.get(f.fuentePos) : null)
    return { ...f, verificacion: v.estado, fuente: v.fuente }
  })
}
