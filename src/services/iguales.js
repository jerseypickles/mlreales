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
import { FILTRO_VIGENTES } from '../../frontend/src/lib/catalogoPropios.js'

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
  poner('piezas', uno(/\b(\d{1,4}) ?(?:piezas?|pzas?|pzs?|pcs)\b/) ?? piezasDeSet(sinDims))
  poner('ml', uno(/\b(\d{1,5}) ?(?:ml|cc)\b/) ?? uno(/\b(\d{1,3}(?:[.,]\d{1,2})?) ?(?:l|lt|lts|litros?)\b/, (x) => x * 1000))
  poner('gramos', uno(/\b(\d{1,5}) ?(?:g|gr|grs|gramos?)\b/) ?? uno(/\b(\d{1,3}(?:[.,]\d{1,2})?) ?(?:kg|kilos?)\b/, (x) => x * 1000))
  poner('leds', uno(/\b(\d{1,4}) ?leds?\b/))
  poner('mah', uno(/\b(\d{3,6}) ?mah\b/))
  return m
}

// Pura. Las piezas de un set cuando el título no dice «piezas»: «Set 56 Pinceles», «Kit de 12 Destornilladores», «Set 8 +
// Estuche». Medido el 18-nov-2026 en una búsqueda de sets: casi ningún título traía la palabra, y sin eso un set
// de 34 no se podía comparar con uno de 56. Solo en títulos que dicen set, kit o juego; el número pegado a esa
// palabra o el que va delante de lo que trae. Lo que es una unidad, un color o una medida no cuenta.
const NO_SON_PIEZAS = new Set([...NO_SON_UNIDADES, 'unidades', 'unidad', 'unids', 'unid', 'uds', 'packs', 'sets', 'kits', 'juegos', 'plazas', 'personas', 'puestos', 'tallas', 'capas', 'tonos',
  'litros', 'gramos', 'kilos', 'voltios', 'cuotas', 'cm', 'mm', 'm', 'mt', 'mts', 'w', 'ml', 'l', 'lt', 'lts', 'kg', 'g', 'gr', 'grs', 'v', 'en', 'x', 'de'])
