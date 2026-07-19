import { pedirJSON } from './llm.js'
import { exwMaximoUsd } from './margen.js'
import { obtenerProductosUltimoScan } from './metricas.js'
import { Reporte } from '../models/Reporte.js'
import { criteriosActivos } from './criterios.js'
import { movimientosRecientes, lineasEnAlza, prefijoDeKeyword } from './tendencias.js'
import { config } from '../config/env.js'

const SCHEMA_ANALISIS = {
  type: 'object',
  additionalProperties: false,
  required: ['veredicto', 'confianza', 'resumen', 'segmentos', 'recomendacion', 'riesgos', 'tramites', 'jugada', 'nichoIngles', 'revisarEn'],
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
    revisarEn: {
      type: ['string', 'null'],
      description: 'SOLO si el veredicto es no_entrar POR VENTANA DE IMPORTACIÓN estacional: mes "AAAA-MM" en que conviene re-evaluar el nicho para alcanzar a comprar para el próximo pico (pico menos ~3 meses). null si el rechazo es estructural (marca, volumen, margen) o si el veredicto es de entrada.',
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
- SELLERS GEMELOS (campo metricas.competencia.sellersGemelos): vendedores NO oficiales y chicos que están ganando reseñas AHORA dentro del nicho. Lee el campo con precisión: (a) si viene con elementos, es la prueba directa de que un entrante genérico como el importador puede vender aquí — pésala fuerte a favor; (b) si viene como lista VACÍA, se midió entre dos scans y nadie chico creció — pésalo en contra SOLO si además el top está dominado por tiendas oficiales; (c) si el campo NO viene, es el primer scan y la señal aún no se puede medir — NO lo uses ni a favor ni en contra, y jamás como razón de no_entrar.
- CRITERIOS DEL IMPORTADOR (campo criteriosImportador, si viene): reglas que él escribió en su libreta — cúmplelas al pie de la letra, están por encima de tus heurísticas generales.
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
    rating: p.rating ?? null,
    seller: p.vendedor,
    oficial: p.esTiendaOficial || undefined,
    full: p.esFull || undefined,
    china: p.origenCrossBorder || undefined,
  }))
}

// Tabla de EXW máximo precalculada con el modelo de importación: el LLM razona
// sobre números que salen de nuestra calculadora, no de su imaginación.
function tablaExwMaximo(metricas) {
  const precios = [metricas.precio.p25, metricas.precio.mediana, metricas.precio.p75].filter(Number.isFinite)
  const filas = []
  for (const precio of precios) {
    for (const margen of [25, 35]) {
      const exw = exwMaximoUsd({ precioVentaClp: precio, margenObjetivoPct: margen })
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
  let busquedasEnAlza
  try {
    const prefijo = prefijoDeKeyword(nicho.keyword)
    const movimientos = (await movimientosRecientes()).filter((m) => m.prefijo === prefijo)
    if (movimientos.length) busquedasEnAlza = lineasEnAlza(movimientos, { max: 8 })
  } catch {
    // sin datos de tendencias: el campo simplemente no viaja
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
    busquedasEnAlza,
    metricas: reporte.metricas,
    tablaExwMaximo: tablaExwMaximo(reporte.metricas),
    supuestosTabla: 'EXW máximo por unidad (precio ex-fábrica; la tarifa del forwarder cubre retiro y flete marítimo) asumiendo 500 unidades, 0.003 m³/unidad, TLC 0% arancel, comisión ML 16%, tarifa Full incluida',
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

  return reporte.analisis
}
