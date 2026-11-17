// QUIÉN VENDE LO MISMO (17-nov-2026).
//
// Pedido del dueño: «sabemos que competimos con otros vendedores… no va a
// servir solo el título, tiene que leer la imagen del producto competidor para
// que haga match de que sí es el mismo producto… para que aprovechemos de hacer
// descuento, porque la gente igual ve si hay más barato». Y la forma de
// trabajarlo: «vamos a ir recolectando, y lo que va indicando, nosotros en el
// frontend indicaremos si es lo mismo».
//
// La gama (gama.js) trata como rival a todo lo que cae en un rango de precio,
// sea o no el mismo producto. Acá la pregunta es otra: de las publicaciones de
// la búsqueda, cuáles son EL MISMO producto y a cuánto lo venden por unidad.
//   1. los candidatos son las publicaciones del último scan del nicho (ya
//      traen foto, precio, vendidos y posición);
//   2. una lectura de fotos propone cuáles parecen el mismo (no decide nada);
//   3. el dueño confirma mirando la foto, y dice cuántas unidades trae el pack;
//   4. con los confirmados se compara el precio por unidad y lo que dejaría
//      igualar cada precio. La historia sale de los snapshots de cada scan.
// Medido en el piloto de ese día sobre un nicho propio: el mismo producto se
// vendía en packs a casi la mitad por unidad, cosa que el título no decía y la
// gama por precio escondía (el pack cae fuera del rango del suelto).
import { IgualPropio } from '../models/IgualPropio.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { Nicho } from '../models/Nicho.js'
import { Snapshot } from '../models/Snapshot.js'
import { Producto } from '../models/Producto.js'
import { precioDePropio, vistaDelNicho } from './gama.js'

const finito = Number.isFinite
const sinTildes = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// El producto propio al que pertenecen las marcas: la familia (todos sus
// colores son el mismo producto) o, sin familia, la publicación.
export const claveDePropio = (p) => (p?.familiaMl?.id ? `familia:${p.familiaMl.id}` : p?.sku ?? null)

// Pura. Cuántas unidades trae una publicación según su título: «Pack X2»,
// «2 Unid», «4 Unidades», «2u», «60 Toallas…». Es solo el valor de partida: el
// dueño lo confirma al marcar. Las piezas de un set no son unidades (un set de
// 34 piezas es un producto), ni los colores, modos, watts o medidas.
const NO_SON_UNIDADES = new Set(['colores', 'modos', 'niveles', 'velocidades', 'funciones', 'cabezales', 'luces', 'leds', 'metros', 'pulgadas', 'watts', 'piezas', 'pzas', 'pcs', 'accesorios', 'pasos', 'anos', 'meses', 'dias', 'horas', 'cajones', 'compartimentos', 'puertos'])
export function unidadesDeTitulo(titulo) {
  const t = sinTildes(titulo).replace(/\s+/g, ' ').trim()
  const tomar = (m) => { const n = m ? Number(m[1]) : NaN; return n >= 2 && n <= 500 ? n : null }
  return (
    tomar(/\bpack\s*(?:de\s*)?x?\s*(\d{1,3})\b(?!\s*(?:cm|mm|mts?|m|w|led|leds)\b)/.exec(t)) ??
    tomar(/\b(\d{1,3})\s*(?:u|un|und|unds|unid|unids|unidad|unidade|unidades|uds)\b/.exec(t)) ??
    tomar(/(?<![\dx])\bx\s?(\d{1,3})\b(?!\s*(?:cm|mm|mts?|m|w|x)\b)(?!x)/.exec(t)) ??
    (() => { const m = /^(\d{1,3}) ([a-zñ]{4,}s)\b/.exec(t); return m && !NO_SON_UNIDADES.has(m[2]) ? tomar(m) : null })() ??
    1
  )
}

// Pura. La foto del listado en su variante chica (320 px): sobra para
// reconocer el producto y pesa menos de la mitad que la de 500 px.
export const fotoChica = (url) => String(url ?? '').replace(/-[A-Z]\.(webp|jpe?g|png)$/i, '-V.$1')