function piezasDeSet(t) {
  if (!/\b(?:set|kit|juego)\b/.test(t)) return null
  const m = /\b(?:set|kit|juego) (?:de )?(\d{1,4})\b(?: ([a-zñ]+))?/.exec(t) ?? /\b(\d{1,4}) ([a-zñ]{4,}s)\b/.exec(t)
  if (!m || (m[2] && NO_SON_PIEZAS.has(m[2]))) return null
  const n = Number(m[1])
  return n >= 2 ? n : null
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

// ─── QUÉ DA LA BÚSQUEDA POR ESA PLATA ───────────────────────────────────────
// Lectura del dueño (18-nov-2026) de por qué no se movió parte de su primera importación: «fallamos por traer lo
// mismo que los demás, sobre todo en diseño y watts». Medido ese día en el scan: a la plata de su producto, la
// búsqueda ofrecía bastante más medida, y la medida propia se vendía a poco más de la mitad. La foto dice quién
// vende el mismo producto; esto dice lo otro que compara el comprador: cuánto le dan por lo que paga.
//
// Pura. Se mira un solo tipo de medida: el primero que trae el título propio (watts, piezas, metros…). De las
// publicaciones del scan que traen esa medida: cuántas tienen la misma y a cuánto la venden, y cuántas dan MÁS
// medida por la misma plata o menos. Se cuenta; no hay umbrales elegidos a mano.
// `publicaciones`: [{ sku, titulo, precioUnidad, vendidos, imagen, url, medidas? }] (sin `medidas`, las del título).
const NOMBRE_TIPO = { dimensiones: 'tamaño', largoM: 'largo', watts: 'watts', piezas: 'piezas', ml: 'contenido', gramos: 'peso', mah: 'batería', leds: 'leds' }
// la misma medida nombrada con su artículo, para decir quién la trae en el título
const EN_TITULO = { dimensiones: 'el tamaño', largoM: 'el largo', watts: 'los watts', piezas: 'las piezas', ml: 'el contenido', gramos: 'el peso', mah: 'la batería', leds: 'los leds' }
const tamano = (v) => (Array.isArray(v) ? v.reduce((a, x) => a * x, 1) : v)
export function medidaPorLaPlata(medidaPropia, precioUnidadPropio, publicaciones, { ejemplos = 3, maxGrupos = 12 } = {}) {
  const tipo = ORDEN_MEDIDAS.find((k) => medidaPropia?.[k] != null)
  if (!tipo) return null
  const mia = medidaPropia[tipo], miTamano = tamano(mia), texto = NOMBRE_MEDIDA[tipo](mia)
  const sirve = (m) => m != null && (Array.isArray(mia) ? Array.isArray(m) && m.length === mia.length : !Array.isArray(m))
  const xs = (publicaciones ?? []).map((p) => ({ p, m: (p.medidas ?? medidasDeTitulo(p.titulo))[tipo] }))
    .filter((x) => sirve(x.m) && finito(x.p.precioUnidad) && x.p.precioUnidad > 0).map((x) => ({ ...x, t: tamano(x.m) }))
  const conPrecio = finito(precioUnidadPropio) && precioUnidadPropio > 0
  const porValor = new Map()
  for (const x of xs) {
    const k = JSON.stringify(x.m)
    porValor.set(k, [...(porValor.get(k) ?? []), x])
  }
  const grupo = (lista) => ({ valor: lista[0].m, texto: NOMBRE_MEDIDA[tipo](lista[0].m), tamano: lista[0].t, n: lista.length,
    masBaratoUnidad: Math.min(...lista.map((x) => x.p.precioUnidad)), medianaUnidad: Math.round(mediana(lista.map((x) => x.p.precioUnidad))),
    vendidos: lista.reduce((a, x) => a + (finito(x.p.vendidos) ? x.p.vendidos : 0), 0), esLaMia: lista[0].t === miTamano })
  let grupos = [...porValor.values()].map(grupo)
  // con muchas medidas distintas quedan las que más publicaciones tienen (y siempre la propia)
  if (grupos.length > maxGrupos) grupos = [...grupos].sort((a, b) => b.esLaMia - a.esLaMia || b.n - a.n).slice(0, maxGrupos)
  if (!grupos.some((g) => g.esLaMia)) grupos.push({ valor: mia, texto, tamano: miTamano, n: 0, masBaratoUnidad: null, medianaUnidad: null, vendidos: 0, esLaMia: true })
  grupos.sort((a, b) => a.tamano - b.tamano)
  const iguales = xs.filter((x) => x.t === miTamano)
  const misma = { n: iguales.length, masBaratos: conPrecio ? iguales.filter((x) => x.p.precioUnidad < precioUnidadPropio).length : null,
    masBaratoUnidad: iguales.length ? Math.min(...iguales.map((x) => x.p.precioUnidad)) : null, medianaUnidad: iguales.length ? Math.round(mediana(iguales.map((x) => x.p.precioUnidad))) : null }
  const mas = conPrecio ? xs.filter((x) => x.t > miTamano && x.p.precioUnidad <= precioUnidadPropio) : []
  const mayor = mas.length ? mas.reduce((a, x) => (x.t > a.t ? x : a)) : null
  const masPorMenos = { n: mas.length, mayor: mayor ? NOMBRE_MEDIDA[tipo](mayor.m) : null,
    ejemplos: [...mas].sort((a, b) => (b.p.vendidos ?? 0) - (a.p.vendidos ?? 0) || b.t - a.t).slice(0, ejemplos)
      .map((x) => ({ sku: x.p.sku, titulo: x.p.titulo, imagen: x.p.imagen ?? null, url: x.p.url ?? null, precioUnidad: x.p.precioUnidad, medida: NOMBRE_MEDIDA[tipo](x.m), vendidos: x.p.vendidos ?? null })) }
  // lo contrario: quién da menos medida y cobra lo mismo o más
  const menosPorMas = conPrecio ? xs.filter((x) => x.t < miTamano && x.p.precioUnidad >= precioUnidadPropio).length : null
  const nombre = NOMBRE_TIPO[tipo]
  const partes = []
  if (!xs.length) partes.push(`Ninguna publicación de la búsqueda trae ${EN_TITULO[tipo]} en el título: no hay con qué comparar ${texto}.`)
  else {
    if (conPrecio) partes.push(mas.length
      ? `Por ${pesos(precioUnidadPropio)} o menos, ${mas.length === 1 ? '1 publicación ofrece' : `${mas.length} publicaciones ofrecen`} más ${nombre} que ${texto} (hasta ${masPorMenos.mayor}).`
      : `Por ${pesos(precioUnidadPropio)} o menos, ninguna publicación ofrece más ${nombre} que ${texto}.`)
    partes.push(!iguales.length ? `Con ${texto} no hay ninguna otra.`
      : `Con ${texto} hay ${iguales.length}${conPrecio ? ` y ${misma.masBaratos === 0 ? 'ninguna cobra menos' : misma.masBaratos === iguales.length ? (iguales.length === 1 ? 'cobra menos' : 'todas cobran menos') : `${misma.masBaratos} ${misma.masBaratos === 1 ? 'cobra' : 'cobran'} menos`}` : ''}; la mitad cobra menos de ${pesos(misma.medianaUnidad)} por unidad.`)
  }
  return { tipo, nombre, enTitulo: EN_TITULO[tipo], texto, conMedida: xs.length, misma, masPorMenos, menosPorMas, grupos, frase: partes.join(' ') }
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
  return [...(candidatos ?? [])].sort((a, b) => rango(a) - rango(b) || (b.sugerencia?.parecido ?? 0) - (a.sugerencia?.parecido ?? 0) || (a.posicion ?? 999) - (b.posicion ?? 999))
}

// Pura. Cuando ninguna publicación es el mismo producto, la referencia son las
// que más se le parecen: cuántas hay sobre `desde` puntos y qué precio por
// unidad cobran. No reemplaza la comparación con iguales: es contexto, y así se
// dice. Pedido del dueño (17-nov-2026): «si una publicación por foto se parece
// más a la de nosotros, indicarlo como lo más parecido… ninguno se asimila al
// de nosotros, por lo que mostró los primeros».
export function referenciaParecidos(precioUnidadPropio, candidatos, { desde = 70, max = 12 } = {}) {
  const xs = (candidatos ?? []).filter((c) => c.sugerencia?.relacion === 'parecido' && (c.sugerencia.parecido ?? 0) >= desde && finito(c.precioUnidad) && c.precioUnidad > 0)
    .sort((a, b) => b.sugerencia.parecido - a.sugerencia.parecido).slice(0, max)
  if (!xs.length) return null
  const precios = xs.map((c) => c.precioUnidad).sort((a, b) => a - b)
  return { n: xs.length, desde, masBaratoUnidad: precios[0], medianaUnidad: Math.round(mediana(precios)), masCaroUnidad: precios.at(-1),
    masBaratos: finito(precioUnidadPropio) ? precios.filter((p) => p < precioUnidadPropio).length : null, precios }
}

const mediana = (xs) => { const v = xs.filter(finito).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2 }
const pesos = (n) => `$${Math.round(n).toLocaleString('es-CL')}`

// Pura. Dónde queda un precio cuando `masBaratos` de los `n` que venden lo mismo
// cobran menos. «Caro» es que más de la mitad cobre menos: sale de contar, no de
// un porcentaje elegido a mano.
export const nivelDePrecio = (masBaratos, n) => (masBaratos === 0 ? 'ninguno-mas-barato' : masBaratos === n ? 'todos-mas-baratos' : masBaratos > n / 2 ? 'mitad-cara' : 'mitad-barata')
export const NIVELES_CAROS = ['mitad-cara', 'todos-mas-baratos']

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
  return { ...base, masBaratos, lugar: masBaratos + 1, de: n + 1, brechaPct, nivel: nivelDePrecio(masBaratos, n), frase }
}

