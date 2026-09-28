import { pedirJSON } from './llm.js'
import { equivalenciaChilena } from './tallasChile.js'
import { obtenerProductosUltimoScan } from './metricas.js'
import { sugerenciasReales } from './busquedasReales.js'
import { Reporte } from '../models/Reporte.js'
import { Producto } from '../models/Producto.js'
import { Nicho } from '../models/Nicho.js'

const SCHEMA_LISTING = {
  type: 'object',
  additionalProperties: false,
  required: [
    'titulos',
    'categoriaSugerida',
    'precioVentaClp',
    'razonPrecio',
    'tipoPublicacion',
    'atributos',
    'bullets',
    'descripcion',
    'keywordsSecundarias',
    'fotos',
    'checklist',
  ],
  properties: {
    titulos: {
      type: 'array',
      description: 'EXACTAMENTE 3 opciones de título, cada una de MÁXIMO 60 caracteres (cuenta cada letra)',
      items: { type: 'string' },
    },
    categoriaSugerida: { type: 'string', description: 'Ruta de categoría ML, ej: Hogar > Climatización > Ventiladores' },
    precioVentaClp: { type: 'integer', description: 'Precio de publicación sugerido: el objetivo del importador si lo hay; si no, coherente con el análisis y con lo que deja (economiaPorPrecio)' },
    razonPrecio: { type: 'string', description: 'Una frase: por qué ese precio, citando qué deja con publicidad y contra qué precios compite' },
    tipoPublicacion: {
      type: 'object',
      additionalProperties: false,
      required: ['tipo', 'razon'],
      properties: {
        tipo: { type: 'string', enum: ['clasica', 'premium'] },
        razon: { type: 'string', description: 'Por qué, en 1 frase (comisión vs cuotas sin interés)' },
      },
    },
    atributos: {
      type: 'array',
      description: 'Ficha técnica que ML pide al publicar en esta categoría (8-14 atributos)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nombre', 'valor'],
        properties: { nombre: { type: 'string' }, valor: { type: 'string' } },
      },
    },
    bullets: {
      type: 'array',
      description: '4 a 6 características destacadas para el inicio de la descripción, 1 línea cada una',
      items: { type: 'string' },
    },
    descripcion: {
      type: 'string',
      description: 'Descripción completa en TEXTO PLANO (ML no renderiza HTML ni markdown), con secciones separadas por líneas en blanco',
    },
    keywordsSecundarias: {
      type: 'array',
      description: 'Búsquedas reales que no cupieron en el título y deben aparecer en la descripción',
      items: { type: 'string' },
    },
    fotos: {
      type: 'array',
      description: 'Plan de 5 a 8 fotos: qué mostrar en cada una, en orden',
      items: { type: 'string' },
    },
    checklist: {
      type: 'array',
      description: 'Pasos antes de publicar (Full, stock, garantía, variantes, etc.)',
      items: { type: 'string' },
    },
  },
}

