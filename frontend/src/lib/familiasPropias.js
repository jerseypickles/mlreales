// TRES COLORES, UN PRODUCTO (21-oct-2026).
//
// Con los productos de usuario de ML cada color es una publicación aparte, y
// Mis productos mostraba una tarjeta por color: la manguera de 15 m y la de
// 30 m, en tres colores cada una, ocupaban seis tarjetas. El importador lo
// pidió así: "haz lo mismo, como que 3 variantes corresponden a un producto".
//
// Se agrupan por la familia de ML (la misma que arma el selector de color en
// la página): una tarjeta por producto con sus números sumados. Cada color
// sigue teniendo su stock, sus ventas y su "enviar N", porque ML los vende y
// los despacha por separado.

import { publicacionVigente } from './catalogoPropios.js'

export const PESO_URGENCIA = { quebrado: 0, critico: 1, reponer: 2, holgado: 3, sin_ventas: 4 }

// lo que se quiebra antes va primero; a igual urgencia, menos días de cobertura
export function compararUrgencia(a, b) {
  const pa = PESO_URGENCIA[a?.urgencia] ?? 5
  const pb = PESO_URGENCIA[b?.urgencia] ?? 5
  if (pa !== pb) return pa - pb
  return (a?.diasCobertura ?? 9999) - (b?.diasCobertura ?? 9999)
}

const finito = (n) => (Number.isFinite(n) ? n : null)

function suma(valores) {
  const xs = valores.filter(Number.isFinite)
  return xs.length ? xs.reduce((s, x) => s + x, 0) : null
}

function sumarCampos(objetos, campos) {
  const presentes = objetos.filter(Boolean)
  if (!presentes.length) return null
  return Object.fromEntries(campos.map((k) => [k, suma(presentes.map((o) => o[k])) ?? 0]))
}

// la primera publicada da la cara: es estable, y es la que se audita
const porAntiguedad = (a, b) =>
  new Date(a.creadoEl ?? 0) - new Date(b.creadoEl ?? 0) || String(a._id).localeCompare(String(b._id))

export const nombreVariante = (p) => p.familiaMl?.variante ?? p.titulo ?? p.sku

// Los números de la tarjeta de UNA publicación
export function metricasDe(p) {
  const ultima = (p.mediciones ?? []).at(-1) ?? null
  const precio = p.promoMl?.activa?.precio ?? ultima?.precioEfectivo ?? ultima?.precio ?? null
  return {
    precio: finito(precio),
    precioHasta: null,
    ventas7: p.ventas7d?.unidades ?? (p.ventas30d ? 0 : null),
    visitas7: finito(ultima?.visitas),
    conversion7d: p.conversion7d ?? null,
    stock: finito(ultima?.stock),
    numReviews: finito(ultima?.numReviews),
    rating: ultima?.rating ?? null,
    ventas30d: p.ventas30d ?? null,
    margen30d: p.margen30d ?? null,
    cargosMl30d: p.cargosMl30d ?? null,
    reposicion: p.reposicion ?? null,
    aEnviar: p.reposicion?.aEnviar ?? 0,
    posicionReciente: p.posicionReciente ?? null,
    pausada: p.estadoMl === 'paused',
  }
}

