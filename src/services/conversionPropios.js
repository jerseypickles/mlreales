import { ProductoPropio } from '../models/ProductoPropio.js'

// LO QUE SE APRENDE VENDIENDO, que es la única evidencia que no se estima.
//
// El sistema mide visitas y ventas de cada publicación propia desde el 13-ago,
// una cada 45 minutos. Con eso se puede contestar lo que ningún scraper puede:
// cuánta gente que MIRA termina comprando, y qué le pasa a ese número cuando se
// mueve el precio.
//
// EL ERROR QUE HAY QUE EVITAR ACÁ, porque ya se cometió: `visitas` NO es
// acumulativa. Sale de /items/{id}/visits/time_window?last=7, o sea son las
// visitas de los ÚLTIMOS 7 DÍAS. `vendidos`, en cambio, es el acumulado
// histórico del item. Dividir uno por otro mezcla una ventana de 7 días con
// toda la vida de la publicación y da un número sin significado — daba 13,3%
// donde lo real era 7,7%, y una correlación precio↔conversión de −0,38 donde lo
// real es 0,02. Las dos ventanas tienen que ser la misma.
export const VENTANA_VISITAS_DIAS = 7

// Serie de mediciones utilizable: con vendidos y ordenada en el tiempo.
function serie(propio) {
  return (propio.mediciones ?? [])
    .filter((m) => Number.isFinite(m.vendidos))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
}

// Conversión del producto en la ventana de visitas: ventas DE ESOS MISMOS DÍAS
// sobre las visitas del período. Devuelve null cuando la serie no cubre la
// ventana completa — un producto con 2 días de historia no puede compararse
// contra la ventana de 7 de ML.
export function conversionDe(propio, { dias = VENTANA_VISITAS_DIAS, hoy = Date.now() } = {}) {
  const m = serie(propio)
  if (m.length < 2) return null
  const ultima = m.at(-1)
  const visitas = ultima.visitas
  if (!Number.isFinite(visitas) || visitas <= 0) return null

  const corte = hoy - dias * 86400e3
  const base = m.find((x) => new Date(x.fecha).getTime() >= corte)
  if (!base) return null
  const diasReales = (new Date(ultima.fecha) - new Date(base.fecha)) / 86400e3
  // sin al menos medio período de historia la tasa es ruido
  if (diasReales < dias * 0.5) return null

  const ventas = Math.max(0, (ultima.vendidos ?? 0) - (base.vendidos ?? 0))
  return {
    ventas,
    visitas,
    diasReales: Math.round(diasReales * 10) / 10,
    conversionPct: Math.round((ventas / visitas) * 10000) / 100,
    precio: ultima.precio ?? null,
  }
}

// LA CURVA PRECIO → CONVERSIÓN, cosechada de los cambios de precio que el
// importador ya hizo. Cada vez que sube un precio deja un experimento natural:
// el mismo producto, el mismo listado, las mismas fotos, con un precio distinto.
// Nadie los estaba recogiendo.
//
// Se corta la serie por precio y en cada tramo se cuentan las ventas y se
// estima el tráfico. OJO con el tráfico: como `visitas` es una ventana móvil de
// 7 días, no se puede diferenciar entre dos puntos — se usa el promedio de las
// lecturas del tramo dividido por la ventana, que da visitas/día.
export function curvaPrecio(propio, { minDias = 1 } = {}) {
  const m = serie(propio)
  if (m.length < 2) return []

  const tramos = []
  let actual = null
  for (const x of m) {
    if (!Number.isFinite(x.precio)) continue
    if (!actual || actual.precio !== x.precio) {
      if (actual) tramos.push(actual)
      actual = { precio: x.precio, desde: x.fecha, hasta: x.fecha, vendidosIni: x.vendidos, vendidosFin: x.vendidos, visitas: [] }
    }
    actual.hasta = x.fecha
    actual.vendidosFin = x.vendidos
    if (Number.isFinite(x.visitas)) actual.visitas.push(x.visitas)
  }
  if (actual) tramos.push(actual)

  return tramos
    .map((t) => {
      const dias = (new Date(t.hasta) - new Date(t.desde)) / 86400e3
      const ventas = Math.max(0, (t.vendidosFin ?? 0) - (t.vendidosIni ?? 0))
      const visitasMedias = t.visitas.length
        ? t.visitas.reduce((a, b) => a + b, 0) / t.visitas.length
        : null
      const visitasDia = Number.isFinite(visitasMedias) ? visitasMedias / VENTANA_VISITAS_DIAS : null
      return {
        precio: t.precio,
        desde: t.desde,
        hasta: t.hasta,
        dias: Math.round(dias * 10) / 10,
        ventas,
        ventasDia: dias > 0 ? Math.round((ventas / dias) * 100) / 100 : null,
        visitasDia: Number.isFinite(visitasDia) ? Math.round(visitasDia * 10) / 10 : null,
        conversionPct:
          Number.isFinite(visitasDia) && visitasDia > 0 && dias > 0
            ? Math.round(((ventas / dias) / visitasDia) * 10000) / 100
            : null,
      }
    })
    // un tramo de horas no dice nada: el cambio de precio recién aplicado
    // todavía no acumuló ni tráfico ni ventas
    .filter((t) => t.dias >= minDias)
}

// Todo junto, para la mesa y para los aprendizajes.
export async function conversionDeLosPropios({ dias = VENTANA_VISITAS_DIAS } = {}) {
  const propios = await ProductoPropio.find({ estado: { $ne: 'eliminado' } }).lean()
  const filas = []
  for (const p of propios) {
    const conv = conversionDe(p, { dias })
    const curva = curvaPrecio(p)
    filas.push({
      itemId: p.itemIdMl ?? p.sku,
      titulo: p.titulo,
      nichoId: p.nichoId ?? null,
      categoriaMl: p.categoriaMl ?? null,
      costoUnitarioClp: p.costoUnitarioClp ?? null,
      conversion: conv,
      curva,
      // el experimento sirve solo si hay dos tramos con datos que comparar
      curvaLegible: curva.filter((t) => t.conversionPct != null).length >= 2,
    })
  }
  return filas
}