const SYSTEM_LISTERO = `Eres un experto en publicar y posicionar listings en Mercado Libre Chile. Armas borradores listos para copiar y pegar.

REGLAS DEL TÍTULO (las más importantes):
- MÁXIMO 60 caracteres por título — cuenta cada letra y espacio; si te pasas, ML lo corta y pierde keywords.
- Las primeras 2-3 palabras deben ser EXACTAMENTE lo que la gente escribe en el buscador (te paso las búsquedas reales del autocompletado de ML, ordenadas por volumen).
- Estructura: [búsqueda principal] + [atributos que definen la compra: potencia, tamaño, pack, material] — mira el vocabulario de los títulos ganadores que te paso, esas palabras venden.
- PROHIBIDO en el título: signos de exclamación, comillas, MAYÚSCULAS COMPLETAS, "oferta", "descuento", "envío gratis", "garantía", precio o stock.
- Las 3 opciones deben atacar ángulos distintos (ej: genérica de volumen / específica de atributo / específica de uso).

DESCRIPCIÓN:
- Texto plano puro: sin HTML, sin markdown, sin emojis. Secciones separadas por línea en blanco: gancho de 2 líneas → QUÉ INCLUYE → ESPECIFICACIONES (lista con guiones) → USOS → DESPACHO Y GARANTÍA.
- Teje las keywords secundarias de forma natural (el buscador de ML también lee la descripción).
- Te paso PREGUNTAS REALES de compradores del nicho: la descripción debe responder las más repetidas de frente (qué incluye, compatibilidad, medidas, potencia) — cada pregunta respondida antes de que la hagan es una venta que no se cae.

TALLAS (si viene guiaTallasChile): la tabla del proveedor ya viene convertida a talla chilena por centímetros. Las variantes se publican con la LETRA CHILENA (letraCl), jamás con la del proveedor, que suele venir una talla más chica y llena la cuenta de devoluciones. La descripción lleva una sección GUÍA DE TALLAS: por cada talla, letra chilena, número y busto/cintura/cadera en cm, y una línea "si estás entre dos tallas, elige la mayor". Si faltanEnChile trae tallas, agrégalo al checklist: pedirle al proveedor esas tallas antes de cerrar. Si fueraDeDemanda trae tallas, el checklist dice que no conviene pedirlas.

FICHA TÉCNICA: los atributos que ML exige al publicar en la categoría (Marca, Modelo, y los específicos). Si el producto es genérico importado, Marca = "Genérica" y Modelo inventado corto.

PRECIO: te paso "precios" con todo lo que se sabe. Manda el objetivoDelImportador si viene (es su decisión; si cae en un valle de envío, dilo en la razón y propón el precio justo bajo el salto). Si no viene, parte de recomendadoPorElAnalisis y contrástalo con deLosQueVendenAhora (lo que el comprador de verdad paga) y con economiaPorPrecio: prefiere un precio que deje 40% o más con publicidad, nunca uno dentro de un valle de envío (desde $19.990 el envío gratis obligatorio sube lo que paga el vendedor: $19.980 deja más que $21.990). Si hay costoPuestoClp, lo que queda menos el costo es la ganancia por venta: dila en la razón. Terminaciones chilenas: 990.

TIPO DE PUBLICACIÓN: clásica (menos comisión) vs premium (+3-4 pts de comisión, cuotas sin interés — conviene en tickets altos donde las cuotas destraban la compra).

Todo en español de Chile. El comprador objetivo compra por el buscador de ML: cada palabra del título es una puerta de entrada.`