// ─── A QUÉ PRECIO SE CAMBIA DE LUGAR ────────────────────────────────────────
// Pedido del dueño (18-nov-2026), para decidir descuentos: no basta saber que
// hay más baratos, hay que ver a qué precio se queda dónde y cuánto deja cada
// venta ahí. Los escalones son los precios en que la publicación propia pasa a
// otro lugar entre los que venden lo mismo: quedar en la mitad, entre los tres
// más baratos e igualar al más barato. No recomiendan ninguno: el dueño elige.

// Pura. `iguales`: [{ precioUnidad }]. Van del descuento más chico al más grande
// y cada escalón mejora el lugar del anterior: si un precio más alto ya consigue
// ese lugar, el más bajo sobra (con pocos rivales, «la mitad» y «los tres más
// baratos» son el mismo lugar). El precio se redondea hacia abajo a la decena,
// así nunca queda sobre el que se quiere alcanzar. Dos metas que piden el mismo
// precio son un solo escalón, con el nombre de la más exigente.
export function escalonesDePrecio(precioPropio, unidadesPropias, iguales) {
  const u = finito(unidadesPropias) && unidadesPropias >= 1 ? unidadesPropias : 1
  const precios = (iguales ?? []).map((x) => x.precioUnidad).filter((p) => finito(p) && p > 0).sort((a, b) => a - b)
  if (!precios.length || !finito(precioPropio) || precioPropio <= 0) return []
  const n = precios.length
  const lugarA = (precioUnidad) => precios.filter((p) => p < precioUnidad).length + 1
  const metas = [['mediana', mediana(precios)], ...(n >= 4 ? [['tres-mas-baratos', precios[2]]] : []), ['mas-barato', precios[0]]]
  const posibles = metas.map(([meta, unidad], exigencia) => {
    const precio = Math.floor((unidad * u) / 10) * 10
    const precioUnidad = Math.round(precio / u)
    return { exigencia, meta, precio, precioUnidad, lugar: lugarA(precioUnidad), de: n + 1, rebaja: precioPropio - precio, descuentoPct: Math.max(1, Math.round((1 - precio / precioPropio) * 100)) }
  }).filter((e) => e.precio > 0 && e.precio < precioPropio).sort((a, b) => b.precio - a.precio || b.exigencia - a.exigencia)
  const salida = []
  let lugar = lugarA(Math.round(precioPropio / u))
  for (const { exigencia, ...e } of posibles) {
    if (e.lugar >= lugar) continue
    salida.push(e)
    lugar = e.lugar
  }
  return salida
}

