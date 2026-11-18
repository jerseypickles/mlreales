// REVISAR UN PRODUCTO ANTES DE TRAERLO (18-nov-2026).
//
// Lectura del dueño al mirar qué se vendió y qué no de su primera importación: «fallamos por traer lo mismo que
// los demás, sobre todo en diseño y watts… otro está vendiendo [más barato] por lo mismo», y lo que aprendió:
// «vale más traer un producto diferente a la competencia que traer el mismo y competir por precio». Medido ese día
// en el scan: lo que no se movía tenía publicaciones idénticas por la foto a poco más de la mitad por unidad, y a
// su precio la búsqueda ofrecía bastante más medida.
//
// «Quién vende lo mismo» (iguales.js) ya respondía eso, pero recién DESPUÉS de publicar. Acá la misma pregunta se
// hace antes de comprar: el dueño sube la foto que le manda el proveedor, dice qué es y a cuánto piensa venderlo,
// y la lectura de fotos lo compara con el último scan del nicho. Para esa lectura el candidato es un producto
// propio más (`propioDeCandidato`): mismas marcas, misma vista, misma pantalla. Lo único distinto:
//   · lo que quedaría por venta sale de lo medido en las ventas propias (comisión y envío por tramo de precio),
//     porque un producto que todavía no existe no tiene nada que cotizar en Mercado Libre: es una aproximación;
//   · la vista trae además una lectura en palabras (`revisionDeCompra`): cuántos venden este mismo producto, a
//     cuánto y cuánto llevan vendido. Cuenta; no dice si conviene traerlo. Eso lo decide el dueño.
import mongoose from 'mongoose'
import { CandidatoCompra } from '../models/CandidatoCompra.js'
import { IgualPropio } from '../models/IgualPropio.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { Nicho } from '../models/Nicho.js'
import { vistaIguales, referenciaParecidos } from './iguales.js'

const finito = Number.isFinite
const pesos = (n) => `$${Math.round(n).toLocaleString('es-CL')}`
const miles = (n) => Math.round(n).toLocaleString('es-CL')
const mediana = (xs) => { const v = [...xs].sort((a, b) => a - b), m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2 }
const error = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status })

export const claveDeCandidato = (id) => `candidato:${id}`
const fotoDe = (c) => (c?.foto?.base64 ? `data:${c.foto.tipo ?? 'image/jpeg'};base64,${c.foto.base64}` : null)
const fichaDe = (c) => ({ id: String(c._id), descripcion: c.descripcion, precioClp: c.precioClp ?? null, unidades: c.unidades ?? 1, costoUnitarioClp: c.costoUnitarioClp ?? null, creadoEl: c.creadoEl ?? null })

// Pura. El candidato con la forma de un producto propio, que es lo que leen la vista y la lectura de fotos. Su
// clave es `candidato:<id>`; su foto va lista para el modelo (no hay nada que bajar) y como imagen para la pantalla.
export function propioDeCandidato(c) {
  if (!c) return null
  return {
    _id: c._id, esCandidato: true, sku: claveDeCandidato(c._id), nichoId: c.nichoId, titulo: c.descripcion, imagen: fotoDe(c),
    fotoEnLinea: c.foto?.base64 ? { type: 'image', source: { type: 'base64', media_type: c.foto.tipo ?? 'image/jpeg', data: c.foto.base64 } } : null,
    unidadesPack: c.unidades ?? 1, costoUnitarioClp: c.costoUnitarioClp ?? null, mediciones: finito(c.precioClp) && c.precioClp > 0 ? [{ precio: c.precioClp }] : [], creadoEl: c.creadoEl ?? null,
  }
}

// Lo que quedaría por venta a un precio (después de Mercado Libre y del costo, antes de publicidad), con la
// comisión y el envío medidos en las ventas propias. El costo del candidato es por unidad: una publicación que
// trae dos paga dos. No consulta a Mercado Libre.
export async function quedaConLoMedido(propio, precio) {
  if (!finito(precio) || precio <= 0) return null
  const { parametrosPublicidad, dejaAPrecio } = await import('./ml/publicidad.js')
  const d = dejaAPrecio((await parametrosPublicidad().catch(() => null))?.ticket, precio)
  if (!d) return null
  const costo = finito(propio?.costoUnitarioClp) ? propio.costoUnitarioClp * (propio.unidadesPack >= 1 ? propio.unidadesPack : 1) : null
  return { precio: Math.round(precio), queda: costo != null ? Math.round(d.quedaSinAds - costo) : null, quedaSinCosto: d.quedaSinAds }
}