// ─── LA MEDIDA ──────────────────────────────────────────────────────────────
// Pedido del dueño al usar la primera versión (17-nov-2026): «el de nosotros
// es 90x60… los de abajo pueden ser igual pero el tamaño de nosotros es
// diferente, lo mismo que otros productos: falta que sea más inteligente». La
// primera versión comparaba el precio por unidad sin mirar el tamaño, y la
// publicación más barata por unidad era la misma cosa en un formato más chico.
// Dos publicaciones del mismo producto solo se comparan directo si además
// tienen la misma medida: el tamaño, el largo, la potencia, las piezas.

const num = (x) => Number(String(x).replace(',', '.'))
// Pura. Las medidas que trae un título, por tipo. Las dimensiones quedan en
// centímetros y ordenadas (90x60 y 60x90 son lo mismo).
export function medidasDeTitulo(titulo) {
  const t = ` ${sinTildes(titulo).replace(/\s+/g, ' ')} `
  const m = {}
  const dims = /(\d{1,4}(?:[.,]\d{1,2})?) ?(?:x|×|\*) ?(\d{1,4}(?:[.,]\d{1,2})?)(?: ?(?:x|×|\*) ?(\d{1,4}(?:[.,]\d{1,2})?))? ?(cm|mm|mts?|m)?\b/.exec(t)
  if (dims) {
    const factor = dims[4] === 'mm' ? 0.1 : dims[4] && dims[4] !== 'cm' ? 100 : 1
    const lados = [dims[1], dims[2], dims[3]].filter(Boolean).map((x) => Math.round(num(x) * factor * 10) / 10).sort((a, b) => a - b)
    // «2x1» sin unidad es una oferta, no una medida
    if (dims[4] || lados.at(-1) >= 10) m.dimensiones = lados
  }
  const sinDims = dims ? t.replace(dims[0], ' ') : t
  const uno = (re, f = (x) => x) => { const r = re.exec(sinDims); return r ? f(num(r[1])) : null }
  const poner = (k, v) => { if (v != null && Number.isFinite(v) && v > 0) m[k] = v }
  poner('largoM', uno(/\b(\d{1,3}(?:[.,]\d)?) ?(?:m|mt|mts|metros?)\b/))
  poner('watts', uno(/\b(\d{1,5}) ?(?:w|watts?)\b/))
  poner('piezas', uno(/\b(\d{1,4}) ?(?:piezas?|pzas?|pzs?|pcs)\b/))
  poner('ml', uno(/\b(\d{1,5}) ?(?:ml|cc)\b/) ?? uno(/\b(\d{1,3}(?:[.,]\d{1,2})?) ?(?:l|lt|lts|litros?)\b/, (x) => x * 1000))
  poner('gramos', uno(/\b(\d{1,5}) ?(?:g|gr|grs|gramos?)\b/) ?? uno(/\b(\d{1,3}(?:[.,]\d{1,2})?) ?(?:kg|kilos?)\b/, (x) => x * 1000))
  poner('leds', uno(/\b(\d{1,4}) ?leds?\b/))
  poner('mah', uno(/\b(\d{3,6}) ?mah\b/))
  return m
}

const NOMBRE_MEDIDA = { dimensiones: (v) => `${[...v].reverse().map((x) => String(x).replace('.', ',')).join('×')} cm`, largoM: (v) => `${String(v).replace('.', ',')} m`, watts: (v) => `${v} w`, piezas: (v) => `${v} piezas`,
  ml: (v) => (v >= 1000 ? `${String(v / 1000).replace('.', ',')} L` : `${v} ml`), gramos: (v) => (v >= 1000 ? `${String(v / 1000).replace('.', ',')} kg` : `${v} g`), leds: (v) => `${v} led`, mah: (v) => `${v} mAh` }
// en qué orden se nombra la medida de un producto: la primera que tenga
const ORDEN_MEDIDAS = ['dimensiones', 'largoM', 'watts', 'piezas', 'ml', 'gramos', 'mah', 'leds']
// Pura. La medida en palabras: «90×60 cm», «15 m», «300 w».
export function textoMedida(medidas) {
  const k = ORDEN_MEDIDAS.find((x) => medidas?.[x] != null)
  return k ? NOMBRE_MEDIDA[k](medidas[k]) : null
}
const igualValor = (a, b) => (Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]) : a === b)