// Pura. Lo que cambia por venta al pasar del precio de hoy a un escalón.
// `hoy` y `alPrecio` vienen de quedaA(): { queda, quedaSinCosto }.
//  · `diferencia` vale con o sin costo cargado: el costo es el mismo a los dos
//    precios. Puede ser positiva: bajo el precio del envío gratis obligatorio el
//    vendedor paga menos envío, y un precio menor puede dejar más por venta.
//  · `veces`: cuántas veces lo de hoy habría que vender a ese precio para juntar
//    la misma plata. Solo con costo: sin él, lo que «queda» todavía tiene que
//    pagar el producto y la cuenta saldría más optimista de lo que es.
//  · `pierde`: a ese precio cada venta deja pérdida (también solo con costo).
export function plataDelEscalon(hoy, alPrecio, conCosto) {
  if (!alPrecio) return { queda: null, quedaSinCosto: null, diferencia: null, veces: null, pierde: null }
  const diferencia = finito(hoy?.quedaSinCosto) && finito(alPrecio.quedaSinCosto) ? alPrecio.quedaSinCosto - hoy.quedaSinCosto : null
  const pierde = conCosto && finito(alPrecio.queda) ? alPrecio.queda <= 0 : null
  const veces = conCosto && finito(hoy?.queda) && hoy.queda > 0 && finito(alPrecio.queda) && alPrecio.queda > 0 ? Math.round((hoy.queda / alPrecio.queda) * 10) / 10 : null
  return { queda: alPrecio.queda ?? null, quedaSinCosto: alPrecio.quedaSinCosto ?? null, diferencia, veces, pierde }
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
    sugerencia: marca?.sugerencia ? sugerenciaDeFicha(marca.sugerencia, medida.estado) : null }
}

