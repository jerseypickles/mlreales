import { config } from '../config/env.js'
import { Nicho } from '../models/Nicho.js'
import { Reporte } from '../models/Reporte.js'
import { TendenciaBusqueda } from '../models/TendenciaBusqueda.js'
import { pedirJSON } from './llm.js'
import { obtenerProductosUltimoScan } from './metricas.js'
import { sugerenciasReales, palabrasClave } from './busquedasReales.js'
import { ejecutarActorAsync, construirInputDetalle } from './apify.js'
import { indexarDetallesPorSku } from './normalizadorDetalle.js'
import { itemOficialSeguro, descripcionOficialSegura } from './meli.js'
import { registrarGasto } from './gastos.js'

// Auditoría de listing: compara MI publicación contra los ganadores del nicho
// cableado (los que más han vendido — reseñas acumuladas — y el que más vende
// ahora) en las 3 dimensiones donde se gana o pierde la venta: título,
// descripción y fotos. Las fotos van como imágenes reales a la llamada LLM.

const MAX_FOTOS_PROPIAS = 4
const MAX_FOTOS_POR_RIVAL = 2
const MAX_CHARS_DESCRIPCION_RIVAL = 2500
const MAX_CHARS_DESCRIPCION_PROPIA = 4000

// Elige los rivales a auditar: top por reseñas acumuladas (ganadores
// históricos) + el que más vende AHORA (ventas/día) si no quedó ya adentro.
export function elegirGanadores(productos, { excluirSkus = [], max = 4 } = {}) {
  const excluidos = new Set(excluirSkus.filter(Boolean))
  const candidatos = (productos ?? []).filter(
    (p) => p.url && p.titulo && !excluidos.has(p.sku) && (p.numReviews ?? 0) > 0,
  )
  const porReviews = [...candidatos].sort((a, b) => (b.numReviews ?? 0) - (a.numReviews ?? 0))
  const elegidos = porReviews.slice(0, max - 1)
  const rapido = [...candidatos].sort((a, b) => (b.ventasDia ?? 0) - (a.ventasDia ?? 0))[0]
  if (rapido && (rapido.ventasDia ?? 0) > 0 && !elegidos.some((p) => p.sku === rapido.sku)) {
    elegidos.push(rapido)
  } else if (porReviews.length >= max) {
    elegidos.push(porReviews[max - 1])
  }
  return elegidos
}

const recortar = (texto, max) =>
  typeof texto === 'string' && texto.length > max ? `${texto.slice(0, max)}…` : texto ?? null

// ¿El título ARRANCA con alguna búsqueda real? Por raíces y sin stopwords:
// "Escopeta Juguete…" valida contra "escopetas juguete"; "Lanzador De Dardos…"
// NO valida si nadie busca esa frase. El LLM promete obedecer la lista y a
// veces compone igual una frase que "suena" a keyword — esto lo pilla en código.
export function arranqueValido(titulo, busquedas) {
  const primeras = palabrasClave(String(titulo ?? '').split(/\s+/).slice(0, 4).join(' '))
  return (busquedas ?? []).some((b) => {
    const claves = [...palabrasClave(b)]
    return claves.length > 0 && claves.every((c) => primeras.has(c))
  })
}

