import { Aprendizaje } from '../models/Aprendizaje.js'
import { Producto } from '../models/Producto.js'
import { meliGet, hayCuentaMeli } from './meli.js'

// Registra que un nicho VENDE con evidencia propia y lo ancla a su categoría
// de ML. Idempotente: si ya existe, actualiza la evidencia (las ventas cambian,
// el hecho no).
export async function registrarNichoQueVende({ nicho, ventasDia, sharePct, conversion, precio }) {
  // categoría real: la dominante entre los productos medidos del nicho
  const rutas = await Producto.aggregate([
    { $match: { keywordOrigen: nicho.keyword, categoriaML: { $ne: null } } },
    { $group: { _id: { id: '$categoriaML', ruta: '$categoriaRuta' }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ])
  const categoriaMl = rutas[0]?._id?.id ?? null
  const categoriaRuta = rutas[0]?._id?.ruta ?? null

  let categoriaPadre = null
  if (categoriaMl && (await hayCuentaMeli())) {
    try {
      const cat = await meliGet(`/categories/${categoriaMl}`)
      const camino = cat?.path_from_root ?? []
      categoriaPadre = camino.length >= 2 ? camino[camino.length - 2].id : null
    } catch {
      /* sin categoría padre igual sirve el aprendizaje */
    }
  }

  const leccion =
    `"${nicho.keyword}" VENDE con evidencia propia: ${ventasDia} u/día` +
    (sharePct != null ? ` (${sharePct}% del nicho)` : '') +
    (conversion != null ? `, conversión ${conversion}%` : '') +
    (precio ? `, a $${precio}` : '') +
    (categoriaRuta ? ` — categoría: ${categoriaRuta}` : '')

  await Aprendizaje.findOneAndUpdate(
    { tipo: 'nicho-vende', keyword: nicho.keyword },
    {
      $set: {
        nichoId: nicho._id,
        categoriaMl,
        categoriaRuta,
        categoriaPadre,
        evidencia: { ventasDia, sharePct, conversion, precio, medidoEl: new Date() },
        leccion,
        actualizadoEl: new Date(),
      },
      $setOnInsert: { primeraVezEl: new Date() },
    },
    { upsert: true },
  )
  return { categoriaMl, categoriaRuta, categoriaPadre }
}

// Categorías HERMANAS de las que ya venden: el árbol de ML sabe qué se parece
// a lo que te funciona mejor que cualquier lluvia de ideas. Devuelve nombres
// para que el sugeridor los convierta en keywords reales.
export async function hermanasDeLoQueVende({ max = 12 } = {}) {
  const probados = await Aprendizaje.find({ tipo: 'nicho-vende', categoriaPadre: { $ne: null } }).lean()
  if (!probados.length || !(await hayCuentaMeli())) return []
  const vistas = new Set(probados.map((p) => p.categoriaMl))
  const hermanas = []
  for (const p of probados) {
    try {
      const padre = await meliGet(`/categories/${p.categoriaPadre}`)
      for (const hija of padre?.children_categories ?? []) {
        if (vistas.has(hija.id) || hermanas.some((h) => h.id === hija.id)) continue
        hermanas.push({ id: hija.id, nombre: hija.name, hermanaDe: p.keyword, rama: padre.name })
        if (hermanas.length >= max) return hermanas
      }
    } catch {
      /* si ML no responde, seguimos con las demás */
    }
  }
  return hermanas
}

export async function leccionesAprendidas() {
  const todos = await Aprendizaje.find().sort({ actualizadoEl: -1 }).limit(20).lean()
  return todos.map((a) => a.leccion)
}

// CÓMO SE DICE EN CHILE.
//
// El mismo producto se llama distinto acá, y el radar lo descubría una y otra
// vez sin quedárselo. Casos medidos: "gafas de sol" 3.600 contra "lentes de
// sol" 27.100; "rizador de pelo" 1.900 contra "ondulador de pelo" 9.900;
// "climatizador evaporativo" 70 contra "enfriador evaporativo" 320; y
// "scooter", que en Chile es la MOTO y no el juguete de niño.
//
// Cada hallazgo se guarda como lección y vuelve al prompt del sugeridor, así
// el radar deja de proponer la palabra que nadie escribe.
export async function registrarTerminoChileno({ propuesto, real, volumenPropuesto, volumenReal }) {
  if (!propuesto || !real || propuesto === real) return null
  if (!Number.isFinite(volumenReal) || volumenReal <= 0) return null
  // solo vale la pena recordar la diferencia cuando es grande de verdad
  const factor = volumenPropuesto > 0 ? volumenReal / volumenPropuesto : Infinity
  if (factor < 3) return null

  const veces = Number.isFinite(factor) ? `${Math.round(factor)}× más` : 'y la otra no registra búsquedas'
  const leccion = `En Chile se busca "${real}" (${volumenReal.toLocaleString('es-CL')}/mes), no "${propuesto}" (${
    volumenPropuesto > 0 ? `${volumenPropuesto.toLocaleString('es-CL')}/mes` : 'sin búsquedas'
  }) — ${veces}. Usa la primera al proponer keywords.`

  return Aprendizaje.findOneAndUpdate(
    { tipo: 'termino-chileno', keyword: propuesto },
    {
      $set: {
        leccion,
        evidencia: { propuesto, real, volumenPropuesto, volumenReal, factor: Math.round(factor * 10) / 10 },
        actualizadoEl: new Date(),
      },
      $setOnInsert: { primeraVezEl: new Date() },
    },
    { upsert: true, new: true },
  ).catch(() => null)
}

// LO QUE SE APRENDE VENDIENDO: la conversión y su respuesta al precio.
//
// El sistema juzgaba nichos con búsquedas de Google, competencia y economía —
// todo medido DESDE AFUERA. Lo único que no se puede estimar desde afuera es
// cuánta gente que mira termina comprando, y eso el importador lo sabe de sus
// propias publicaciones desde el 13-ago. Esa evidencia no volvía a ninguna
// decisión: se mostraba en pantalla y ahí moría.
//
// Acá se convierte en lecciones que el analista y el sugeridor leen antes de
// dictar un veredicto o proponer un nicho nuevo.
//
// OJO CON LA LECTURA DEL EXPERIMENTO DE PRECIO: los tramos no son limpios. El
// presupuesto de publicidad subió en las mismas fechas en que subieron los
// precios, así que "subí el precio y la conversión subió" es más probablemente
// "entró más tráfico pagado y mejor apuntado". Por eso la lección dice que el
// precio NO hundió la conversión —que es lo que sí se puede afirmar— y no que
// subirlo la mejore.
export async function registrarConversionPropios() {
  const { conversionDeLosPropios } = await import('./conversionPropios.js')
  const filas = await conversionDeLosPropios()
  const guardados = []

  const conConv = filas.filter((f) => f.conversion?.conversionPct != null && f.conversion.visitas >= 20)
  if (conConv.length >= 3) {
    const pcts = conConv.map((f) => f.conversion.conversionPct).sort((a, b) => a - b)
    const mediana = pcts[Math.floor(pcts.length / 2)]
    const mejor = conConv.reduce((a, b) => (b.conversion.conversionPct > a.conversion.conversionPct ? b : a))
    const leccion =
      `Conversión MEDIDA en mis publicaciones: mediana ${mediana}% de visitas que compran ` +
      `(${conConv.length} productos, ventana 7 días). La mejor es "${String(mejor.titulo).slice(0, 40)}" ` +
      `con ${mejor.conversion.conversionPct}%. Úsala como referencia real al estimar cuánto vende un nicho, ` +
      `en vez de suponer una tasa.`
    await Aprendizaje.findOneAndUpdate(
      { tipo: 'formato-gana', keyword: '__conversion-propios__' },
      { $set: { leccion, evidencia: { mediana, n: conConv.length, ventanaDias: 7 }, actualizadoEl: new Date() } },
      { upsert: true, new: true },
    )
    guardados.push('conversion-mediana')
  }

  // el experimento de precio, solo si hay tramos comparables de verdad
  const conCurva = filas.filter((f) => f.curvaLegible)
  const subidas = []
  for (const f of conCurva) {
    const t = f.curva.filter((x) => x.conversionPct != null && x.dias >= 2)
    for (let i = 1; i < t.length; i++) {
      if (t[i].precio > t[i - 1].precio) {
        subidas.push({
          titulo: f.titulo,
          de: t[i - 1].precio,
          a: t[i].precio,
          convAntes: t[i - 1].conversionPct,
          convDespues: t[i].conversionPct,
        })
      }
    }
  }
  if (subidas.length >= 3) {
    const noBajaron = subidas.filter((s) => s.convDespues >= s.convAntes).length
    const leccion =
      `Subidas de precio medidas en mis publicaciones: ${subidas.length} casos, y en ${noBajaron} ` +
      `la conversión NO bajó (ej: ${subidas[0].titulo.slice(0, 28)} de $${subidas[0].de} a $${subidas[0].a}, ` +
      `${subidas[0].convAntes}% → ${subidas[0].convDespues}%). En mi rango de precio la demanda no es ` +
      `sensible al precio: no degrades un nicho por ticket alto. Advertencia: la publicidad subió en las ` +
      `mismas fechas, así que esto prueba que el precio no hunde la conversión, no que subirlo la mejore.`
    await Aprendizaje.findOneAndUpdate(
      { tipo: 'formato-gana', keyword: '__precio-vs-conversion__' },
      { $set: { leccion, evidencia: { casos: subidas.length, noBajaron, detalle: subidas.slice(0, 6) }, actualizadoEl: new Date() } },
      { upsert: true, new: true },
    )
    guardados.push('precio-vs-conversion')
  }

  // SIN COSTO NO HAY RENTABILIDAD, y conviene que el prompt lo diga en vez de
  // dejar que el analista hable de margen como si lo supiera
  const sinCosto = filas.filter((f) => !Number.isFinite(f.costoUnitarioClp)).length
  if (sinCosto) {
    await Aprendizaje.findOneAndUpdate(
      { tipo: 'formato-gana', keyword: '__falta-costo__' },
      {
        $set: {
          leccion:
            `${sinCosto} de ${filas.length} publicaciones propias no tienen costo unitario cargado, así que ` +
            `NO se conoce la ganancia real de ninguna. Todo lo que digas sobre margen es contribución ` +
            `(precio − comisión − envío), un TECHO: el resultado real es peor. Dilo explícitamente.`,
          evidencia: { sinCosto, total: filas.length },
          actualizadoEl: new Date(),
        },
      },
      { upsert: true, new: true },
    )
    guardados.push('falta-costo')
  }

  return { guardados, productos: filas.length }
}