// Pura. ¿La otra publicación tiene la misma medida que la propia? Se miran solo
// los tipos de medida que trae el título propio. Si ninguno aparece en la otra,
// no se sabe. `factor` dice cuántas veces cabe la otra en la propia cuando la
// medida es de superficie, volumen o peso (un paño de 90×60 son 1,5 de 60×60):
// con eso se lleva su precio al tamaño propio. Largo, potencia y piezas no se
// escalan: el doble de metros no cuesta el doble.
export function compararMedida(propia, otra) {
  const tipos = ORDEN_MEDIDAS.filter((k) => propia?.[k] != null && otra?.[k] != null)
  if (!tipos.length) return { estado: 'sin-dato', texto: textoMedida(otra ?? {}), factor: null }
  const distinto = tipos.find((k) => !igualValor(propia[k], otra[k]))
  if (!distinto) return { estado: 'igual', texto: NOMBRE_MEDIDA[tipos[0]](otra[tipos[0]]), factor: 1 }
  const tamano = (v) => (Array.isArray(v) ? v.reduce((a, x) => a * x, 1) : v)
  const escalable = ['dimensiones', 'ml', 'gramos'].includes(distinto) && (!Array.isArray(propia[distinto]) || propia[distinto].length === otra[distinto].length)
  const factor = escalable && tamano(otra[distinto]) > 0 ? Math.round((tamano(propia[distinto]) / tamano(otra[distinto])) * 1000) / 1000 : null
  return { estado: 'distinta', texto: NOMBRE_MEDIDA[distinto](otra[distinto]), factor }
}

// Pura. Lo que falta revisar, en el orden en que conviene mirarlo: lo que la
// foto dice que es el mismo (primero en la medida propia, después sin medida a
// la vista, después en otra medida), lo que solo calza por medida, lo parecido
// y el resto por su puesto en la búsqueda.
export function ordenarCandidatos(candidatos) {
  const porMedida = { igual: 0, 'sin-dato': 1, distinta: 2 }
  const rango = (c) => {
    const s = c.sugerencia?.relacion, m = porMedida[c.medida?.estado ?? 'sin-dato']
    if (s === 'igual' || s === 'otra-medida') return (s === 'otra-medida' ? 2 : m)
    if (s === 'parecido') return 5
    if (s === 'distinto') return 7
    return m === 0 ? 3 : 6
  }
  return [...(candidatos ?? [])].sort((a, b) => rango(a) - rango(b) || (a.posicion ?? 999) - (b.posicion ?? 999))
}

const mediana = (xs) => { const v = xs.filter(finito).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2 }
const pesos = (n) => `$${Math.round(n).toLocaleString('es-CL')}`

// Pura. Dónde queda el precio propio POR UNIDAD entre los que venden lo mismo.
// `iguales`: [{ sku, precio, unidades, precioUnidad }].
export function resumenIguales(precioUnidadPropio, iguales) {
  const conPrecio = (iguales ?? []).filter((x) => finito(x.precioUnidad) && x.precioUnidad > 0)
  if (!conPrecio.length) return { confirmados: (iguales ?? []).length, frase: (iguales ?? []).length ? 'Los que marcaste no aparecen con precio en el último scan.' : 'Todavía no marcas a nadie que venda lo mismo.' }
  const orden = [...conPrecio].sort((a, b) => a.precioUnidad - b.precioUnidad)
  const masBarato = orden[0]
  const base = { confirmados: (iguales ?? []).length, masBarato: { sku: masBarato.sku, precio: masBarato.precio, unidades: masBarato.unidades, precioUnidad: masBarato.precioUnidad }, medianaUnidad: Math.round(mediana(orden.map((x) => x.precioUnidad))) }
  if (!finito(precioUnidadPropio) || precioUnidadPropio <= 0) return { ...base, frase: `El más barato de los que venden lo mismo cobra ${pesos(masBarato.precioUnidad)} por unidad.` }
  const masBaratos = orden.filter((x) => x.precioUnidad < precioUnidadPropio).length
  const brechaPct = Math.round(((precioUnidadPropio - masBarato.precioUnidad) / precioUnidadPropio) * 100)
  const n = conPrecio.length
  const frase = masBaratos === 0
    ? `De ${n} que ${n === 1 ? 'vende' : 'venden'} lo mismo, ninguno cobra menos que tú por unidad.`
    : `De ${n} que ${n === 1 ? 'vende' : 'venden'} lo mismo, ${masBaratos === n ? (n === 1 ? 'cobra' : 'todos cobran') : `${masBaratos} ${masBaratos === 1 ? 'cobra' : 'cobran'}`} menos que tú por unidad. El más barato cobra ${pesos(masBarato.precioUnidad)}, un ${brechaPct}% menos.`
  return { ...base, masBaratos, lugar: masBaratos + 1, de: n + 1, brechaPct, frase }
}