const SCHEMA_AUDITORIA = {
  type: 'object',
  additionalProperties: false,
  required: ['veredicto', 'titulo', 'descripcion', 'fotos', 'otrasBrechas', 'quickWins'],
  properties: {
    veredicto: {
      type: 'string',
      description: '2-3 frases: dónde se está perdiendo la venta frente a los ganadores, en directo',
    },
    titulo: {
      type: 'object',
      additionalProperties: false,
      required: ['diagnostico', 'fallas', 'propuestas'],
      properties: {
        diagnostico: { type: 'string', description: 'Mi título vs los títulos ganadores, 2-3 frases' },
        fallas: { type: 'array', items: { type: 'string' }, description: 'Fallas concretas, cada una en 1 línea' },
        propuestas: {
          type: 'array',
          description: 'EXACTAMENTE 3 títulos nuevos de MÁXIMO 60 caracteres (cuenta cada letra)',
          items: { type: 'string' },
        },
      },
    },
    descripcion: {
      type: 'object',
      additionalProperties: false,
      required: ['diagnostico', 'fallas', 'propuesta'],
      properties: {
        diagnostico: { type: 'string' },
        fallas: { type: 'array', items: { type: 'string' } },
        propuesta: {
          type: 'string',
          description:
            'Descripción nueva completa en TEXTO PLANO lista para pegar (sin HTML ni markdown), secciones separadas por línea en blanco',
        },
      },
    },
    fotos: {
      type: 'object',
      additionalProperties: false,
      required: ['diagnostico', 'fallas', 'plan'],
      properties: {
        diagnostico: { type: 'string', description: 'Mis fotos vs las de los ganadores (si van adjuntas, por lo VISTO)' },
        fallas: { type: 'array', items: { type: 'string' } },
        plan: { type: 'array', description: 'Plan de 5-8 fotos en orden: qué mostrar en cada una', items: { type: 'string' } },
      },
    },
    otrasBrechas: {
      type: 'array',
      description: 'Brechas fuera de título/descripción/fotos: precio vs mediana, rating, Full, cuotas, ficha técnica',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['aspecto', 'detalle'],
        properties: { aspecto: { type: 'string' }, detalle: { type: 'string' } },
      },
    },
    quickWins: {
      type: 'array',
      description: '3-5 acciones ordenadas por impacto, empezando por la que más ventas destraba',
      items: { type: 'string' },
    },
  },
}

const SYSTEM_AUDITOR = `Eres auditor de listings de Mercado Libre Chile. Te paso MI publicación y las de los GANADORES del nicho (los que más han vendido — tienen las reseñas — y el que más vende ahora). Tu trabajo NO es dar consejos genéricos: es señalar dónde fallo YO comparado con lo que los ganadores hacen y yo no.

TÍTULO:
- Te paso BÚSQUEDAS REALES del autocompletado de ML, agrupadas por semilla y ORDENADAS POR VOLUMEN dentro de cada grupo. Esa lista es la única fuente de verdad sobre qué escribe la gente. Si dudas entre dos formas (ej "pistola de dardos" vs "pistola juguete"), gana la que el autocompletado registre y pese más — NUNCA la que suene mejor.
- LO QUE MÁS IMPORTA ES CONTENER las frases de búsqueda, no el orden (medido en listados reales de mercadolibre.cl: entre los 10 primeros resultados, el 80% CONTIENE la keyword del nicho y casi ninguno la tiene al inicio). Cabe más de una búsqueda en 60 caracteres: apílalas todas mientras sean verdad.
- El orden sí importa para el COMPRADOR: en la grilla el título se corta, así que las primeras palabras deben decir QUÉ ES el producto con la frase de búsqueda más específica que calce (no "Set", no la marca, no el color).
- Te paso además pesoDeCadaKeyword: "alto" = la frase aparece tecleando solo su primera palabra (mucho volumen), "medio" = necesita más letras, "nulo" = ML no la sugiere (NADIE la escribe así, prohibido usarla). APILA en cada título las de peso ALTO que describan el producto con verdad: cada una es una puerta de entrada distinta y caben varias en 60 caracteres. OJO: en frases de UNA sola palabra el peso "alto" es poco informativo (casi cualquier palabra encabeza su propio prefijo) — úsalas solo si nombran el producto o su función, jamás para color, marca ajena ni relleno.
- NUNCA pongas el color en el título: ML lo agrega automáticamente al final (por eso existen los "Blanco Blanco"). Cada carácter gastado en el color es una keyword menos.
- Compara palabra por palabra: ¿qué keywords tienen los títulos ganadores que el mío no?
- Propuestas: MÁXIMO 60 caracteres cada una (cuenta cada letra; si te pasas, ML corta). Prohibido: exclamaciones, MAYÚSCULAS COMPLETAS, "oferta", "envío gratis", precio.
- Usa SOLO atributos que mi producto realmente tiene (según mi ficha y mi descripción). Jamás inventes especificaciones.

DESCRIPCIÓN:
- ML también indexa la descripción y LAS PRIMERAS PALABRAS PESAN MÁS: la primera línea debe arrancar con la búsqueda principal y tejer 2-3 búsquedas secundarias reales en las primeras 2 líneas, de forma natural (sin listas de keywords).
- Compara estructura y contenido: ¿los ganadores responden preguntas que la mía deja abiertas? Te paso PREGUNTAS REALES de compradores del nicho: cada una sin responder es una venta que se cae.
- La propuesta va en texto plano puro (ML no renderiza HTML/markdown), secciones separadas por línea en blanco: gancho de 2 líneas → QUÉ INCLUYE → ESPECIFICACIONES (guiones) → USOS → DESPACHO Y GARANTÍA. Teje las búsquedas reales que no cupieron en el título.
- Mantén los datos VERDADEROS de mi descripción actual; mejora estructura, keywords y objeciones respondidas.

FOTOS:
- Si van imágenes adjuntas, evalúa lo que VES: primera foto (¿producto claro, fondo limpio, se entiende en miniatura de 100px?), variedad (uso/lifestyle, medidas, contenido del pack, detalle), texto sobreimpreso, calidad. Señala qué muestran las fotos ganadoras que las mías no.
- Si no hay imágenes adjuntas, evalúa por cantidad y por lo que el plan debería cubrir.

OTRAS BRECHAS: precio vs mediana del nicho, rating, Full/envío, cuotas, ficha técnica incompleta — solo las que muevan la aguja.

Sé directo y específico (nada de "podrías considerar"). Todo en español de Chile.`