// Pura. La lectura de la revisión, de la vista de «Quién vende lo mismo» del candidato. «Este mismo producto» son
// los que el dueño ya confirmó más los que la foto propone y todavía no revisa (lo que marca «no es» deja de contar).
export function revisionDeCompra(v) {
  if (v?.estado !== 'ok') return null
  const enScan = (x) => x.enUltimoScan !== false
  const confirmados = (v.iguales ?? []).filter(enScan)
  const propuestos = (v.candidatos ?? []).filter((c) => c.sugerencia?.relacion === 'igual')
  const mismos = [...confirmados, ...propuestos].filter((x) => finito(x.precioUnidad) && x.precioUnidad > 0)
  const otrasConfirmadas = (v.otraMedida ?? []).filter(enScan).length
  const otraMedida = otrasConfirmadas + (v.candidatos ?? []).filter((c) => c.sugerencia?.relacion === 'otra-medida').length
  const total = confirmados.length + otrasConfirmadas + (v.candidatos ?? []).length + (v.descartados ?? []).length
  const leidas = v.fotos?.revisadas ?? 0, sinMirar = v.fotos?.sinRevisar ?? 0
  const pu = v.propio?.precioUnidad, conPrecio = finito(pu) && pu > 0
  const base = { total, leidas, sinMirar, otraMedida, mismos: null, parecidos: null }
  if (!mismos.length && !otraMedida && !leidas) return { ...base, estado: 'sin-leer', frase: `Todavía no se miran las fotos de las ${total} publicaciones de la búsqueda.` }
  const falta = sinMirar > 0 ? ` ${sinMirar === 1 ? 'Falta 1 foto' : `Faltan ${sinMirar} fotos`} por mirar.` : ''
  if (mismos.length) {
    const precios = mismos.map((x) => x.precioUnidad).sort((a, b) => a - b), n = mismos.length
    const vendidos = mismos.reduce((a, x) => a + (finito(x.vendidos) ? x.vendidos : 0), 0)
    const masBaratos = conPrecio ? precios.filter((p) => p < pu).length : null
    const rango = precios[0] === precios.at(-1) ? pesos(precios[0]) : `entre ${pesos(precios[0])} y ${pesos(precios.at(-1))}`
    const frase = `De las ${total} publicaciones de la búsqueda, ${n === 1 ? '1 vende' : `${n} venden`} este mismo producto${propuestos.length ? (confirmados.length ? ', contando lo que la foto propone y falta confirmar' : ' según la foto') : ''}. `
      + `${n === 1 ? 'Cobra' : 'Cobran'} ${rango} por unidad${vendidos > 0 ? ` y ${n === 1 ? 'lleva' : 'entre todas llevan'} al menos ${miles(vendidos)} vendidos` : ''}.`
      + (conPrecio ? ` Al precio que piensas (${pesos(pu)} por unidad), ${masBaratos === 0 ? (n === 1 ? 'no cobra menos' : 'ninguna cobra menos') : masBaratos === n ? (n === 1 ? 'cobra menos' : 'todas cobran menos') : `${masBaratos} ${masBaratos === 1 ? 'cobra' : 'cobran'} menos`}.` : '')
      + falta
    return { ...base, estado: 'lo-venden', frase,
      mismos: { n, confirmados: confirmados.length, sinConfirmar: propuestos.length, masBaratoUnidad: precios[0], medianaUnidad: Math.round(mediana(precios)), masCaroUnidad: precios.at(-1), vendidos, masBaratos, precios } }
  }
  if (otraMedida) return { ...base, estado: 'otra-medida', frase: `En la medida que escribiste nadie vende este mismo producto, pero ${otraMedida === 1 ? '1 publicación lo vende' : `${otraMedida} publicaciones lo venden`} en otra medida.${falta}` }
  const p = referenciaParecidos(pu, v.candidatos)
  if (p) return { ...base, estado: 'parecidos', parecidos: p,
    frase: `Por la foto, nadie vende este mismo producto en la búsqueda. ${p.n === 1 ? `La publicación que más se le parece cobra ${pesos(p.masBaratoUnidad)}` : `Las ${p.n} que más se le parecen cobran entre ${pesos(p.masBaratoUnidad)} y ${pesos(p.masCaroUnidad)}`} por unidad.${falta}` }
  return { ...base, estado: 'nada-parecido', frase: `Por la foto, nada de lo que sale en la búsqueda se parece de cerca a este producto: o es nuevo acá, o no es de esta búsqueda.${falta}` }
}