const ficha = (p, marca, precioUnidadPropio, medidaPropia = {}) => {
  const unidades = marca?.relacion ? marca.unidades ?? 1 : marca?.sugerencia?.unidades ?? unidadesDeTitulo(p.titulo)
  const precioUnidad = finito(p.precio) && p.precio > 0 ? Math.round(p.precio / unidades) : null
  // la medida: del título; si el título no la trae, la que leyó la foto
  let medida = compararMedida(medidaPropia, medidasDeTitulo(p.titulo))
  if (medida.estado === 'sin-dato' && marca?.sugerencia?.medida) medida = compararMedida(medidaPropia, medidasDeTitulo(marca.sugerencia.medida))
  // su precio por unidad llevado a la medida propia, cuando se puede escalar
  const enMiMedida = finito(precioUnidad) && medida.estado === 'distinta' && finito(medida.factor) ? Math.round(precioUnidad * medida.factor) : null
  const comparable = enMiMedida ?? precioUnidad
  return { sku: p.sku, titulo: p.titulo, precio: p.precio ?? null, imagen: p.imagen ?? null, url: p.url ?? null, posicion: p.posicion ?? null,
    vendidos: p.vendidos ?? null, numReviews: p.numReviews ?? null, esFull: p.esFull ?? null, esTiendaOficial: p.esTiendaOficial ?? null, vendedor: p.vendedor ?? null,
    unidades, precioUnidad, medida: { estado: medida.estado, texto: medida.texto }, precioUnidadEnMiMedida: enMiMedida,
    diferenciaPct: finito(comparable) && finito(precioUnidadPropio) && precioUnidadPropio > 0 ? Math.round(((comparable - precioUnidadPropio) / precioUnidadPropio) * 100) : null,
    sugerencia: marca?.sugerencia ? { relacion: relacionSugerida(marca.sugerencia.relacion, medida.estado), motivo: marca.sugerencia.motivo ?? null } : null }
}

// Pura. La foto dice si es el mismo producto; el tamaño, cuando el título lo
// trae escrito, lo decide el título. Medido el 17-nov-2026 en la primera
// lectura con medida: el modelo mandó a «otra medida» un pack de 120 del mismo
// tamaño, porque leyó la cantidad del pack como una medida.
export function relacionSugerida(relacion, estadoMedida) {
  if (relacion !== 'igual' && relacion !== 'otra-medida') return relacion
  return estadoMedida === 'igual' ? 'igual' : estadoMedida === 'distinta' ? 'otra-medida' : relacion
}

// Lo que queda por venta (después de Mercado Libre y del costo, antes de la
// publicidad) si la publicación propia se pusiera a ese precio.
async function quedaA(propio, precio) {
  if (!finito(precio) || precio <= 0) return null
  const { economiaUnidad } = await import('./economiaUnidad.js')
  const e = await economiaUnidad(propio, null, { precio }).catch(() => null)
  return e ? { precio: Math.round(precio), queda: e.gananciaClp ?? null, quedaSinCosto: e.quedaParaProductoClp ?? null } : null
}