// Arma el borrador de listing del nicho con lo que el sistema ya sabe:
// títulos que rankean, búsquedas reales, categoría ML y la recomendación del análisis.
export async function generarListing(nicho) {
  const vista = await obtenerProductosUltimoScan(nicho)
  if (!vista) throw Object.assign(new Error('el nicho no tiene snapshots; corre un scan primero'), { status: 409 })

  const reporte = await Reporte.findOne({ nichoId: nicho._id }).sort({ fecha: -1 }).lean()
  // el análisis vive en el reporte donde corrió, que casi nunca es el del
  // último scan: leer solo el último dejaba el listing sin recomendación ni
  // veredicto (28-sep-2026)
  const conAnalisis = reporte?.analisis ? reporte : await Reporte.findOne({ nichoId: nicho._id, analisis: { $ne: null } }).sort({ fecha: -1 }).lean()
  const analisis = conAnalisis?.analisis ?? null

  const ganadores = [...vista.productos]
    .filter((p) => p.titulo)
    .sort((a, b) => (b.numReviews ?? 0) - (a.numReviews ?? 0))
    .slice(0, 20)
    .map((p) => ({ titulo: p.titulo, precio: p.precio, reviews: p.numReviews ?? null, full: p.esFull || undefined }))

  // categoría ML real dominante entre los productos del nicho
  const skus = vista.productos.map((p) => p.sku)
  const conCategoria = await Producto.find({ sku: { $in: skus }, categoriaML: { $ne: null } })
    .select('categoriaML')
    .lean()
  const conteo = new Map()
  for (const p of conCategoria) conteo.set(p.categoriaML, (conteo.get(p.categoriaML) ?? 0) + 1)
  const categoriasML = [...conteo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c)

  // búsquedas reales: mejor esfuerzo — un 403 del autocompletado no bota el listing
  let busquedasReales = []
  try {
    busquedasReales = await sugerenciasReales(nicho.keyword)
  } catch {
    busquedasReales = []
  }

  // preguntas reales de compradores del nicho: objeciones que la descripción debe responder
  const preguntasCompradores = [
    ...new Set(vista.productos.flatMap((p) => (p.preguntas ?? []).map((q) => q?.texto)).filter(Boolean)),
  ].slice(0, 15)

  // PRECIOS: los del nicho, los de quienes venden de verdad, el objetivo y el
  // costo del importador, y lo que queda a cada precio según lo aprendido con
  // las ventas propias (comisión y publicidad son % del precio, el envío es
  // fijo y salta en $19.990)
  const precioM = reporte?.metricas?.precio ?? {}
  const queVenden = [...vista.productos]
    .filter((p) => Number.isFinite(p.precio) && (p.resenasNuevasDia > 0 || p.ventaStock?.unidades > 0))
    .sort((a, b) => (b.resenasNuevasDia ?? 0) - (a.resenasNuevasDia ?? 0))
    .slice(0, 10)
    .map((p) => p.precio)
    .sort((a, b) => a - b)
  const precioAnalisis = analisis?.recomendacion?.precioVentaClp ?? null
  const precioObjetivo = Number.isFinite(nicho.precioVentaObjetivoClp) ? nicho.precioVentaObjetivoClp : null
  let economiaPorPrecio
  try {
    const { parametrosPublicidad, dejaAPrecio } = await import('./ml/publicidad.js')
    const t = (await parametrosPublicidad())?.ticket
    if (t) {
      const candidatos = [...new Set([precioObjetivo, precioAnalisis, precioM.p25, precioM.mediana, precioM.p75].filter((x) => Number.isFinite(x) && x > 0).map(Math.round))]
      economiaPorPrecio = {
        nota: 'Lo que queda para pagar el producto y ganar, CON publicidad, medido con las ventas propias',
        aPrecio: candidatos.map((p) => dejaAPrecio(t, p)).filter(Boolean).map(({ precio, quedaConAds, pctConAds, quedaSinAds, enValle }) => ({ precio, quedaConAds, pctConAds, quedaSinAds, enValleDeEnvio: enValle || undefined })),
        vallesDeEnvio: (t.valles ?? []).map((v) => ({ desde: v.desde, hasta: Number.isFinite(v.hasta) ? v.hasta : null })),
      }
    }
  } catch {
    // sin lo aprendido el listing sale igual
  }
  const precios = {
    delNicho: { p25: precioM.p25 ?? null, mediana: precioM.mediana ?? null, p75: precioM.p75 ?? null, bandaDominante: precioM.bandaDominante ?? null, pctConDescuento: precioM.pctConDescuento ?? null },
    deLosQueVendenAhora: queVenden.length ? { min: queVenden[0], mediana: queVenden[Math.floor(queVenden.length / 2)], max: queVenden.at(-1), n: queVenden.length } : null,
    recomendadoPorElAnalisis: precioAnalisis,
    objetivoDelImportador: precioObjetivo,
    costoPuestoClp: Number.isFinite(nicho.costoPuestoClp) ? nicho.costoPuestoClp : null,
    economiaPorPrecio,
  }

  const entrada = {
    keyword: nicho.keyword,
    precios,
    busquedasReales,
    preguntasRealesDeCompradores: preguntasCompradores,
    categoriasMLObservadas: categoriasML,
    recomendacionDelAnalisis: analisis?.recomendacion ?? null,
    veredicto: analisis?.veredicto ?? null,
    titulosGanadores: ganadores,
    // ropa: la tabla del proveedor YA convertida a talla chilena por cm
    guiaTallasChile: nicho.tablaTallasProveedor?.length ? equivalenciaChilena(nicho.tablaTallasProveedor) : undefined,
  }

  const { datos, costoUsd } = await pedirJSON({
    system: SYSTEM_LISTERO,
    user: `Arma el borrador de listing para este nicho de mercadolibre.cl:\n\n${JSON.stringify(entrada)}`,
    schema: SCHEMA_LISTING,
    maxTokens: 12_000,
  })

  const listing = { ...datos, keyword: nicho.keyword, generadoEl: new Date() }
  await Nicho.updateOne({ _id: nicho._id }, { $set: { listingDraft: listing } })

  const { registrarGasto } = await import('./gastos.js')
  await registrarGasto(nicho._id, costoUsd, 'ia')

  return listing
}
