import { pedirJSON } from './llm.js'
import { exwMaximoUsd } from './margen.js'
import { obtenerProductosUltimoScan } from './metricas.js'
import { Reporte } from '../models/Reporte.js'
import { criteriosActivos } from './criterios.js'
import { movimientosRecientes, lineasEnAlza, prefijoDeKeyword } from './tendencias.js'
import { comisionMlExacta, categoriaDominante } from './comisionesMl.js'
import { config } from '../config/env.js'

const SCHEMA_ANALISIS = {
  type: 'object',
  additionalProperties: false,
  required: ['veredicto', 'confianza', 'resumen', 'segmentos', 'recomendacion', 'riesgos', 'tramites', 'jugada', 'nichoIngles', 'revisarEn', 'subNichos', 'keywordJugada', 'shareJugadaPct'],
  properties: {
    veredicto: { type: 'string', enum: ['entrar', 'entrar_con_condiciones', 'no_entrar'] },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
    resumen: { type: 'string', description: 'Veredicto en 2-3 frases, directo y accionable' },
    segmentos: {
      type: 'array',
      description: 'Sub-segmentos del nicho detectados en los títulos (potencia, packs, tamaño, tipo)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nombre', 'criterio', 'rangoPrecioClp', 'shareReviewsPct', 'nivelCompetencia', 'atractivo', 'razon'],
        properties: {
          nombre: { type: 'string' },
          criterio: { type: 'string', description: 'Cómo identificar productos de este segmento' },
          rangoPrecioClp: {
            type: 'object',
            additionalProperties: false,
            required: ['desde', 'hasta'],
            properties: { desde: { type: 'integer' }, hasta: { type: 'integer' } },
          },
          shareReviewsPct: { type: 'number', description: '% de las reseñas del top 50 que concentra' },
          nivelCompetencia: { type: 'string', enum: ['baja', 'media', 'alta'] },
          atractivo: { type: 'string', enum: ['alto', 'medio', 'bajo'] },
          razon: { type: 'string' },
        },
      },
    },
    recomendacion: {
      type: 'object',
      additionalProperties: false,
      required: ['aplica', 'titular', 'segmento', 'precioVentaClp', 'exwMaximoUsd', 'primeraCompra', 'comisionMlPct', 'especificacionProducto', 'productoIngles', 'comoValidar'],
      properties: {
        aplica: { type: 'boolean', description: 'false si el veredicto es no_entrar' },
        titular: {
          type: 'string',
          description: 'LA decisión en una frase de máximo 90 caracteres, formato "Trae: <producto concreto>". Si no_entrar: "No traigas nada de este nicho: <porqué en 5 palabras>"',
        },
        segmento: { type: 'string' },
        precioVentaClp: { type: 'integer', description: 'Precio de entrada sugerido' },
        exwMaximoUsd: { type: 'number', description: 'Precio EXW máximo a pagar en China (ex-fábrica, el forwarder cubre retiro y flete), coherente con la tabla precalculada' },
        primeraCompra: { type: 'string', description: 'Tamaño del pedido de prueba, ej: "50-100 unidades"' },
        comisionMlPct: {
          type: 'number',
          description: 'Comisión típica de Mercado Libre Chile para la categoría de este producto en publicación Clásica (13-19.5). Si no la conoces con certeza, usa 17',
        },
        especificacionProducto: {
          type: 'string',
          description: 'Specs exactas del producto a cotizar, EN INGLÉS, en frases cortas separadas por "; " (ej: "999,999 flashes; 5 intensity levels; sapphire ice cooling; skin sensor; 220V CL plug; retail box in Spanish")',
        },
        productoIngles: {
          type: 'string',
          description: 'Nombre comercial CORTO del producto en inglés, máximo 8 palabras, como título de cotización para un proveedor chino (ej: "IPL hair removal device, home use"). Los detalles van en especificacionProducto, no aquí',
        },
        comoValidar: { type: 'string', description: 'Cómo validar antes de comprar el embarque' },
      },
    },
    riesgos: { type: 'array', items: { type: 'string' } },
    tramites: {
      type: 'array',
      description:
        'Trámites de importación chilenos que el producto recomendado SÍ exige: "SEC" solo si es eléctrico 220V, "ISP" solo si es cosmético o de uso sanitario. Lista vacía si entra sin trámites.',
      items: { type: 'string', enum: ['SEC', 'ISP'] },
    },
    jugada: { type: 'string', description: 'Plan de entrada concreto en 3-5 pasos' },
    nichoIngles: {
      type: 'string',
      description: 'Nombre del nicho en inglés comercial, como lo entendería un proveedor chino en Alibaba (ej: "solar garden fountain", "IPL hair removal device")',
    },
    keywordJugada: {
      type: ['string', 'null'],
      description:
        'SOLO si la keyword del nicho mezcla familias de producto y tu recomendación apunta a un segmento que NO domina el top (<50% de las reseñas): la búsqueda en ML Chile que AÍSLA ese segmento, tal como la escribiría un comprador (minúsculas, ej: "carpa baño vestidor"). El sistema la medirá como sub-nicho automático. null si la keyword madre ya representa tu jugada o si el veredicto es no_entrar.',
    },
    shareJugadaPct: {
      type: ['number', 'null'],
      description:
        '% de las reseñas del top 50 que concentra el segmento de tu recomendación (copia el shareReviewsPct del segmento elegido). null solo si no hay recomendación aplicable.',
    },
    revisarEn: {
      type: ['string', 'null'],
      description: 'SOLO si el veredicto es no_entrar POR VENTANA DE IMPORTACIÓN estacional: mes "AAAA-MM" en que conviene re-evaluar el nicho para alcanzar a comprar para el próximo pico (pico menos ~3 meses). null si el rechazo es estructural (marca, volumen, margen) o si el veredicto es de entrada.',
    },
    subNichos: {
      type: 'array',
      description:
        'Puertas laterales MEDIBLES que la keyword madre no captura: 0 a 3 keywords más específicas donde los datos del top insinúan una jugada distinta (un formato que concentra la plata, un slot premium ocupado por una marca nueva = private label posible, una variante sin barrera regulatoria). Derivadas de lo que VISTE en el top, nunca genéricas. Lista vacía si no hay ángulo que valga un scan.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['keyword', 'motivo', 'jugada'],
        properties: {
          keyword: {
            type: 'string',
            description: 'Búsqueda en ML Chile tal como la escribiría un comprador (minúsculas, específica, ej: "pack toallitas humedas")',
          },
          motivo: {
            type: 'string',
            description: 'El dato del scan que insinúa el ángulo, con números (ej: "caja de 12 a $32.000 es el más vendido y lo vende una marca china nueva, no un incumbente histórico")',
          },
          jugada: {
            type: 'string',
            description: 'La jugada en una frase (ej: "private label: mismo OEM con marca propia al slot premium")',
          },
        },
      },
    },
  },
}