// ─── GUARDAR, CAMBIAR Y BORRAR ──────────────────────────────────────────────
const FOTO = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
const MAX_FOTO = 1_200_000 // caracteres en base64 (unos 900 KB): la pantalla la achica antes de subirla
function leerFoto(foto) {
  const m = FOTO.exec(String(foto ?? ''))
  if (!m) throw error('Falta la foto del producto (una imagen JPG, PNG o WebP).')
  if (m[2].length > MAX_FOTO) throw error('La foto pesa demasiado: súbela más chica.', 413)
  return { tipo: m[1], base64: m[2] }
}
function leerTexto(x) {
  const t = String(x ?? '').replace(/\s+/g, ' ').trim()
  if (t.length < 3 || t.length > 140) throw error('Escribe qué producto es, en pocas palabras (entre 3 y 140 letras).')
  return t
}
function leerNumero(x, nombre, { min, max, vacio = null }) {
  if (x == null || x === '') return vacio
  const n = Number(x)
  if (!finito(n) || n < min || n > max) throw error(`${nombre} tiene que ser un número entre ${min} y ${max}.`)
  return Math.round(n)
}
const LIMITES = { precioClp: ['El precio', { min: 1, max: 50_000_000 }], unidades: ['Las unidades', { min: 1, max: 500, vacio: 1 }], costoUnitarioClp: ['El costo', { min: 0, max: 50_000_000 }] }

export async function crearCandidato({ nichoId, descripcion, foto, precioClp = null, unidades = 1, costoUnitarioClp = null } = {}) {
  if (!mongoose.isValidObjectId(nichoId) || !(await Nicho.exists({ _id: nichoId }))) throw error('nicho no encontrado', 404)
  const c = await CandidatoCompra.create({ nichoId, descripcion: leerTexto(descripcion), foto: leerFoto(foto),
    precioClp: leerNumero(precioClp, ...LIMITES.precioClp), unidades: leerNumero(unidades, ...LIMITES.unidades), costoUnitarioClp: leerNumero(costoUnitarioClp, ...LIMITES.costoUnitarioClp) })
  return c.toObject()
}

// Cambia qué es, el precio pensado, las unidades o el costo. La foto no se cambia: lo que la lectura dijo de
// cada publicación es contra esa foto; para otra foto se revisa otro producto.
export async function cambiarCandidato(id, cambios = {}) {
  if (!mongoose.isValidObjectId(id)) throw error('producto por revisar no encontrado', 404)
  const set = {}
  if ('descripcion' in cambios) set.descripcion = leerTexto(cambios.descripcion)
  for (const k of Object.keys(LIMITES)) if (k in cambios) set[k] = leerNumero(cambios[k], ...LIMITES[k])
  const c = await CandidatoCompra.findByIdAndUpdate(id, { $set: set }, { new: true }).lean()
  if (!c) throw error('producto por revisar no encontrado', 404)
  return c
}

export async function borrarCandidato(id) {
  const c = mongoose.isValidObjectId(id) ? await CandidatoCompra.findByIdAndDelete(id).lean() : null
  if (!c) throw error('producto por revisar no encontrado', 404)
  await IgualPropio.deleteMany({ clave: claveDeCandidato(c._id) })
}

// ─── LO QUE USAN LAS RUTAS ──────────────────────────────────────────────────
// El producto de un id: una publicación propia o, si no, un candidato con forma de propio.
export async function propioDe(id) {
  if (!mongoose.isValidObjectId(id)) return null
  return (await ProductoPropio.findById(id).lean()) ?? propioDeCandidato(await CandidatoCompra.findById(id).lean())
}

// La vista de «Quién vende lo mismo»: la de siempre para una publicación propia; para un candidato, con lo que
// quedaría según lo medido (marcado como aproximado) y la lectura de la revisión.
export async function vistaDe(propio) {
  if (!propio?.esCandidato) return vistaIguales(propio)
  const v = await vistaIguales(propio, { queda: quedaConLoMedido })
  const candidato = fichaDe({ _id: propio._id, descripcion: propio.titulo, precioClp: propio.mediciones[0]?.precio ?? null, unidades: propio.unidadesPack, costoUnitarioClp: propio.costoUnitarioClp, creadoEl: propio.creadoEl })
  if (v.estado !== 'ok') return { ...v, candidato }
  return { ...v, economia: v.economia ? { ...v.economia, aproximada: true } : null, candidato, revision: revisionDeCompra(v) }
}

// Las unidades que trae la publicación propia o las que traería la del candidato.
export async function fijarUnidades(propio, unidades) {
  if (propio?.esCandidato) return cambiarCandidato(propio._id, { unidades })
  const { fijarUnidadesPropias } = await import('./iguales.js')
  return fijarUnidadesPropias(propio, unidades)
}

// Los candidatos de un nicho, del más nuevo al más antiguo, cada uno con su foto y la lectura de su revisión.
export async function candidatosDeNicho(nichoId) {
  if (!mongoose.isValidObjectId(nichoId)) throw error('nicho no válido')
  const lista = await CandidatoCompra.find({ nichoId }).sort({ creadoEl: -1 }).lean()
  return Promise.all(lista.map(async (c) => {
    const v = await vistaIguales(propioDeCandidato(c), { conEconomia: false, conHistoria: false }).catch(() => null)
    return { ...fichaDe(c), foto: fotoDe(c), revision: revisionDeCompra(v) }
  }))
}
export const candidatoParaLista = (c) => ({ ...fichaDe(c), foto: fotoDe(c), revision: null })