// La vista de «Quién vende lo mismo» de un producto propio.
export async function vistaIguales(propio, { conEconomia = true } = {}) {
  if (!propio?.nichoId) return { estado: 'sin-nicho' }
  const nicho = await Nicho.findById(propio.nichoId).select('keyword competenciaExcluida').lean()
  if (!nicho) return { estado: 'sin-nicho' }
  const vista = await vistaDelNicho(nicho)
  if (!vista?.productos?.length) return { estado: 'sin-scan', keyword: nicho.keyword }
  const clave = claveDePropio(propio)
  const marcas = new Map((await IgualPropio.find({ clave }).lean()).map((m) => [m.sku, m]))
  // nada propio entra como competidor (ni otra publicación propia del mismo nicho)
  const mios = new Set((await ProductoPropio.find({}).select('sku itemIdMl').lean()).flatMap((x) => [x.sku, x.itemIdMl]).filter(Boolean))
  const delScan = vista.productos.filter((p) => p?.sku && !mios.has(p.sku) && !(p.itemId && mios.has(p.itemId)))
  const enScan = new Map(delScan.map((p) => [p.sku, p]))

  const precio = precioDePropio(propio)
  const unidadesPropias = finito(propio.unidadesPack) && propio.unidadesPack >= 1 ? propio.unidadesPack : unidadesDeTitulo(propio.titulo)
  const precioUnidadPropio = finito(precio) && precio > 0 ? Math.round(precio / unidadesPropias) : null
  const medidaPropia = medidasDeTitulo(propio.titulo)

  // los confirmados que ya no salen en el último scan se muestran con su último dato conocido
  const esMismo = (m) => m.relacion === 'igual' || m.relacion === 'otra-medida'
  const fuera = [...marcas.values()].filter((m) => esMismo(m) && !enScan.has(m.sku)).map((m) => m.sku)
  const ultimos = new Map()
  if (fuera.length) {
    const prods = new Map((await Producto.find({ sku: { $in: fuera } }).lean()).map((p) => [p.sku, p]))
    const snaps = await Snapshot.aggregate([{ $match: { sku: { $in: fuera } } }, { $sort: { fecha: -1 } }, { $group: { _id: '$sku', s: { $first: '$$ROOT' } } }])
    for (const { _id, s } of snaps) if (prods.has(_id)) ultimos.set(_id, { ...prods.get(_id), precio: s.precio, vendidos: s.vendidos, numReviews: s.numReviews, posicion: null, vistoEl: s.fecha })
  }
  const confirmados = (relacion, precioDe) => [...marcas.values()].filter((m) => m.relacion === relacion)
    .map((m) => { const p = enScan.get(m.sku) ?? ultimos.get(m.sku); return p ? { ...ficha(p, m, precioUnidadPropio, medidaPropia), enUltimoScan: enScan.has(m.sku), vistoEl: p.vistoEl ?? null } : null })
    .filter(Boolean).sort((a, b) => (precioDe(a) ?? Infinity) - (precioDe(b) ?? Infinity))
  // el mismo producto en la medida propia (lo que se compara directo) y en otra medida (va aparte)
  const iguales = confirmados('igual', (x) => x.precioUnidad)
  const otraMedida = confirmados('otra-medida', (x) => x.precioUnidadEnMiMedida ?? x.precioUnidad)
  const candidatos = ordenarCandidatos(delScan.filter((p) => !marcas.get(p.sku)?.relacion).map((p) => ficha(p, marcas.get(p.sku), precioUnidadPropio, medidaPropia)))
  const descartados = delScan.filter((p) => marcas.get(p.sku)?.relacion === 'distinto').map((p) => ficha(p, marcas.get(p.sku), precioUnidadPropio, medidaPropia))

  // la historia de precio de cada confirmado, de los snapshots de sus scans
  if (iguales.length || otraMedida.length) {
    const desde = new Date(Date.now() - 120 * 86400e3)
    const hist = await Snapshot.find({ sku: { $in: [...iguales, ...otraMedida].map((x) => x.sku) }, fecha: { $gte: desde }, precio: { $gt: 0 } }).select('sku fecha precio').sort({ fecha: 1 }).lean()
    const porSku = new Map()
    for (const h of hist) {
      const dia = h.fecha.toISOString().slice(0, 10), serie = porSku.get(h.sku) ?? porSku.set(h.sku, []).get(h.sku)
      if (serie.at(-1)?.dia === dia) serie[serie.length - 1] = { dia, precio: h.precio }
      else serie.push({ dia, precio: h.precio })
    }
    for (const x of [...iguales, ...otraMedida]) x.historia = (porSku.get(x.sku) ?? []).slice(-20)
  }

  const resumen = resumenIguales(precioUnidadPropio, iguales.filter((x) => x.enUltimoScan))
  let economia = null
  if (conEconomia && finito(precio)) {
    const [hoy, alMasBarato, aLaMediana] = await Promise.all([
      quedaA(propio, precio),
      resumen.masBarato && resumen.masBarato.precioUnidad < precioUnidadPropio ? quedaA(propio, resumen.masBarato.precioUnidad * unidadesPropias) : null,
      resumen.medianaUnidad && resumen.medianaUnidad < precioUnidadPropio ? quedaA(propio, resumen.medianaUnidad * unidadesPropias) : null,
    ])
    economia = { hoy, alMasBarato, aLaMediana, conCosto: finito(propio.costoUnitarioClp) }
  }
  const revisadas = [...marcas.values()].filter((m) => m.sugerencia).length
  return {
    estado: 'ok', keyword: nicho.keyword, fechaScan: vista.fechaScan,
    propio: { titulo: propio.titulo, imagen: propio.imagen ?? null, precio, unidades: unidadesPropias, unidadesDelTitulo: !(finito(propio.unidadesPack) && propio.unidadesPack >= 1), precioUnidad: precioUnidadPropio,
      medida: textoMedida(medidaPropia) },
    resumen, economia, iguales, otraMedida, candidatos, descartados,
    fotos: { revisadas, sinRevisar: candidatos.filter((c) => !c.sugerencia).length,
      parecenIgual: candidatos.filter((c) => c.sugerencia?.relacion === 'igual').length, parecenOtraMedida: candidatos.filter((c) => c.sugerencia?.relacion === 'otra-medida').length },
  }
}