// Datos propios: API oficial primero (gratis y exacta para lo propio); lo que
// falte lo completa el detalle del actor si la publicación entró en el batch.
async function datosPropios(propio) {
  const idMl = propio.itemIdMl ?? propio.sku
  const oficial = await itemOficialSeguro(idMl)
  const descripcion = await descripcionOficialSegura(idMl)
  const fotos = (oficial?.pictures ?? [])
    .map((p) => p?.secure_url ?? p?.url)
    .filter((u) => typeof u === 'string')
  const atributos = (oficial?.attributes ?? [])
    .map((a) => ({ nombre: a?.name ?? a?.id ?? null, valor: a?.value_name ?? null }))
    .filter((a) => a.nombre && a.valor)
  return {
    titulo: oficial?.title ?? propio.titulo ?? null,
    precio: Number.isFinite(oficial?.price) ? oficial.price : null,
    descripcion,
    fotos,
    atributos,
  }
}

export async function auditarPropio(propio) {
  const nicho = await Nicho.findById(propio.nichoId)
  if (!nicho) {
    throw Object.assign(new Error('el producto no tiene un nicho cableado (o el nicho fue eliminado)'), { status: 409 })
  }
  const vista = await obtenerProductosUltimoScan(nicho)
  if (!vista) {
    throw Object.assign(new Error(`el nicho "${nicho.keyword}" no tiene snapshots; corre un scan primero`), { status: 409 })
  }

  const ganadores = elegirGanadores(vista.productos, { excluirSkus: [propio.sku, propio.itemIdMl] })
  if (!ganadores.length) {
    throw Object.assign(
      new Error(`el nicho "${nicho.keyword}" no tiene rivales con reseñas medidas todavía (falta el nivel 2)`),
      { status: 409 },
    )
  }

  // mi posición orgánica en ESTE listado, si el scan me vio
  const yo = vista.productos.find((p) => p.sku === propio.sku || p.sku === propio.itemIdMl) ?? null

  const propioOficial = await datosPropios(propio)

  // actor de detalle: descripción + galería de los rivales; mi publicación
  // entra al batch solo si la API oficial no la cubrió (sin cuenta, o /up/)
  const objetivos = ganadores.map((g) => ({ sku: g.sku, url: g.url }))
  const faltaPropio = !propioOficial.titulo || !propioOficial.descripcion || !propioOficial.fotos.length
  if (faltaPropio && propio.url) objetivos.push({ sku: propio.sku, url: propio.url })

  let costoActorUsd = 0
  let porSku = new Map()
  try {
    const r = await ejecutarActorAsync(
      config.actorDetails,
      construirInputDetalle(config.actorDetails, objetivos.map((o) => o.url), { domainCode: nicho.domainCode }),
      { pollMs: 10_000, timeoutMs: 10 * 60_000, conMeta: true },
    )
    costoActorUsd = r.costoUsd
    await registrarGasto(nicho._id, costoActorUsd)
    porSku = indexarDetallesPorSku(r.items, objetivos).porSku
  } catch (err) {
    // sin detalle igual hay auditoría (títulos/precios/reviews del scan),
    // solo que sin descripciones ni galerías de los rivales
    console.error(`[auditor] detalle de rivales falló: ${err.message} — se audita con lo del scan`)
  }

  const detPropio = porSku.get(propio.sku) ?? null
  const ultima = propio.mediciones?.[propio.mediciones.length - 1] ?? null
  const mio = {
    titulo: propioOficial.titulo ?? detPropio?.titulo ?? propio.titulo ?? null,
    precio: ultima?.precio ?? propioOficial.precio ?? detPropio?.precio ?? null,
    numReviews: ultima?.numReviews ?? detPropio?.numReviews ?? null,
    rating: ultima?.rating ?? detPropio?.rating ?? null,
    visitas7d: ultima?.visitas ?? null,
    posicionEnElListado: yo?.posicion ?? null,
    descripcion: recortar(propioOficial.descripcion ?? detPropio?.descripcion, MAX_CHARS_DESCRIPCION_PROPIA),
    atributos: propioOficial.atributos.length ? propioOficial.atributos : (detPropio?.atributos ?? []),
    fotos: propioOficial.fotos.length
      ? propioOficial.fotos
      : (detPropio?.imagenes?.length ? detPropio.imagenes : [propio.imagen].filter(Boolean)),
  }

  const rivales = ganadores.map((g) => {
    const det = porSku.get(g.sku) ?? null
    return {
      sku: g.sku,
      titulo: det?.titulo ?? g.titulo,
      url: g.url,
      imagen: g.imagen ?? det?.imagenes?.[0] ?? null,
      precio: det?.precio ?? g.precio ?? null,
      numReviews: det?.numReviews ?? g.numReviews ?? null,
      rating: det?.rating ?? g.rating ?? null,
      ventasDia: g.ventasDia ?? null,
      posicion: g.posicion ?? null,
      esFull: g.esFull || undefined,
      esTiendaOficial: g.esTiendaOficial || undefined,
      descripcion: recortar(det?.descripcion, MAX_CHARS_DESCRIPCION_RIVAL),
      atributos: (det?.atributos ?? []).slice(0, 14),
      fotos: det?.imagenes ?? [],
    }
  })

  // búsquedas reales multi-semilla: la keyword del nicho + el vocabulario de
  // los ganadores (primeras 2 palabras de sus títulos). El autocompletado
  // ordena por volumen real: es la fuente de verdad para el arranque del
  // título, no lo que "suene" a keyword. Mejor esfuerzo: un 403 no bota nada.
  const semillas = [nicho.keyword]
  // el autocompletado responde por PREFIJO: "pistola de juguete" no devuelve
  // la familia "pistola juguete" — la semilla sin stopwords sí la encuentra
  const sinStopwords = nicho.keyword
    .replace(/\b(de|del|la|el|los|las|un|una|para|con|y|o)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (sinStopwords && sinStopwords !== nicho.keyword) semillas.push(sinStopwords)
  for (const g of ganadores.slice(0, 3)) {
    const primeras = String(g.titulo ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join(' ')
    if (primeras.length >= 4) semillas.push(primeras)
  }
  const busquedasReales = {}
  for (const semilla of [...new Set(semillas)].slice(0, 5)) {
    let sugerencias = []
    try {
      sugerencias = await sugerenciasReales(semilla)
    } catch {
      // el WAF de ML tumba ráfagas: un reintento tras pausa recupera la mayoría
      await new Promise((r) => setTimeout(r, 3000))
      try {
        sugerencias = await sugerenciasReales(semilla)
      } catch {
        sugerencias = []
      }
    }
    if (!sugerencias.length) {
      // respaldo: la serie diaria del autocompletado ya capturada (tendencias).
      // Un dato de ayer vale infinitamente más que ninguno — sin lista, el
      // candado de volumen no valida y salen títulos con keywords muertas.
      const guardada = await TendenciaBusqueda.findOne({ prefijo: semilla }).sort({ dia: -1 }).lean()
      if (guardada?.sugerencias?.length) {
        sugerencias = guardada.sugerencias
        console.log(`[auditor] "${semilla}": autocompletado caído, usando la captura del ${guardada.dia}`)
      }
    }
    if (sugerencias.length) {
      busquedasReales[semilla] = sugerencias
      // alimentar la serie: cada semilla consultada queda disponible como
      // respaldo la próxima vez que el WAF nos deje afuera
      const { diaChile } = await import('./tendencias.js')
      const dia = diaChile()
      await TendenciaBusqueda.updateOne(
        { prefijo: semilla, dia },
        { $set: { fecha: new Date(), sugerencias } },
        { upsert: true },
      ).catch(() => {})
    }
  }
  const preguntasCompradores = [
    ...new Set(vista.productos.flatMap((p) => (p.preguntas ?? []).map((q) => q?.texto)).filter(Boolean)),
  ].slice(0, 15)
  const reporte = await Reporte.findOne({ nichoId: nicho._id }).sort({ fecha: -1 }).lean()

  // peso medido de las frases candidatas: el LLM ya no elige "la que suene",
  // elige la de peso alto (aparece con el prefijo de su primera palabra)
  let pesos = []
  try {
    const { medirPesos } = await import('./pesoKeyword.js')
    // candidatas = nicho + búsquedas del autocompletado + los sustantivos del
    // producto (míos y de los ganadores). Sin esto último se pierden keywords
    // gordas que no derivan de la keyword del nicho: caso pistola, donde
    // "dardos", "diana" y "tiro blanco" son #1 de su prefijo y no se medían.
    // fuera colores (ML los agrega solo al título: medirlos invita a gastar
    // caracteres en ellos) y palabras de marca/modelo de los rivales
    const STOP = new Set([
      'de','del','la','el','los','las','un','una','para','con','y','o','en','por','set','kit','pack','juego','color','niños','ninos',
      'negro','negra','blanco','blanca','rojo','roja','azul','verde','amarillo','amarilla','rosa','lila','violeta','morado','naranja','gris','dorado','plateado','celeste','beige','claro','oscuro',
      'hasbro','nerf','series','elite','commander','agility','pro','max','plus','original','premium',
    ])
    const sustantivos = [mio.titulo, ...rivales.slice(0, 3).map((r) => r.titulo)]
      .filter(Boolean)
      .flatMap((t) =>
        String(t)
          .toLowerCase()
          .replace(/[^\p{L}\p{N} ]/gu, ' ')
          .split(/\s+/)
          .filter((p) => p.length >= 4 && !STOP.has(p)),
      )
    const candidatas = [
      nicho.keyword,
      sinStopwords,
      ...Object.values(busquedasReales).flat().slice(0, 6),
      ...sustantivos,
    ].filter(Boolean)
    pesos = await medirPesos(candidatas)
  } catch (err) {
    console.warn(`[auditor] medición de peso no disponible: ${err.message}`)
  }

  const entrada = {
    nicho: nicho.keyword,
    busquedasRealesPorVolumen: busquedasReales,
    pesoDeCadaKeyword: pesos,
    preguntasRealesDeCompradores: preguntasCompradores,
    medianaPrecioNicho: reporte?.metricas?.precio?.mediana ?? null,
    miPublicacion: { ...mio, fotos: undefined, numFotos: mio.fotos.length },
    ganadoresDelNicho: rivales.map((r) => ({ ...r, url: undefined, imagen: undefined, fotos: undefined, numFotos: r.fotos.length })),
  }

  // las fotos van como imágenes reales, etiquetadas e intercaladas
  const bloques = [
    {
      type: 'text',
      text: `Audita mi publicación contra los ganadores de este nicho de mercadolibre.cl:\n\n${JSON.stringify(entrada)}`,
    },
  ]
  const esHttp = (u) => typeof u === 'string' && u.startsWith('http')
  const fotosMias = mio.fotos.filter(esHttp).slice(0, MAX_FOTOS_PROPIAS)
  if (fotosMias.length) {
    bloques.push({ type: 'text', text: `FOTOS DE MI PUBLICACIÓN (${fotosMias.length} de ${mio.fotos.length}):` })
    for (const url of fotosMias) bloques.push({ type: 'image', source: { type: 'url', url } })
  }
  for (const r of rivales) {
    const fotos = r.fotos.filter(esHttp).slice(0, MAX_FOTOS_POR_RIVAL)
    if (!fotos.length) continue
    bloques.push({ type: 'text', text: `FOTOS DEL GANADOR "${recortar(r.titulo, 70)}" (${fotos.length} de ${r.fotos.length}):` })
    for (const url of fotos) bloques.push({ type: 'image', source: { type: 'url', url } })
  }
  const fotosAnalizadas = bloques.some((b) => b.type === 'image')

  let llm
  try {
    llm = await pedirJSON({
      system: SYSTEM_AUDITOR,
      user: bloques,
      schema: SCHEMA_AUDITORIA,
      maxTokens: 12_000,
      modelo: config.llmModelAnalista,
    })
  } catch (err) {
    if (!fotosAnalizadas) throw err
    // una URL de imagen rechazada por la API no debe botar la auditoría:
    // reintento solo texto (el diagnóstico de fotos queda por cantidad)
    console.warn(`[auditor] llamada con imágenes falló (${err.message}): reintentando solo texto`)
    llm = await pedirJSON({
      system: SYSTEM_AUDITOR,
      user: bloques.filter((b) => b.type === 'text').slice(0, 1),
      schema: SCHEMA_AUDITORIA,
      maxTokens: 12_000,
      modelo: config.llmModelAnalista,
    })
  }
  await registrarGasto(nicho._id, llm.costoUsd)

  // validación mecánica del arranque: si alguna propuesta parte con una frase
  // que NADIE busca, se rehace UNA vez con la lista en la cara (el prompt solo
  // no basta — caso "lanzador de dardos", 27-jul)
  const todasLasBusquedas = Object.values(busquedasReales).flat()
  let arranquesSinVolumen = []
  if (todasLasBusquedas.length) {
    const invalidas = (llm.datos.titulo?.propuestas ?? []).filter((t) => !arranqueValido(t, todasLasBusquedas))
    if (invalidas.length) {
      console.warn(`[auditor] ${propio.sku}: ${invalidas.length} título(s) con arranque sin volumen — rehaciendo`)
      try {
        const correccion = await pedirJSON({
          system: SYSTEM_AUDITOR,
          user: [
            bloques[0],
            {
              type: 'text',
              text:
                `Tu respuesta anterior fue:\n${JSON.stringify(llm.datos)}\n\n` +
                `PROBLEMA: estos títulos ARRANCAN con frases que NADIE busca según el autocompletado: ${JSON.stringify(invalidas)}. ` +
                `Entrega la MISMA auditoría pero con las 3 propuestas de título rehechas: cada una debe EMPEZAR con una de estas búsquedas reales TAL CUAL (elige la de mayor volumen que calce con el producto): ${JSON.stringify(todasLasBusquedas.slice(0, 25))}`,
            },
          ],
          schema: SCHEMA_AUDITORIA,
          maxTokens: 12_000,
          modelo: config.llmModelAnalista,
        })
        await registrarGasto(nicho._id, correccion.costoUsd)
        llm.costoUsd += correccion.costoUsd
        llm.datos = correccion.datos
      } catch (err) {
        console.warn(`[auditor] corrección de arranques falló: ${err.message} — se conserva la primera pasada`)
      }
    }
    // lo que siga inválido queda marcado: el panel puede avisarlo y el log lo dice
    arranquesSinVolumen = (llm.datos.titulo?.propuestas ?? []).filter((t) => !arranqueValido(t, todasLasBusquedas))
    if (arranquesSinVolumen.length) {
      console.warn(`[auditor] ${propio.sku}: arranques aún sin volumen tras corrección: ${JSON.stringify(arranquesSinVolumen)}`)
    }
  }

  const auditoria = {
    estado: 'ok',
    generadoEl: new Date(),
    keyword: nicho.keyword,
    nichoId: String(nicho._id),
    fotosAnalizadas,
    busquedasReales,
    pesos,
    arranquesSinVolumen: arranquesSinVolumen.length ? arranquesSinVolumen : undefined,
    // primeras fotos guardadas: el panel las muestra frente a frente
    miPublicacion: { ...mio, fotos: mio.fotos.slice(0, 4), numFotos: mio.fotos.length },
    // atributos de rivales se conservan: el revisor de ficha los usa de contexto
    competidores: rivales.map((r) => ({ ...r, descripcion: undefined, fotos: r.fotos.slice(0, 2), numFotos: r.fotos.length })),
    resultado: llm.datos,
    modelo: llm.modelo,
    costoUsd: Math.round((costoActorUsd + llm.costoUsd) * 10000) / 10000,
  }
  // la revisión de ficha es un trabajo aparte: re-auditar no la borra
  propio.auditoria = { ...auditoria, ficha: propio.auditoria?.ficha }
  propio.markModified('auditoria')
  await propio.save()
  return auditoria
}