// Pura. Lo que la ficha muestra de la lectura de fotos: la relación ya cruzada con
// la medida del título y con el puntaje, el puntaje y, si quedó como parecido,
// cuánto se parece en palabras.
function sugerenciaDeFicha(sugerencia, estadoMedida) {
  const parecido = puntajeParecido(sugerencia.relacion, sugerencia.parecido)
  const relacion = relacionSugerida(sugerencia.relacion, estadoMedida, parecido)
  return { relacion, parecido, enPalabras: relacion === 'parecido' ? parecidoEnPalabras(parecido) : null, motivo: sugerencia.motivo ?? null }
}

// Pura. La foto dice si es el mismo producto; el tamaño, cuando el título lo
// trae escrito, lo decide el título. Medido el 17-nov-2026 en la primera
// lectura con medida: el modelo mandó a «otra medida» un pack de 120 del mismo
// tamaño, porque leyó la cantidad del pack como una medida.
// Y «el mismo producto» exige parecerse casi del todo: en la primera lectura con
// puntaje, el modelo llamó «el mismo en otra medida» a un modelo distinto con
// otro número de cajones, con un puntaje que él mismo dejó bajo el de un igual.
export const PARECIDO_DEL_MISMO = 85
export function relacionSugerida(relacion, estadoMedida, parecido = null) {
  if (relacion !== 'igual' && relacion !== 'otra-medida') return relacion
  if (Number.isFinite(parecido) && parecido < PARECIDO_DEL_MISMO) return 'parecido'
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

// La vista de «Quién vende lo mismo» de un producto propio. `conEconomia` y
// `conHistoria` se apagan cuando solo interesa dónde queda el precio (el
// resumen de todos los productos): son las dos lecturas más pesadas. `queda`
// es la cuenta de lo que deja una venta a un precio (se cambia en los tests).
export async function vistaIguales(propio, { conEconomia = true, conHistoria = true, queda = quedaA } = {}) {
  if (!propio?.nichoId) return { estado: 'sin-nicho' }
  const nicho = await Nicho.findById(propio.nichoId).select('keyword competenciaExcluida estado').lean()
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
  if (conHistoria && (iguales.length || otraMedida.length)) {
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

  const vigentes = iguales.filter((x) => x.enUltimoScan)
  const resumen = resumenIguales(precioUnidadPropio, vigentes)
  // lo que deja cada venta hoy y en cada precio que cambia el lugar (escalonesDePrecio)
  let economia = null
  if (conEconomia && finito(precio)) {
    const conCosto = finito(propio.costoUnitarioClp)
    const escalones = escalonesDePrecio(precio, unidadesPropias, vigentes)
    const [hoy, ...quedan] = await Promise.all([queda(propio, precio), ...escalones.map((e) => queda(propio, e.precio))])
    economia = { hoy, conCosto, escalones: escalones.map((e, i) => ({ ...e, ...plataDelEscalon(hoy, quedan[i], conCosto) })) }
  }
  // qué da la búsqueda por esa plata: todo lo que salió en el último scan, con la medida de su título o, si el
  // título no la trae, la que leyó la foto
  const medidasDe = (x) => { const leida = marcas.get(x.sku)?.sugerencia?.medida; return { ...(leida ? medidasDeTitulo(leida) : {}), ...medidasDeTitulo(x.titulo) } }
  const delUltimoScan = [...iguales.filter((x) => x.enUltimoScan), ...otraMedida.filter((x) => x.enUltimoScan), ...candidatos, ...descartados]
  const porLaPlata = medidaPorLaPlata(medidaPropia, precioUnidadPropio, delUltimoScan.map((x) => ({ ...x, medidas: medidasDe(x) })))
  const revisadas = [...marcas.values()].filter((m) => m.sugerencia).length
  const sinRevisar = candidatos.filter((c) => !c.sugerencia).length
  const parecen = (relacion) => candidatos.filter((c) => c.sugerencia?.relacion === relacion).length
  const diasDelScan = vista.fechaScan ? Math.floor((Date.now() - +new Date(vista.fechaScan)) / 86400e3) : null
  return {
    estado: 'ok', keyword: nicho.keyword, fechaScan: vista.fechaScan,
    // la búsqueda de un nicho pausado no se vuelve a medir: se avisa cuán vieja es la foto que se está mirando
    scan: { dias: diasDelScan, nichoId: String(nicho._id), pausado: nicho.estado === 'pausado' },
    parecidos: iguales.length ? null : referenciaParecidos(precioUnidadPropio, candidatos),
    propio: { titulo: propio.titulo, imagen: propio.imagen ?? null, precio, unidades: unidadesPropias, unidadesDelTitulo: !(finito(propio.unidadesPack) && propio.unidadesPack >= 1), precioUnidad: precioUnidadPropio,
      medida: textoMedida(medidaPropia) },
    resumen, economia, iguales, otraMedida, candidatos, descartados, porLaPlata,
    fotos: { revisadas, sinRevisar, parecenIgual: parecen('igual'), parecenOtraMedida: parecen('otra-medida'), parecidas: parecen('parecido') },
    // ya se miraron todas las fotos y ninguna es el mismo producto: lo que queda es lo que más se le parece
    ningunaIgual: !iguales.length && !otraMedida.length && revisadas > 0 && sinRevisar === 0 && !parecen('igual') && !parecen('otra-medida'),
  }
}

// ─── EL PRECIO PROPIO CONTRA LOS QUE VENDEN LO MISMO, EN UNA LÍNEA ──────────
// Para Publicidad (18-nov-2026). Medido el día anterior en una campaña propia:
// decenas de clics pagados sin una venta, mientras el mismo producto se vendía
// en packs a la mitad por unidad. El plan de campañas mira lo que deja cada
// venta, no si el precio compite; este dato va al lado para verlo antes de
// gastar. Es un aviso, no una regla: no cambia lo que recomienda el plan.
//
// Pura. De la vista de un producto: con qué se compara (`base`) y dónde queda.
//  · 'confirmados': lo que el dueño marcó como el mismo producto en su medida;
//  · 'por-foto': nada confirmado todavía, pero la lectura de fotos propone
//    iguales. Vale como indicio y lo dice: falta que el dueño confirme;
//  · 'parecidos': por la foto nadie vende el mismo. Los precios de lo más
//    parecido son solo referencia y nunca marcan «caro».
export function posicionDeVista(v) {
  if (v?.estado !== 'ok' || !finito(v.propio?.precioUnidad) || v.propio.precioUnidad <= 0) return null
  const comun = { precio: v.propio.precio, unidades: v.propio.unidades, precioUnidad: v.propio.precioUnidad, medida: v.propio.medida ?? null,
    keyword: v.keyword ?? null, scanDias: v.scan?.dias ?? null, sinRevisar: v.fotos?.sinRevisar ?? 0 }
  // `precios`: lo que cobra por unidad cada uno de aquellos con los que se compara, de menor a mayor (para dibujarlos)
  const cifras = (r, xs) => ({ n: r.de - 1, masBaratos: r.masBaratos, lugar: r.lugar, de: r.de, masBaratoUnidad: r.masBarato.precioUnidad, medianaUnidad: r.medianaUnidad,
    brechaPct: r.brechaPct, nivel: r.nivel, caro: NIVELES_CAROS.includes(r.nivel), precios: xs.map((x) => x.precioUnidad).filter((p) => finito(p) && p > 0).sort((a, b) => a - b) })
  if (v.resumen?.nivel) return { ...comun, base: 'confirmados', ...cifras(v.resumen, (v.iguales ?? []).filter((x) => x.enUltimoScan !== false)), frase: v.resumen.frase }
  const propuestas = (v.candidatos ?? []).filter((c) => c.sugerencia?.relacion === 'igual')
  const r = resumenIguales(v.propio.precioUnidad, propuestas)
  if (r.nivel) {
    const { n } = cifras(r, propuestas)
    const cuantos = r.masBaratos === 0 ? (n === 1 ? 'no cobra' : 'ninguna cobra') : r.masBaratos === n ? (n === 1 ? 'cobra' : 'todas cobran') : `${r.masBaratos} ${r.masBaratos === 1 ? 'cobra' : 'cobran'}`
    return { ...comun, base: 'por-foto', ...cifras(r, propuestas),
      frase: `Por la foto, ${n === 1 ? '1 publicación parece' : `${n} publicaciones parecen`} tu mismo producto y ${cuantos} menos que tú por unidad.${r.masBaratos ? ` La más barata cobra ${pesos(r.masBarato.precioUnidad)}, un ${r.brechaPct}% menos.` : ''} Falta que lo confirmes.` }
  }
  const p = v.parecidos
  if (!p || v.iguales?.length || v.otraMedida?.length || !(v.fotos?.revisadas > 0) || v.fotos.parecenOtraMedida > 0) return null
  return { ...comun, base: 'parecidos', n: p.n, masBaratos: p.masBaratos, lugar: p.masBaratos + 1, de: p.n + 1, masBaratoUnidad: p.masBaratoUnidad, medianaUnidad: p.medianaUnidad,
    brechaPct: Math.round(((v.propio.precioUnidad - p.masBaratoUnidad) / v.propio.precioUnidad) * 100), nivel: nivelDePrecio(p.masBaratos, p.n), caro: false, precios: p.precios ?? [],
    frase: `Por la foto, ${v.ningunaIgual ? 'nadie vende' : 'de lo mirado hasta ahora nadie vende'} tu mismo producto. De ${p.n === 1 ? 'la publicación que más se le parece' : `las ${p.n} que más se le parecen`}, ${p.masBaratos === 0 ? 'ninguna cobra' : p.masBaratos === 1 ? '1 cobra' : `${p.masBaratos} cobran`} menos que tú por unidad; la mitad cobra menos de ${pesos(p.medianaUnidad)}.` }
}

// El precio de cada publicación propia vigente contra los que venden lo mismo.
// Solo las que tienen alguna lectura de fotos o alguna marca; los colores de
// una familia comparten las marcas y casi siempre el precio, así que su vista
// se arma una vez. Sin economía ni historia: es para mirar muchos de una vez.
export async function posicionesDePrecio() {
  const claves = new Set(await IgualPropio.distinct('clave'))
  if (!claves.size) return []
  const propios = (await ProductoPropio.find({ estado: 'activo', ...FILTRO_VIGENTES, nichoId: { $ne: null } })
    .select({ sku: 1, itemIdMl: 1, titulo: 1, imagen: 1, nichoId: 1, familiaMl: 1, promoMl: 1, unidadesPack: 1, mediciones: { $slice: -1 } }).lean())
    .filter((p) => claves.has(claveDePropio(p)))
  const vistas = new Map()
  const posicionDe = (p) => {
    const llave = `${claveDePropio(p)}|${precioDePropio(p)}|${p.unidadesPack ?? ''}`
    if (!vistas.has(llave)) vistas.set(llave, vistaIguales(p, { conEconomia: false, conHistoria: false }).then(posicionDeVista).catch(() => null))
    return vistas.get(llave)
  }
  const posiciones = await Promise.all(propios.map(posicionDe))
  return propios.map((p, i) => (posiciones[i] ? { id: String(p._id), itemId: p.itemIdMl ?? p.sku, titulo: p.titulo ?? null, imagen: p.imagen ?? null, ...posiciones[i] } : null)).filter(Boolean)
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

Tu trabajo: decir cuáles se parecen a mi producto y cuánto. Mira la foto antes que el título. Incluye TODAS las publicaciones que sean el mismo tipo de producto que el mío (sirven para lo mismo y un comprador las miraría como alternativa), aunque ninguna sea idéntica. Lo que es otro tipo de producto NO lo incluyas.

Para cada una:
- "relacion":
  - "igual": la misma forma, diseño y modelo, Y la misma medida que el mío (tamaño, largo, potencia, capacidad). No importa el color, el vendedor, la marca pegada ni cómo esté tomada la foto. Si trae varias unidades (un pack), sigue siendo "igual".
  - "otra-medida": el mismo producto, pero en otro tamaño, largo, potencia o capacidad (por ejemplo 60x60 cuando el mío es 90x60, o 30 metros cuando el mío es de 15). En un set o kit, también cuando trae otro número de piezas distintas (un set de 44 piezas no es el de 34).
  - "parecido": el mismo tipo de producto pero otro modelo u otro diseño.
  - OJO: la cantidad de unidades iguales que trae el pack NO es una medida. 100 paños de 90x60 son "igual" a 60 paños de 90x60: lo que cambia va en "unidades".
- "parecido": un número de 0 a 100 que dice cuánto se parece al mío mirando la foto: 100 es idéntico; 85 a 99, el mismo producto con diferencias mínimas; 70 a 84, muy parecido (mismo formato y tamaño, cambia algún detalle del diseño); 50 a 69, parecido (mismo tipo, diseño distinto); bajo 50, se parece poco. Sé exigente: si ninguna es idéntica, ninguna lleva más de 84.
- "unidades": cuántas unidades del producto trae (1 si es suelto, 2 si es un pack de dos, 100 si son 100 paños; guíate por la foto y por el título).
- "medida": la medida que dice el título o que se lee en la foto o en el envase, escrita corta ("60x60 cm", "30 m", "200 w", "44 piezas"); deja "" si no se ve por ningún lado.
- "motivo": muy corto, en qué se parece y en qué se diferencia del mío ("mismo formato de dos cajones, sin tapa").
Si la medida no se ve, decide por la forma. Ante la duda entre "igual" y "parecido", responde "parecido" con el puntaje que corresponda: una persona va a confirmar mirando la foto.`

const SCHEMA_FOTOS = {
  type: 'object', additionalProperties: false, required: ['coincidencias'],
  properties: {
    coincidencias: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['n', 'relacion', 'parecido', 'unidades', 'medida', 'motivo'],
        properties: { n: { type: 'integer' }, relacion: { type: 'string', enum: ['igual', 'otra-medida', 'parecido'] }, parecido: { type: 'integer' }, unidades: { type: 'integer' }, medida: { type: 'string' }, motivo: { type: 'string' } },
      },
    },
  },
}
const POR_TANDA = 60

// Pura. Cuánto se parece, de 0 a 100. Las lecturas anteriores al puntaje (o un
// modelo que no lo entrega) quedan con el valor de su relación: lo que se dijo
// igual vale más que lo que se dijo parecido.
const PARECIDO_POR_RELACION = { igual: 95, 'otra-medida': 90, parecido: 60 }
export function puntajeParecido(relacion, parecido) {
  if (Number.isFinite(parecido) && parecido >= 0 && parecido <= 100) return Math.round(parecido)
  return PARECIDO_POR_RELACION[relacion] ?? null
}
// en palabras, para la pantalla
export const NIVELES_PARECIDO = [[85, 'casi igual al tuyo'], [70, 'muy parecido al tuyo'], [50, 'algo parecido al tuyo'], [0, 'se parece poco al tuyo']]
export const parecidoEnPalabras = (n) => (Number.isFinite(n) ? NIVELES_PARECIDO.find(([desde]) => n >= desde)[1] : null)

// Pura. De la respuesta del modelo a una sugerencia por publicación de la tanda:
// lo que no viene en la respuesta se anota como 'distinto' para no volver a mirarlo.
export function sugerenciasDeTanda(tanda, coincidencias, { modelo = null, el = new Date() } = {}) {
  const porN = new Map((coincidencias ?? []).filter((c) => Number.isInteger(c?.n)).map((c) => [c.n, c]))
  return tanda.map((p, i) => {
    const c = porN.get(i + 1)
    return { sku: p.sku, sugerencia: c ? { relacion: c.relacion, parecido: puntajeParecido(c.relacion, c.parecido), unidades: c.unidades >= 1 && c.unidades <= 500 ? c.unidades : 1, medida: String(c.medida ?? '').slice(0, 40) || null, motivo: String(c.motivo ?? '').slice(0, 160), modelo, el } : { relacion: 'distinto', modelo, el } }
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
  // un producto que todavía no se compra trae su foto ya lista (la subió el dueño): no hay nada que bajar
  const mia = propio.fotoEnLinea ?? (propio.imagen ? await foto(propio.imagen) : null)
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