const SYSTEM_ANALISTA = `Eres un analista de e-commerce especializado en Mercado Libre Chile y en importación desde China (Alibaba/1688) para vender vía Mercado Envíos Full.

Tu trabajo: dado el scorecard de un nicho y su top 50 de productos (títulos, precios, reseñas, sellers, Full, origen cross-border), decidir si vale la pena entrar y CÓMO.

Reglas:
- Segmenta el nicho leyendo los títulos: potencia (watts), packs/unidades, tamaño, tipo de producto. Los watts y packs cambian el producto y su costo — no los mezcles.
- Usa las reseñas como proxy de ventas (~1 reseña por cada 25 ventas). El share de reseñas de un segmento indica dónde está la demanda real.
- Los items con origenCrossBorder=true son sellers chinos despachando directo: son a la vez señal de que el producto se puede importar barato y competencia difícil de ganar en precio.
- % Full bajo en un segmento con demanda = oportunidad (Full gana el buy box y el envío rápido) SOLO si el producto es apto para Full: liviano y de caja normal. En productos voluminosos o pesados (línea blanca, muebles, aires con compresor, piscinas armadas) el Full bajo es ESTRUCTURAL — bodegaje caro y límites de tamaño — y no es ventaja para nadie; no lo cuentes a favor.
- Rating promedio alto (>4.5) en un segmento = difícil diferenciarse por calidad; busca segmentos con ratings mediocres y volumen.
- El EXW máximo de tu recomendación debe salir de la tabla precalculada (interpola si el precio sugerido está entre dos puntos). Se compra EXW: precio ex-fábrica, el forwarder cubre retiro y flete. No inventes números de costos.
- CALENDARIO Y LEAD TIME (eliminatorio): te paso la fecha actual. Entre comprar en China y tener stock vendible en Full pasan 50-70 días (producción + 35-50 días de mar + internación + ingreso a Full). Si el nicho es estacional y su pico de venta ya pasó o termina antes de que alcance a llegar un pedido hecho HOY, el veredicto es no_entrar aunque las métricas sean excelentes: la demanda que ves es de la temporada en curso y el stock llegaría a bodega muerta. En el resumen di explícitamente que es por ventana de importación e indica en qué mes comprar para el próximo pico — y declara ese mes en el campo revisarEn ("AAAA-MM"): el sistema reactivará el nicho solo en esa fecha para re-evaluarlo a tiempo. Producto de la estación en curso (ej: ropa de invierno en pleno invierno) ya es tarde. Si la ventana es justa (el pedido llega apenas al inicio del pico), solo entrar_con_condiciones con envío aéreo o pedido chico, y dilo.
- BARRERAS DE IMPORTACIÓN (informar, no vetar): los eléctricos que se enchufan a la red (220V) requieren certificación SEC en Chile; los cosméticos, registro ISP. Son trámites con costo y semanas — NO descartan un nicho bueno por sí solos, pero la recomendación debe dejarlos explícitos: nómbralos en riesgos, súmalos a la jugada (tramitar mientras se valida) e indica si existe una variante del producto sin la barrera (ej: a pilas/USB/12V) para partir más rápido.
- EXPERIENCIA REAL DEL IMPORTADOR (pésala más que tus supuestos de manual): ya vende en Mercado Libre Chile y HA VENDIDO COSMÉTICO GENÉRICO con éxito — en Chile el comprador sí compra genérico, también en belleza. No descartes un nicho por "categoría de marca" a priori: mídelo en el top 50 que te paso (campo "oficial"): si hay productos genéricos/no-oficiales con reseñas, el genérico vende; descarta por marca solo si el top está copado por tiendas oficiales Y los genéricos no tienen tracción. El registro ISP el importador ya lo tramitó antes (se hace por producto): trátalo como costo y plazo conocidos dentro de la jugada, nunca como razón de no_entrar.
- NICHOS QUE VENDEN EN PACKS (campo metricas.precio.porUnidad, si viene): parte del top vende multipacks y los precios por listing NO son comparables entre sí — usa precio.porUnidad (precio ÷ unidades declaradas en el título) para comparar segmentos y hablar de precios. OJO con la tabla EXW: está calculada a precio de LISTING, así que el máximo que entrega es por el BULTO completo a ese precio — divide por las unidades del pack para el costo por pieza. Decide sobre el formato que concentra el volumen de venta (¿qué tamaño de pack manda?).
- SELLERS GEMELOS (campo metricas.competencia.sellersGemelos): vendedores NO oficiales y chicos que están ganando reseñas AHORA dentro del nicho. Lee el campo con precisión: (a) si viene con elementos, es la prueba directa de que un entrante genérico como el importador puede vender aquí — pésala fuerte a favor; (b) si viene como lista VACÍA, se midió entre dos scans y nadie chico creció — pésalo en contra SOLO si además el top está dominado por tiendas oficiales; (c) si el campo NO viene, es el primer scan y la señal aún no se puede medir — NO lo uses ni a favor ni en contra, y jamás como razón de no_entrar.
- CRITERIOS DEL IMPORTADOR (campo criteriosImportador, si viene): reglas que él escribió en su libreta — cúmplelas al pie de la letra, están por encima de tus heurísticas generales.
- COMISIÓN REAL (campo comisionMlRealPct, si viene): es la comisión exacta de ML para la categoría de este nicho, obtenida de la API oficial — declárala tal cual en recomendacion.comisionMlPct y NO la estimes; la tabla EXW ya la incorpora.
- KEYWORD vs JUGADA (campos keywordJugada y shareJugadaPct, SIEMPRE decláralos): el ranking de ML mezcla familias de producto bajo una misma búsqueda (ej: "carpa camping" en invierno = 55% lonas de repuesto para toldo) y las métricas que recibes vienen de esa MEZCLA. Declara shareJugadaPct (cuánto del top respalda tu recomendación) y, si tu jugada apunta a un segmento que no domina el top, declara keywordJugada: el importador podrá medirla pura con un botón (proponer es tuyo, gastar es de él). No es lo mismo que subNichos (exploración de puertas laterales): keywordJugada es LA búsqueda de tu recomendación principal.
- SINÓNIMOS Y NICHOS YA MEDIDOS (campo nichosYaMedidos, regla eliminatoria para keywordJugada y subNichos): en Chile el mismo producto tiene varios nombres — minipimer = batidora de inmersión, cosmetiquero = maleta de maquillaje, sabanilla = pañal de entrenamiento, ice roller ≈ rodillo facial. JAMÁS propongas como keywordJugada o subNicho una búsqueda que sea sinónimo o reformulación de la keyword del propio nicho, ni una que ya esté (o cuyo sinónimo ya esté) en nichosYaMedidos: medirla de nuevo es pagar dos veces el mismo dato. Si la jugada ya se mide en un nicho existente, declara keywordJugada null y dilo en el resumen citando ese nicho por su nombre.
- SUB-NICHOS / PUERTAS LATERALES (campo subNichos, SIEMPRE piénsalo): tu veredicto responde por la keyword madre, pero el top suele insinuar jugadas que ella no captura — un formato que concentra la plata (packs, tamaño), un slot premium ocupado por una marca NUEVA y no por un incumbente histórico (= el slot se construyó hace poco y una marca propia/private label puede disputarlo), una variante sin la barrera regulatoria, un accesorio con mejor margen. Propón 0-3 keywords más específicas con su motivo CITANDO los datos del scan y la jugada concreta. En un no_entrar es OBLIGATORIO responderte: "rechazo la puerta principal, ¿existe puerta lateral?" — si no existe, lista vacía y punto; no inventes. El sistema crea y mide cada sub-nicho con un clic: no propongas nada que no valga el costo de un scan.
- BÚSQUEDAS EN ALZA (campo busquedasEnAlza, si viene): consultas del autocompletado de ML que están subiendo esta semana en la vertical de este nicho — señal de demanda en tiempo real que complementa el delta de reseñas; úsala para elegir el segmento y el ángulo del producto.
- CONTEXTO DEL IMPORTADOR SOBRE ESTE NICHO (campo contextoImportador, si viene): es experiencia de primera mano — ventas reales suyas en este nicho, conocimiento del segmento, canal o temporada. Pésalo POR SOBRE lo que infieras de las reseñas: las reseñas acumuladas por listing miden permanencia, y los vendedores genéricos rotan publicaciones — sus ventas se dispersan en listings de vida corta que no acumulan reseñas, así que "genéricos con pocas reseñas" NO prueba que el genérico no venda si el importador ya lo vendió. Si su experiencia contradice tu lectura de los datos, dilo explícitamente en el resumen y ajusta el veredicto considerando ambas evidencias.
- Sé directo y escéptico: si el nicho no da, di no_entrar y explica por qué. Un veredicto inflado cuesta dinero real.
- El usuario quiere LA decisión, no un informe: titular de máximo 90 caracteres con el producto concreto a traer, resumen de máximo 2 frases, razón de cada segmento en 1 frase, riesgos de 1 línea cada uno. Cero relleno.
- Todo en español de Chile, precios en CLP.`