// Lo que dijo el dueño de una publicación: 'igual' (el mismo producto, en la
// misma medida), 'otra-medida' (el mismo en otro tamaño, largo o potencia),
// 'distinto' o null (quitar la marca). Vale para todos los colores de la
// familia, porque la clave es de la familia. `unidades`: cuántas trae.
export async function marcarIgual(propio, { sku, relacion = null, unidades = null } = {}) {
  if (!/^MLC[A-Z]?\d+$/i.test(String(sku ?? ''))) { const e = new Error('sku de la publicación no válido'); e.status = 400; throw e }
  if (![null, 'igual', 'otra-medida', 'distinto'].includes(relacion)) { const e = new Error("relacion debe ser 'igual', 'otra-medida', 'distinto' o null"); e.status = 400; throw e }
  const cambios = { relacion, marcadoEl: relacion ? new Date() : null }
  if (finito(unidades) && unidades >= 1 && unidades <= 500) cambios.unidades = Math.round(unidades)
  // sin el dato, lo que diga el título de esa publicación (un «Pack X2» parte en 2)
  else if (relacion === 'igual' || relacion === 'otra-medida') cambios.unidades = unidadesDeTitulo((await Producto.findOne({ sku }).select('titulo').lean())?.titulo)
  await IgualPropio.updateOne({ clave: claveDePropio(propio), sku }, { $set: cambios }, { upsert: true })
}

// Confirma de una vez todo lo que falta revisar y que la lectura propone como
// `relacion` ('igual' o 'otra-medida'), con las unidades propuestas. En un nicho
// parejo son decenas de publicaciones: el dueño confirma el grupo y después
// saca a mano las que no correspondan.
export async function marcarLote(propio, relacion) {
  if (!['igual', 'otra-medida'].includes(relacion)) { const e = new Error("el lote debe ser 'igual' u 'otra-medida'"); e.status = 400; throw e }
  const v = await vistaIguales(propio, { conEconomia: false })
  if (v.estado !== 'ok') return 0
  const lote = v.candidatos.filter((c) => c.sugerencia?.relacion === relacion)
  if (!lote.length) return 0
  const ahora = new Date()
  await IgualPropio.bulkWrite(lote.map((c) => ({ updateOne: { filter: { clave: claveDePropio(propio), sku: c.sku }, update: { $set: { relacion, unidades: c.unidades ?? 1, marcadoEl: ahora } }, upsert: true } })))
  return lote.length
}

