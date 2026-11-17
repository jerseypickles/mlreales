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

const ORDEN_SUGERENCIA = { igual: 0, parecido: 1 }
// Pura. Lo que falta revisar: primero lo que la lectura de fotos cree que es
// el mismo, después lo parecido, y lo demás por posición en la búsqueda.
export function ordenarCandidatos(candidatos) {
  const rango = (c) => ORDEN_SUGERENCIA[c.sugerencia?.relacion] ?? (c.sugerencia?.relacion === 'distinto' ? 3 : 2)
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

const ficha = (p, marca, precioUnidadPropio) => {
  const unidades = marca?.relacion ? marca.unidades ?? 1 : marca?.sugerencia?.unidades ?? unidadesDeTitulo(p.titulo)
  const precioUnidad = finito(p.precio) && p.precio > 0 ? Math.round(p.precio / unidades) : null
  return { sku: p.sku, titulo: p.titulo, precio: p.precio ?? null, imagen: p.imagen ?? null, url: p.url ?? null, posicion: p.posicion ?? null,
    vendidos: p.vendidos ?? null, numReviews: p.numReviews ?? null, esFull: p.esFull ?? null, esTiendaOficial: p.esTiendaOficial ?? null, vendedor: p.vendedor ?? null,
    unidades, precioUnidad, diferenciaPct: finito(precioUnidad) && finito(precioUnidadPropio) && precioUnidadPropio > 0 ? Math.round(((precioUnidad - precioUnidadPropio) / precioUnidadPropio) * 100) : null,
    sugerencia: marca?.sugerencia ? { relacion: marca.sugerencia.relacion, motivo: marca.sugerencia.motivo ?? null } : null }
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

  // los confirmados que ya no salen en el último scan se muestran con su último dato conocido
  const fuera = [...marcas.values()].filter((m) => m.relacion === 'igual' && !enScan.has(m.sku)).map((m) => m.sku)
  const ultimos = new Map()
  if (fuera.length) {
    const prods = new Map((await Producto.find({ sku: { $in: fuera } }).lean()).map((p) => [p.sku, p]))
    const snaps = await Snapshot.aggregate([{ $match: { sku: { $in: fuera } } }, { $sort: { fecha: -1 } }, { $group: { _id: '$sku', s: { $first: '$$ROOT' } } }])
    for (const { _id, s } of snaps) if (prods.has(_id)) ultimos.set(_id, { ...prods.get(_id), precio: s.precio, vendidos: s.vendidos, numReviews: s.numReviews, posicion: null, vistoEl: s.fecha })
  }
  const iguales = [...marcas.values()].filter((m) => m.relacion === 'igual')
    .map((m) => { const p = enScan.get(m.sku) ?? ultimos.get(m.sku); return p ? { ...ficha(p, m, precioUnidadPropio), enUltimoScan: enScan.has(m.sku), vistoEl: p.vistoEl ?? null } : null })
    .filter(Boolean).sort((a, b) => (a.precioUnidad ?? Infinity) - (b.precioUnidad ?? Infinity))
  const candidatos = ordenarCandidatos(delScan.filter((p) => !marcas.get(p.sku)?.relacion).map((p) => ficha(p, marcas.get(p.sku), precioUnidadPropio)))
  const descartados = delScan.filter((p) => marcas.get(p.sku)?.relacion === 'distinto').map((p) => ficha(p, marcas.get(p.sku), precioUnidadPropio))

  // la historia de precio de cada confirmado, de los snapshots de sus scans
  if (iguales.length) {
    const desde = new Date(Date.now() - 120 * 86400e3)
    const hist = await Snapshot.find({ sku: { $in: iguales.map((x) => x.sku) }, fecha: { $gte: desde }, precio: { $gt: 0 } }).select('sku fecha precio').sort({ fecha: 1 }).lean()
    const porSku = new Map()
    for (const h of hist) {
      const dia = h.fecha.toISOString().slice(0, 10), serie = porSku.get(h.sku) ?? porSku.set(h.sku, []).get(h.sku)
      if (serie.at(-1)?.dia === dia) serie[serie.length - 1] = { dia, precio: h.precio }
      else serie.push({ dia, precio: h.precio })
    }
    for (const x of iguales) x.historia = (porSku.get(x.sku) ?? []).slice(-20)
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
    propio: { titulo: propio.titulo, imagen: propio.imagen ?? null, precio, unidades: unidadesPropias, unidadesDelTitulo: !(finito(propio.unidadesPack) && propio.unidadesPack >= 1), precioUnidad: precioUnidadPropio },
    resumen, economia, iguales, candidatos, descartados,
    fotos: { revisadas, sinRevisar: candidatos.filter((c) => !c.sugerencia).length },
  }
}

// Lo que dijo el dueño de una publicación: 'igual', 'distinto' o null (quitar
// la marca). Vale para todos los colores de la familia, porque la clave es de
// la familia. `unidades`: cuántas trae esa publicación.
export async function marcarIgual(propio, { sku, relacion = null, unidades = null } = {}) {
  if (!/^MLC[A-Z]?\d+$/i.test(String(sku ?? ''))) { const e = new Error('sku de la publicación no válido'); e.status = 400; throw e }
  if (![null, 'igual', 'distinto'].includes(relacion)) { const e = new Error("relacion debe ser 'igual', 'distinto' o null"); e.status = 400; throw e }
  const cambios = { relacion, marcadoEl: relacion ? new Date() : null }
  if (finito(unidades) && unidades >= 1 && unidades <= 500) cambios.unidades = Math.round(unidades)
  // sin el dato, lo que diga el título de esa publicación (un «Pack X2» parte en 2)
  else if (relacion === 'igual') cambios.unidades = unidadesDeTitulo((await Producto.findOne({ sku }).select('titulo').lean())?.titulo)
  await IgualPropio.updateOne({ clave: claveDePropio(propio), sku }, { $set: cambios }, { upsert: true })
}

// Cuántas unidades trae la publicación PROPIA (un pack de 2 son 2): se guarda
// en todas las publicaciones de la familia.
export async function fijarUnidadesPropias(propio, unidades) {
  if (!finito(unidades) || unidades < 1 || unidades > 500) { const e = new Error('unidades debe ser un número entre 1 y 500'); e.status = 400; throw e }
  const filtro = propio.familiaMl?.id ? { 'familiaMl.id': propio.familiaMl.id } : { _id: propio._id }
  await ProductoPropio.updateMany(filtro, { $set: { unidadesPack: Math.round(unidades) } })
}

// ─── LA LECTURA DE FOTOS ────────────────────────────────────────────────────
const SYSTEM_FOTOS = `Eres un comprador experto de Mercado Libre Chile. Te muestro la foto de MI PRODUCTO y después fotos numeradas de otras publicaciones de la misma búsqueda, cada una con su título y precio.

Tu trabajo: decir cuáles venden EL MISMO PRODUCTO FÍSICO que el mío. Mira la foto antes que el título.
- "igual": la misma forma, diseño y modelo. No importa el color, el vendedor, la marca pegada ni cómo esté tomada la foto. Si la publicación trae varias unidades del mismo producto (un pack), sigue siendo "igual".
- "parecido": el mismo tipo de producto pero otro modelo, otro tamaño u otro diseño.
- Lo demás (otro producto) NO lo incluyas en la respuesta.

Para cada publicación que incluyas indica cuántas unidades del producto trae ("unidades": 1 si es suelto, 2 si es un pack de dos, etc.; guíate por la foto y por el título) y un motivo muy corto de por qué es igual o en qué se diferencia.
Ante la duda entre "igual" y "parecido", responde "parecido": una persona va a confirmar mirando la foto.`

const SCHEMA_FOTOS = {
  type: 'object', additionalProperties: false, required: ['coincidencias'],
  properties: {
    coincidencias: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['n', 'relacion', 'unidades', 'motivo'],
        properties: { n: { type: 'integer' }, relacion: { type: 'string', enum: ['igual', 'parecido'] }, unidades: { type: 'integer' }, motivo: { type: 'string' } },
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
    return { sku: p.sku, sugerencia: c ? { relacion: c.relacion, unidades: c.unidades >= 1 && c.unidades <= 500 ? c.unidades : 1, motivo: String(c.motivo ?? '').slice(0, 160), modelo, el } : { relacion: 'distinto', modelo, el } }
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
    const bloques = [{ type: 'text', text: `MI PRODUCTO: "${propio.titulo}"` }, mia, { type: 'text', text: `PUBLICACIONES DE LA BÚSQUEDA "${v.keyword}" (${tanda.length}):` }]
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