function resumirProductosParaLLM(productos) {
  return productos.slice(0, 50).map((p) => ({
    pos: p.posicion,
    titulo: p.titulo,
    precio: p.precio,
    reviews: p.numReviews ?? null,
    // velocidad ACTUAL (delta reseñas reciente × factor): quién vende hoy,
    // no quién acumuló históricamente
    ventasDia: p.ventasDia ?? undefined,
    rating: p.rating ?? null,
    seller: p.vendedor,
    oficial: p.esTiendaOficial || undefined,
    full: p.esFull || undefined,
    china: p.origenCrossBorder || undefined,
  }))
}

// Tabla de EXW máximo precalculada con el modelo de importación: el LLM razona
// sobre números que salen de nuestra calculadora, no de su imaginación.
// comisionPct real (API oficial) reemplaza al default del config si viene.
function tablaExwMaximo(metricas, comisionPct = null) {
  const precios = [metricas.precio.p25, metricas.precio.mediana, metricas.precio.p75].filter(Number.isFinite)
  const parametros = Number.isFinite(comisionPct) ? { mercadoLibre: { comisionPct } } : undefined
  const filas = []
  for (const precio of precios) {
    for (const margen of [25, 35]) {
      const exw = exwMaximoUsd({ precioVentaClp: precio, margenObjetivoPct: margen, parametros })
      filas.push({ precioVentaClp: Math.round(precio), margenObjetivoPct: margen, exwMaximoUsd: exw })
    }
  }
  return filas
}