// Los números de la tarjeta de un PRODUCTO con varias publicaciones
export function resumenFamilia(variantes) {
  const ms = variantes.map((v) => ({ v, m: metricasDe(v) }))
  const precios = ms.map(({ m }) => m.precio).filter(Number.isFinite)
  const visitas7 = suma(ms.map(({ m }) => m.visitas7))
  const conVentas = ms.filter(({ m }) => m.ventas7 != null)
  const ventas7 = conVentas.length ? conVentas.reduce((s, { m }) => s + m.ventas7, 0) : null

  // el margen se suma solo si TODOS los colores que vendieron lo tienen: una
  // suma parcial se leería como el margen del producto
  const vendieron = ms.filter(({ m }) => m.ventas30d)
  const margen30d =
    vendieron.length && vendieron.every(({ m }) => m.margen30d)
      ? {
          ...sumarCampos(
            vendieron.map(({ m }) => m.margen30d),
            ['margenClp', 'cargosMlClp', 'comisionClp', 'envioClp', 'adsClp', 'costoClp'],
          ),
          base: [...new Set(vendieron.map(({ m }) => m.margen30d.base))].join(' + '),
        }
      : null

  // la urgencia del producto es la del color que se quiebra antes
  const conRepo = ms.filter(({ m }) => m.reposicion)
  const peor = conRepo.length ? conRepo.reduce((a, b) => (compararUrgencia(b.m.reposicion, a.m.reposicion) < 0 ? b : a)) : null
  const reposicion = peor
    ? {
        ...peor.m.reposicion,
        variante: nombreVariante(peor.v),
        // si todos están igual, el sello no nombra un color
        todas: conRepo.length === ms.length && conRepo.every(({ m }) => m.reposicion.urgencia === peor.m.reposicion.urgencia),
      }
    : null

  const posiciones = ms.map(({ m }) => m.posicionReciente).filter((x) => Number.isFinite(x?.posicion))
  return {
    precio: precios.length ? Math.min(...precios) : null,
    precioHasta: precios.length && Math.max(...precios) !== Math.min(...precios) ? Math.max(...precios) : null,
    ventas7,
    visitas7,
    conversion7d: ventas7 > 0 && visitas7 > 0 ? Math.min(100, Math.round((ventas7 / visitas7) * 1000) / 10) : null,
    stock: suma(ms.map(({ m }) => m.stock)),
    numReviews: suma(ms.map(({ m }) => m.numReviews)),
    rating: null,
    ventas30d: sumarCampos(ms.map(({ m }) => m.ventas30d), ['unidades', 'ingresosClp']),
    margen30d,
    cargosMl30d: sumarCampos(
      ms.map(({ m }) => m.cargosMl30d),
      ['comisionClp', 'envioClp', 'adsClp', 'colectaClp', 'almacenajeClp', 'otrosClp', 'totalClp', 'lineas'],
    ),
    reposicion,
    aEnviar: ms.reduce((s, { m }) => s + (m.aEnviar ?? 0), 0),
    posicionReciente: posiciones.length ? posiciones.reduce((a, b) => (b.posicion < a.posicion ? b : a)) : null,
    pausada: ms.every(({ m }) => m.pausada),
  }
}

// Una entrada por producto: { clave, p, variantes, titulo, m }. `p` es la
// publicación que da la cara (la primera publicada); `variantes` es null
// cuando el producto tiene una sola.
export function agruparPorFamilia(propios = []) {
  propios = propios.filter(publicacionVigente)
  const porFamilia = new Map()
  for (const p of propios) {
    const id = p.familiaMl?.id
    if (id) porFamilia.set(id, [...(porFamilia.get(id) ?? []), p])
  }
  const vistas = new Set()
  const entradas = []
  for (const p of propios) {
    const id = p.familiaMl?.id
    const miembros = id ? porFamilia.get(id) : null
    if (miembros?.length > 1) {
      if (vistas.has(id)) continue
      vistas.add(id)
      const variantes = [...miembros].sort(porAntiguedad)
      entradas.push({
        clave: `familia:${id}`,
        p: variantes[0],
        variantes,
        titulo: variantes[0].familiaMl.nombre ?? variantes[0].titulo ?? variantes[0].sku,
        m: resumenFamilia(variantes),
      })
    } else {
      entradas.push({ clave: String(p._id), p, variantes: null, titulo: p.titulo ?? p.sku, m: metricasDe(p) })
    }
  }
  return entradas
}

// "3 colores" cuando lo que cambia es el color; si no, "3 variantes". Con
// artículo: "los 3 colores" / "las 3 variantes"
export function etiquetaVariantes(variantes, { conArticulo = false } = {}) {
  const n = variantes.length
  const porColor = variantes.every((v) => v.familiaMl?.porColor)
  const texto = porColor ? `${n} colores` : `${n} variantes`
  return conArticulo ? `${porColor ? 'los' : 'las'} ${texto}` : texto
}

export function ordenarEntradas(entradas, orden) {
  return [...entradas].sort((a, b) => {
    if (orden === 'ventas') return (b.m.ventas7 ?? 0) - (a.m.ventas7 ?? 0)
    if (orden === 'margen') return (b.m.margen30d?.margenClp ?? -Infinity) - (a.m.margen30d?.margenClp ?? -Infinity)
    if (orden === 'alfabetico') return (a.titulo ?? '').localeCompare(b.titulo ?? '')
    return compararUrgencia(a.m.reposicion, b.m.reposicion)
  })
}