// Cuántas unidades trae la publicación PROPIA (un pack de 2 son 2): se guarda
// en todas las publicaciones de la familia.
export async function fijarUnidadesPropias(propio, unidades) {
  if (!finito(unidades) || unidades < 1 || unidades > 500) { const e = new Error('unidades debe ser un número entre 1 y 500'); e.status = 400; throw e }
  const filtro = propio.familiaMl?.id ? { 'familiaMl.id': propio.familiaMl.id } : { _id: propio._id }
  await ProductoPropio.updateMany(filtro, { $set: { unidadesPack: Math.round(unidades) } })
}

// ─── LA LECTURA DE FOTOS ────────────────────────────────────────────────────
const SYSTEM_FOTOS = `Eres un comprador experto de Mercado Libre Chile. Te muestro la foto de MI PRODUCTO, con su medida, y después fotos numeradas de otras publicaciones de la misma búsqueda, cada una con su título y precio.

Tu trabajo: decir cuáles venden EL MISMO PRODUCTO FÍSICO que el mío, y si es en la misma medida. Mira la foto antes que el título.
- "igual": la misma forma, diseño y modelo, Y la misma medida que el mío (tamaño, largo, potencia, capacidad, número de piezas). No importa el color, el vendedor, la marca pegada ni cómo esté tomada la foto. Si la publicación trae varias unidades (un pack), sigue siendo "igual".
- "otra-medida": el mismo producto, pero en otro tamaño, largo, potencia o capacidad (por ejemplo 60x60 cuando el mío es 90x60, o 30 metros cuando el mío es de 15). En un set o kit, también cuando trae otro número de piezas distintas (un set de 44 piezas no es el de 34).
- OJO: la cantidad de unidades iguales que trae el pack NO es una medida. 100 paños de 90x60 son "igual" a 60 paños de 90x60: lo que cambia va en "unidades".
- "parecido": el mismo tipo de producto pero otro modelo u otro diseño.
- Lo demás (otro producto) NO lo incluyas en la respuesta.

Para cada publicación que incluyas indica:
- "unidades": cuántas unidades del producto trae (1 si es suelto, 2 si es un pack de dos, 100 si son 100 paños; guíate por la foto y por el título);
- "medida": la medida que dice el título o que se lee en la foto o en el envase, escrita corta ("60x60 cm", "30 m", "200 w", "44 piezas"); deja "" si no se ve por ningún lado;
- "motivo": muy corto, por qué es igual o en qué se diferencia.
Si la medida no se ve, decide por la forma y responde "igual" solo si todo lo demás calza. Ante la duda entre "igual" y "parecido", responde "parecido": una persona va a confirmar mirando la foto.`

const SCHEMA_FOTOS = {
  type: 'object', additionalProperties: false, required: ['coincidencias'],
  properties: {
    coincidencias: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['n', 'relacion', 'unidades', 'medida', 'motivo'],
        properties: { n: { type: 'integer' }, relacion: { type: 'string', enum: ['igual', 'otra-medida', 'parecido'] }, unidades: { type: 'integer' }, medida: { type: 'string' }, motivo: { type: 'string' } },
      },
    },
  },
}
const POR_TANDA = 60

// Pura. De la respuesta del modelo a una sugerencia por publicación de la tanda:
// lo que no viene en la respuesta se anota como 'distinto' para no volver a mirarlo.
export function sugerenciasDeTanda(tanda, coincidencias, { modelo = null, el = new Date() } = {}) {
  const porN = new Map((coincidencias ?? []).filter((c) => Number.isInteger(c?.n)).map((c) => [c.n, c]))
  return tanda.map((p, i) => {
    const c = porN.get(i + 1)
    return { sku: p.sku, sugerencia: c ? { relacion: c.relacion, unidades: c.unidades >= 1 && c.unidades <= 500 ? c.unidades : 1, medida: String(c.medida ?? '').slice(0, 40) || null, motivo: String(c.motivo ?? '').slice(0, 160), modelo, el } : { relacion: 'distinto', modelo, el } }
  })
}