// "AAAA-MM" (o "AAAA-MM-DD") → Date del día 1 de ese mes; inválido → null
export function parsearRevisarEn(texto) {
  const m = String(texto ?? '').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/)
  if (!m) return null
  const fecha = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1)))
  return Number.isNaN(fecha.getTime()) ? null : fecha
}

export async function analizarNicho(nicho) {
  const reporte = await Reporte.findOne({ nichoId: nicho._id }).sort({ fecha: -1 })
  if (!reporte) throw Object.assign(new Error('el nicho aún no tiene reporte; corre un scan primero'), { status: 409 })

  const vista = await obtenerProductosUltimoScan(nicho)
  if (!vista) throw Object.assign(new Error('el nicho no tiene snapshots'), { status: 409 })

  // criterios de la libreta + búsquedas en alza de la vertical (mejores
  // entradas = mejores veredictos; ambas opcionales y a prueba de fallos)
  const criterios = await criteriosActivos().catch(() => [])
  // el tablero completo: para que keywordJugada/subNichos no propongan medir
  // lo que ya se mide (ni con sinónimos — caso minipimer/batidora de inmersión)
  const { Nicho } = await import('../models/Nicho.js')
  const nichosYaMedidos = await Nicho.find().select('keyword').lean().then((ns) => ns.map((n) => n.keyword)).catch(() => [])
  let busquedasEnAlza
  try {
    const prefijo = prefijoDeKeyword(nicho.keyword)
    const movimientos = (await movimientosRecientes()).filter((m) => m.prefijo === prefijo)
    if (movimientos.length) busquedasEnAlza = lineasEnAlza(movimientos, { max: 8 })
  } catch {
    // sin datos de tendencias: el campo simplemente no viaja
  }

  // comisión EXACTA de ML para la categoría dominante del nicho (API oficial,
  // validada 22-jul): la tabla EXW y el veredicto dejan de usar el 16% genérico.
  // Sin cuenta conectada o sin categoría, todo sigue con los defaults.
  let comisionReal = null
  try {
    const categoria = await categoriaDominante(nicho.keyword)
    comisionReal = await comisionMlExacta({ precioClp: reporte.metricas.precio?.mediana, categoriaId: categoria })
  } catch {
    // sin comisión exacta: la tabla usa el default del config
  }

  const entrada = {
    keyword: nicho.keyword,
    fechaActual: new Date().toLocaleDateString('es-CL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Santiago',
    }),
    estacionalidad: nicho.radarInfo?.estacionalidad ?? undefined,
    ventanaImportacionSegunRadar: nicho.radarInfo?.ventanaImportacion ?? undefined,
    contextoImportador: nicho.contextoUsuario ?? undefined,
    criteriosImportador: criterios.length ? criterios : undefined,
    nichosYaMedidos: nichosYaMedidos.length ? nichosYaMedidos : undefined,
    busquedasEnAlza,
    comisionMlRealPct: comisionReal?.pct ?? undefined,
    metricas: reporte.metricas,
    tablaExwMaximo: tablaExwMaximo(reporte.metricas, comisionReal?.pct ?? null),
    supuestosTabla: `EXW máximo por unidad (precio ex-fábrica) asumiendo 500 unidades, 0.003 m³/unidad, flete marítimo prorrateado de contenedor surtido completo, TLC 0% arancel, comisión ML ${
      Number.isFinite(comisionReal?.pct) ? `${comisionReal.pct}% (exacta de la API oficial para la categoría del nicho)` : '16%'
    }, tarifa Full incluida`,
    top50: resumirProductosParaLLM(vista.productos),
  }

  const { datos: analisis, costoUsd, modelo } = await pedirJSON({
    system: SYSTEM_ANALISTA,
    user: `Analiza este nicho de mercadolibre.cl y decide si entrar:\n\n${JSON.stringify(entrada)}`,
    schema: SCHEMA_ANALISIS,
    maxTokens: 12_000,
    modelo: config.llmModelAnalista, // la decisión cara corre en el modelo más capaz
  })

  reporte.analisis = { ...analisis, generadoEl: new Date(), modelo }
  reporte.markModified('analisis')
  await reporte.save()

  const { registrarGasto } = await import('./gastos.js')
  await registrarGasto(nicho._id, costoUsd)

  // rechazo por ventana estacional → el nicho se auto-agenda para volver a
  // evaluación en el mes declarado (el programador lo reactiva, siempre semanal)
  const revision = analisis.veredicto === 'no_entrar' ? parsearRevisarEn(analisis.revisarEn) : null
  if (revision && revision.getTime() > Date.now()) {
    nicho.revisarEl = revision
    await nicho.save()
  }

  // la jugada NO se mide sola (decisión del usuario 23-jul tras el caso
  // minipimer=batidora de inmersión): el análisis PROPONE keywordJugada y el
  // botón "Medir la jugada" de la UI ejecuta — proponer es de la IA, gastar es
  // del importador.

  return reporte.analisis
}