// Mira las fotos de las publicaciones del scan que todavía no se han mirado y
// deja una sugerencia por cada una. No marca nada: el dueño confirma. `pedir` y
// `bajarFoto` se inyectan en los tests.
export async function sugerirIguales(propio, { max = 240, pedir = null, bajarFoto = null } = {}) {
  const v = await vistaIguales(propio, { conEconomia: false })
  if (v.estado !== 'ok') return { estado: v.estado, revisadas: 0 }
  const pendientes = v.candidatos.filter((c) => !c.sugerencia && c.imagen).slice(0, max)
  if (!pendientes.length) return { estado: 'ok', revisadas: 0, parecen: 0, costoUsd: 0 }
  const { presupuesto, registrarGasto } = await import('./gastos.js')
  if ((await presupuesto()).ia.agotado) { const e = new Error('Presupuesto del mes agotado: la lectura de fotos queda para el próximo mes o cuando subas el techo.'); e.status = 409; throw e }
  const { imagenEnLinea } = await import('./auditor.js')
  const { pedirJSON } = await import('./llm.js')
  const foto = bajarFoto ?? ((url) => imagenEnLinea(fotoChica(url)))
  const mia = propio.imagen ? await foto(propio.imagen) : null
  if (!mia) { const e = new Error('No pude bajar la foto de tu producto para comparar.'); e.status = 502; throw e }
  const clave = claveDePropio(propio)
  // las tandas van a la vez: cada una es una llamada con sus fotos, y en fila la lectura de un nicho entero
  // tardaba varios minutos (el dueño está esperando con la pantalla abierta)
  const tandas = []
  for (let i = 0; i < pendientes.length; i += POR_TANDA) tandas.push(pendientes.slice(i, i + POR_TANDA))
  const leidas = await Promise.allSettled(tandas.map(async (candidatos) => {
    const fotos = await Promise.all(candidatos.map((c) => foto(c.imagen)))
    const tanda = candidatos.filter((_, j) => fotos[j])
    if (!tanda.length) return { sugerencias: [], costoUsd: 0 }
    const bloques = [{ type: 'text', text: `MI PRODUCTO: "${propio.titulo}"${v.propio.medida ? ` · medida: ${v.propio.medida}` : ''} · trae ${v.propio.unidades} ${v.propio.unidades === 1 ? 'unidad' : 'unidades'}` }, mia, { type: 'text', text: `PUBLICACIONES DE LA BÚSQUEDA "${v.keyword}" (${tanda.length}):` }]
    let n = 0
    candidatos.forEach((c, j) => { if (!fotos[j]) return; n++; bloques.push({ type: 'text', text: `#${n} · ${c.titulo} · $${c.precio ?? '?'}` }, fotos[j]) })
    const r = await (pedir ?? pedirJSON)({ system: SYSTEM_FOTOS, user: bloques, schema: SCHEMA_FOTOS, maxTokens: 6000 })
    return { sugerencias: sugerenciasDeTanda(tanda, r.datos?.coincidencias, { modelo: r.modelo ?? null }), costoUsd: r.costoUsd ?? 0 }
  }))
  let costoUsd = 0, revisadas = 0, parecen = 0
  for (const t of leidas) {
    if (t.status !== 'fulfilled' || !t.value.sugerencias.length) continue
    costoUsd += t.value.costoUsd
    await IgualPropio.bulkWrite(t.value.sugerencias.map((x) => ({ updateOne: { filter: { clave, sku: x.sku }, update: { $set: { sugerencia: x.sugerencia } }, upsert: true } })))
    revisadas += t.value.sugerencias.length
    parecen += t.value.sugerencias.filter((x) => x.sugerencia.relacion !== 'distinto').length
  }
  const falla = leidas.find((t) => t.status === 'rejected')
  // si ninguna tanda se pudo leer, que se sepa por qué; si falló una parte, lo leído queda y el resto se reintenta
  if (falla && !revisadas) throw falla.reason
  if (costoUsd > 0) await registrarGasto(propio.nichoId, costoUsd, 'ia')
  return { estado: 'ok', revisadas, parecen, costoUsd: Math.round(costoUsd * 10000) / 10000, sinLeer: leidas.filter((t) => t.status === 'rejected').length * POR_TANDA }
}
