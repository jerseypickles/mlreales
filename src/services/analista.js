import { pedirJSON } from './llm.js'
import { exwMaximoUsd } from './margen.js'
import { obtenerProductosUltimoScan } from './metricas.js'
import { Reporte } from '../models/Reporte.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { ventasPorItem } from './ventasMl.js'
import { criteriosActivos } from './criterios.js'
import { leccionesAprendidas } from './aprendizajes.js'
import { movimientosRecientes, lineasEnAlza, prefijoDeKeyword } from './tendencias.js'
import { comisionMlExacta, categoriaDominante } from './comisionesMl.js'
import { config } from '../config/env.js'

const SCHEMA_ANALISIS = {
  type: 'object',
  additionalProperties: false,
  required: ['veredicto', 'confianza', 'resumen', 'segmentos', 'recomendacion', 'riesgos', 'tramites', 'jugada', 'nichoIngles', 'ventanaCompra', 'revisarEn', 'subNichos', 'keywordJugada', 'shareJugadaPct'],
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
    // en repuestos la pregunta no es "entro" sino "para qué autos traigo": sin
    // esto el veredicto es una mediana que no describe a ningún vehículo
    planRepuestos: {
      type: 'array',
      description:
        'SOLO en nichos de repuestos con compatibilidad (cuando venga desglosePorMarcaVehiculo). De 3 a 5 filas ORDENADAS por prioridad de compra: qué marca/modelos traer primero y con qué precio. Omite el campo en nichos que no son de repuestos.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prioridad', 'marca', 'modelos', 'precioVentaClp', 'exwMaximoUsd', 'competencia', 'porQue'],
        properties: {
          prioridad: { type: 'integer', description: '1 = el primero que se compra' },
          marca: { type: 'string', description: 'Marca del vehículo, ej: Chevrolet' },
          modelos: {
            type: 'string',
            description:
              'Modelos y AÑOS concretos que cubre el SKU, ej: "Sail 1.4 2010-2019; Spark GT 2011-2017". Un SKU cubre varios años del mismo modelo: dilo así.',
          },
          precioVentaClp: { type: 'integer', description: 'Precio de venta sugerido para esa marca' },
          exwMaximoUsd: { type: 'number' },
          competencia: {
            type: 'string',
            enum: ['baja', 'media', 'alta'],
            description: 'Según listings, %Full y reseñas de esa marca en el desglose',
          },
          porQue: {
            type: 'string',
            description: 'Justificación con los números del desglose (listings, reseñas, %Full, mediana) en 1-2 frases',
          },
        },
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
    ventanaCompra: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['desde', 'hasta', 'motivo'],
      description:
        'CUÁNDO conviene comprar en China para llegar a tiempo, en meses "AAAA-MM". Para todo_el_año usa el mes actual como desde y +3 meses como hasta. Para estacionales: pico menos 2,5-3 meses de lead time. null solo si el veredicto es no_entrar estructural (no por ventana).',
      properties: {
        desde: { type: 'string', description: 'Mes AAAA-MM en que conviene empezar a comprar' },
        hasta: { type: 'string', description: 'Último mes AAAA-MM en que comprar sirve para el próximo pico' },
        motivo: { type: 'string', description: 'Una frase: por qué esa ventana (pico esperado y lead time)' },
      },
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
- ¿ALGUIEN BUSCA ESTA KEYWORD? (campo nivelBusquedaDeLaKeyword, medido contra el autocompletado real de Mercado Libre — REGLA ELIMINATORIA, léela antes que cualquier métrica). El top 50 que recibes es el listado que devuelve ESA búsqueda exacta. Si nadie la escribe, ese listado no lo abre ningún comprador y todo el scorecard describe un escaparate vacío por más reseñas que tengan sus productos.
  · nivel "alto" o "medio": la gente la escribe tal cual. Analiza normal.
  · nivel "bajo": es cola larga — existe, pero hay que teclear dos palabras para llegar y su volumen es una fracción del de la búsqueda madre. Dilo en el resumen y sé más exigente con el margen.
  · nivel "renombrar": la keyword NO existe en el autocompletado, pero el producto SÍ se busca con otra frase, que viene en keywordSugerida. El veredicto máximo es entrar_con_condiciones y LA condición es publicar apuntando a esa búsqueda real: dilo explícito en el resumen y en la jugada, y declara esa frase en keywordJugada.
  · nivel "nulo": no se busca ni la keyword ni nada parecido. Veredicto no_entrar, y el motivo es exactamente ese —no hay demanda que capturar— sin importar lo que muestren las reseñas del top.
  Si el campo no viene, todavía no se midió: no lo uses ni a favor ni en contra.
- LECTURA HONESTA DEL TOP50 (crítico): reviews:null significa SIN MEDIR — el detalle con reseñas solo cubre las primeras ~30 posiciones y algunas páginas de catálogo no entregan conteo — JAMÁS lo leas como "cero ventas" ni lo uses contra un producto o segmento; reviews:0 sí es un cero real medido. ventasDia ausente = aún no hay segunda medición para calcular velocidad, no "no vende". El top50 es la PRIMERA PLANA de universo.totalResultadosBusqueda resultados: la demanda que calcules es un PISO del listado, no el mercado completo — al comparar segmentos, compara solo entre lo medido.
- serieDemanda es LA PELÍCULA del nicho (una fila por scan con demanda). Si viene esVeredictoDeGraduacion=true, este análisis cierra la maduración: tu veredicto debe basarse en la SOSTENIBILIDAD de la serie — demanda estable o creciente a lo largo de los scans respalda entrar; una serie que se desinfla convierte cualquier buen día en espejismo, dilo explícito en el resumen citando las cifras de la serie.
- CANASTA DE LA SERIE (crítico para leer tendencia): canastaComparables es cuántas publicaciones se midieron en AMBOS scans de ese punto. Dos puntos con canastas muy distintas (ej: 4 vs 24) NO son comparables entre sí — el cambio de ventasDia refleja composición del top, no demanda; un punto con canasta chica (<10) es evidencia débil, jamás lo cites como tendencia. saltosCatalogoFiltrados marca conteos de catálogo que saltaron de nivel (consolidación de ML, no ventas) y fueron excluidos del delta: si un punto los tiene, su ventasDia previo a esa fecha pudo estar inflado.
- PISO DE DETECCIÓN (metricas.demanda.pisoDeteccionVentasDia): la medición por reseñas tiene resolución — 1 reseña en la ventana equivale a ese número de ventas/día. Un ventasDia de 0 significa "demanda BAJO el piso de detección de esa ventana", JAMÁS "cero ventas": un nicho vendiendo 20/día con piso 27 medirá 0 la mitad de los días por puro azar. Nunca cites un 0 puntual como muerte del nicho; mira la serie completa y el piso de cada punto.
- SEGUNDO PROXY — PREGUNTAS NUEVAS (metricas.demanda.preguntas y preguntasNuevasDia en la serie, si vienen): conteo de preguntas de compradores NUEVAS entre scans, medido por id (exacto en especie, PISO en magnitud — la página muestra una lista acotada). Es independiente del conteo de reseñas y no sufre agregados de catálogo. Úsalo como CONTRASTE de coherencia, no como magnitud: ventasDia alto con preguntas nuevas moviéndose = demanda creíble; ventasDia alto con CERO preguntas nuevas en ventanas amplias = trata la demanda con escepticismo y dilo; ausente = aún sin segunda medición, no significa nada.
- Segmenta el nicho leyendo los títulos: potencia (watts), packs/unidades, tamaño, tipo de producto. Los watts y packs cambian el producto y su costo — no los mezcles.
- Usa las reseñas como proxy de ventas (~1 reseña por cada 25 ventas). El share de reseñas de un segmento indica dónde está la demanda real.
- Los items con origenCrossBorder=true son sellers chinos despachando directo: son a la vez señal de que el producto se puede importar barato y competencia difícil de ganar en precio.
- OJO CON %FULL: pctFull se mide SOLO sobre los items cuyo listado mostró el flag (itemsConDatoFull); si es null o la cobertura es baja, di que no está medido en vez de celebrar un 0%. El listado de ML a veces no pinta el ícono aunque el item sí sea Full.
- 🚗 NICHOS DE REPUESTOS CON COMPATIBILIDAD (cuando venga desglosePorMarcaVehiculo). Aquí la decisión NO es "entro o no": es PARA QUÉ VEHÍCULOS TRAIGO. El comprador chileno no busca "pastillas de freno", busca las de SU auto usando el selector marca/modelo/año/versión de ML, así que la mediana global, el %Full global y la demanda global NO describen a ningún vehículo en particular — no bases el veredicto en ellos. Reglas obligatorias:
  1. LLENA planRepuestos con 3 a 5 filas ordenadas por prioridad de compra (prioridad 1 = lo primero que se pide). Cada fila justifica con los NÚMEROS del desglose que recibes: listings de esa marca, % del top, reseñas acumuladas, %Full y precio mediana de esa marca. Prohibido recomendar una marca sin citar su fila del desglose.
  2. CRUZA DOS FUENTES para elegir marcas: (a) la TRACCIÓN medida en el desglose y (b) marcasMasBuscadasEnMl, que es lo que el propio selector de ML declara como más buscado en Chile. Una marca top del selector con pocos listings en el desglose es OPORTUNIDAD (demanda declarada por ML, poca oferta medida); una marca con muchos listings y muchas reseñas es DEMANDA PROBADA pero más peleada. Di a cuál de los dos casos corresponde cada fila.
  3. MODELOS Y AÑOS, no solo la marca: un SKU cubre varios años del mismo modelo ("Sail 1.4 2010-2019"), y eso es lo que se cotiza y se publica. Sácalos de los títulos del top50.
  4. El genérico SÍ vende en este rubro: los compradores compran pastillas genéricas aptas para su modelo, con Full y vendedores de miles de ventas. No rechaces por "marca" ni por "seguridad" — si hay motivo de rechazo, que sea falta de movimiento medido.
  5. ADVERTENCIA OBLIGATORIA en el resumen: la keyword ve solo una fracción del catálogo real de la categoría (en repuestos el volumen vive en la categoría con filtro de compatibilidad, no en la búsqueda por texto), así que el desglose ordena PRIORIDADES pero no mide tamaño de mercado.
- COMPOSICIÓN DEL TOP (metricas.competencia.composicionCategorias y topMezclado): te digo qué categorías REALES de ML componen el top y en qué proporción. Si topMezclado=true (la familia dominante no llega al 60%), las métricas globales — mediana, %Full, demanda — describen una mezcla de productos distintos, NO tu producto: dilo explícito y basa tu recomendación en la categoría que corresponde a tu jugada, no en el promedio del listado. Y si la familia de tu jugada es minoritaria en el top, propón la keywordJugada que la aísle.
- VENTANA DE COMPRA OBLIGATORIA (campo ventanaCompra): todo veredicto de entrada debe declarar EN QUÉ MESES conviene comprar, no solo describirlo en prosa. Es lo que ordena el tablero del importador: un nicho bueno con la ventana cerrada es peor negocio que uno mediano con la ventana abierta hoy. Calcula con 50-70 días de lead time desde China.
- ESTACIONALIDAD ANTES QUE VEREDICTO (regla del importador, 8-ago): un nicho de temporada medido FUERA de su temporada no se puede juzgar por su demanda actual — es como medir útiles escolares en julio. Si el producto es claramente estacional (playa, verano, navidad, invierno, vuelta a clases) y estás midiendo fuera de su ventana, PROHIBIDO concluir "no vende": el veredicto correcto es esperar, con revisarEn puesto en el mes de COMPRA (pico menos ~3 meses de lead time). Un 0 de temporada baja es información sobre el calendario, no sobre el nicho. Solo dictamina falta de movimiento cuando el producto es de todo el año, o cuando tienes serie DE SU PROPIA TEMPORADA que muestre que ni en su pico se mueve.
- JERARQUÍA DE DECISIÓN (regla del importador, 8-ago — pesa sobre cualquier análisis de marca): lo PRIMERO es cuánto SE MUEVE el nicho. Un nicho que mueve mucho tiene espacio para un entrante más, incluso con marcas fuertes arriba: con Full se compra posicionamiento y en un mercado grande siempre hay compradores que eligen por precio y envío rápido. PROBADO en su cuenta: brochas maquillaje tiene 63% Full, marcas premium a $37.990 y un platinum con 590 reseñas, y él vende 47 u/semana con genéricos a $1.890. Por tanto: la dominancia de marca NUNCA es motivo de no_entrar por sí sola — es un dato sobre CÓMO entrar (por precio, por formato, por Full), no sobre SI entrar. Reserva el rechazo por marca solo para casos donde la marca es funcionalmente insustituible: productos de seguridad o riesgo personal (donde el comprador no arriesga con genérico) o catálogos cerrados donde ML no deja competir. Si el nicho NO se mueve (demanda medida floja y sostenida en la serie), ahí sí rechaza — pero di que es por falta de movimiento, no por las marcas.
- FULL ES VOTO DE CONFIANZA CON PLATA (criterio del importador, pesa fuerte): mandar stock a la bodega de ML cuesta almacenaje e inmoviliza inventario — nadie lo hace con un producto que no vende. Por eso pctFull alto NO es solo "competencia dura": es DEMANDA VALIDADA por terceros que arriesgaron capital. Y un 0% Full en un producto APTO para Full (liviano, caja normal) es señal de ALERTA, no de fiesta: puede significar que nadie se atreve a inmovilizar stock ahí porque el nicho no mueve. Distingue siempre: 0% Full + producto voluminoso = estructural (neutro); 0% Full + producto apto + demanda medida floja = el mercado ya votó que no vende; Full presente = el nicho vende de verdad y tu ventaja debe venir de otro lado (precio, formato, listing).
- % Full bajo en un segmento con demanda = oportunidad (Full gana el buy box y el envío rápido) SOLO si el producto es apto para Full: liviano y de caja normal. En productos voluminosos o pesados (línea blanca, muebles, aires con compresor, piscinas armadas) el Full bajo es ESTRUCTURAL — bodegaje caro y límites de tamaño — y no es ventaja para nadie; no lo cuentes a favor.
- Rating promedio alto (>4.5) en un segmento = difícil diferenciarse por calidad; busca segmentos con ratings mediocres y volumen.
- El EXW máximo de tu recomendación debe salir de la tabla precalculada (interpola si el precio sugerido está entre dos puntos). Se compra EXW: precio ex-fábrica, el forwarder cubre retiro y flete. No inventes números de costos.
- CALENDARIO Y LEAD TIME (eliminatorio): te paso la fecha actual. Entre comprar en China y tener stock vendible en Full pasan 50-70 días (producción + 35-50 días de mar + internación + ingreso a Full). Si el nicho es estacional y su pico de venta ya pasó o termina antes de que alcance a llegar un pedido hecho HOY, el veredicto es no_entrar aunque las métricas sean excelentes: la demanda que ves es de la temporada en curso y el stock llegaría a bodega muerta. En el resumen di explícitamente que es por ventana de importación e indica en qué mes comprar para el próximo pico — y declara ese mes en el campo revisarEn ("AAAA-MM"): el sistema reactivará el nicho solo en esa fecha para re-evaluarlo a tiempo. Producto de la estación en curso (ej: ropa de invierno en pleno invierno) ya es tarde. Si la ventana es justa (el pedido llega apenas al inicio del pico), solo entrar_con_condiciones con envío aéreo o pedido chico, y dilo.
- BARRERAS DE IMPORTACIÓN (informar, no vetar): los eléctricos que se enchufan a la red (220V) requieren certificación SEC en Chile; los cosméticos, registro ISP. Son trámites con costo y semanas — NO descartan un nicho bueno por sí solos, pero la recomendación debe dejarlos explícitos: nómbralos en riesgos, súmalos a la jugada (tramitar mientras se valida) e indica si existe una variante del producto sin la barrera (ej: a pilas/USB/12V) para partir más rápido.
- EXPERIENCIA PROPIA EN ESTE NICHO (experienciaPropiaEnEsteNicho, si viene): el importador YA VENDE estos productos DENTRO de este nicho — ventas reales de su cuenta ML, visitas y logística, medidas, no contadas. Es la evidencia de mayor jerarquía que recibes: pésala por sobre toda inferencia de reseñas ajenas. Ventas reales desde un listing aún sin optimizar y con pocas visitas = la demanda de entrada es REAL y el techo es mayor; sin ventas con visitas altas = problema de cierre (precio/ficha), no de demanda. Úsala también para juzgar si tu precio sugerido es realista contra el precio al que él ya vende. OJO CON LA ANTIGÜEDAD: solo recibes publicaciones ACTIVAS, y una con pocos días (antiguedadDias bajo) y pocas visitas AÚN NO ES TEST de nada — jamás uses un listing recién nacido como prueba de que un segmento no vende. Y OBLIGATORIO cuando ya vende aquí: recomienda EXPANSIÓN DE SURTIDO — compara los formatos/variantes del top50 (packs, tamaños, cantidades de piezas, modelos) contra sus productos propios y di explícitamente en el resumen qué variantes que YA venden fuerte en el top le faltan al catálogo propio, citando cifras (ej: "vendes sets de 9-10 brochas; el top mueve sets de 24 pcs a $X con N reseñas y 32 pcs a $Y — tráelos"). El que ya vende en un nicho expande con menos riesgo que el que entra de cero.
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

  // LA PELÍCULA, no la foto: serie de demanda de todos los scans medidos.
  // Con ≥maduracionScans mediciones este análisis es el veredicto de
  // graduación — la sostenibilidad de la serie pesa más que el último día.
  const serie = await Reporte.find({
    nichoId: nicho._id,
    'metricas.demanda.ventasEstimadasPorDia': { $ne: null },
  })
    .sort({ fecha: -1 })
    .limit(12)
    .select('fecha metricas.demanda metricas.precio.mediana scoreOportunidad')
    .lean()
  const serieDemanda = serie.reverse().map((r) => {
    const rv = r.metricas?.demanda?.reviews ?? {}
    return {
      fecha: new Date(r.fecha).toISOString().slice(0, 10),
      ventasDia: r.metricas?.demanda?.ventasEstimadasPorDia ?? null,
      medianaClp: r.metricas?.precio?.mediana ?? null,
      score: r.scoreOportunidad ?? null,
      canastaComparables: rv.itemsComparables ?? null,
      saltosCatalogoFiltrados: (rv.saltosFiltrados ?? 0) + (rv.duplicadosCatalogo ?? 0) || undefined,
      preguntasNuevasDia: r.metricas?.demanda?.preguntas?.porDia ?? undefined,
    }
  })

  // experiencia de primera mano: si el importador ya vende en este nicho, sus
  // números reales pesan más que cualquier inferencia sobre reseñas ajenas
  let experienciaPropiaEnEsteNicho
  const propiosDelNicho = await ProductoPropio.find({ nichoId: nicho._id }).lean()
  if (propiosDelNicho.length) {
    const v7 = await ventasPorItem({ dias: 7 }).catch(() => new Map())
    const v30 = await ventasPorItem({ dias: 30 }).catch(() => new Map())
    experienciaPropiaEnEsteNicho = propiosDelNicho
      // una publicación pausada o sin stock no es un test de demanda: fuera
      .filter((p) => p.estadoMl === 'active')
      .map((p) => {
        const ult = (p.mediciones ?? []).at(-1) ?? {}
        const clave = p.itemIdMl ?? p.sku
        return {
          titulo: p.titulo ?? p.sku,
          precioClp: ult.precio ?? null,
          antiguedadDias: p.creadoEl ? Math.round((Date.now() - new Date(p.creadoEl)) / 86400e3) : null,
          ventasReales7d: v7.get(clave)?.unidades ?? 0,
          ventasReales30d: v30.get(clave)?.unidades ?? 0,
          visitas7d: ult.visitas ?? null,
          resenasAcumuladas: ult.numReviews ?? null,
          logistica: p.envioMl?.logistica ?? null,
        }
      })
    if (!experienciaPropiaEnEsteNicho.length) experienciaPropiaEnEsteNicho = undefined
  }

  const aprendido = await leccionesAprendidas().catch(() => [])

  // ¿alguien busca la keyword que estamos midiendo? Sin esto el veredicto se
  // dicta sobre un listado que puede no ver ningún comprador (caso set snorkel:
  // "entrar" con score 82 sobre una búsqueda que nadie escribe). Si el nicho
  // aún no está medido se mide ahora — son dos consultas al autocompletado, $0,
  // frente a una llamada de LLM que cuesta plata y decide una compra.
  let nivelBusqueda = nicho.nivelBusqueda ?? null
  if (!nivelBusqueda) {
    try {
      const { medirNivelBusqueda } = await import('./nivelBusqueda.js')
      nivelBusqueda = await medirNivelBusqueda(nicho.keyword)
      nicho.nivelBusqueda = nivelBusqueda
      nicho.markModified('nivelBusqueda')
    } catch (err) {
      console.warn(`[analista] nivel de búsqueda de "${nicho.keyword}" no disponible: ${err.message}`)
    }
  }

  // repuestos: el veredicto útil es por vehículo, no global (ver regla 🚗 del
  // prompt). El desglose ya se calcula para la tabla del dashboard; hasta ahora
  // no viajaba al analista y la regla del prompt nunca se activaba.
  let desglosePorMarcaVehiculo
  let marcasMasBuscadasEnMl
  try {
    const { desglosePorMarca, esNichoDeRepuesto, MARCAS_MAS_BUSCADAS_MLC } = await import('./compatibilidad.js')
    const ruta = vista.productos.map((p) => p.categoriaRuta).find(Boolean)
    if (esNichoDeRepuesto(ruta)) {
      desglosePorMarcaVehiculo = desglosePorMarca(vista.productos) ?? undefined
      marcasMasBuscadasEnMl = MARCAS_MAS_BUSCADAS_MLC
    }
  } catch {
    // sin desglose: el analista cae al veredicto global, como antes
  }

  const entrada = {
    keyword: nicho.keyword,
    nivelBusquedaDeLaKeyword: nivelBusqueda
      ? {
          nivel: nivelBusqueda.nivel,
          prefijo: nivelBusqueda.prefijo ?? undefined,
          posicion: nivelBusqueda.posicion ?? undefined,
          deCuantas: nivelBusqueda.deCuantas ?? undefined,
          colaLarga: nivelBusqueda.colaLarga ?? undefined,
          seEscribe: nivelBusqueda.seEscribe ?? undefined,
          keywordSugerida: nivelBusqueda.keywordSugerida ?? undefined,
          otrasBusquedasDelProducto: nivelBusqueda.alternativas?.length ? nivelBusqueda.alternativas : undefined,
        }
      : undefined,
    // memoria del negocio: hechos con plata real de todo el tablero
    loQueYaSabemosPorVentasReales: aprendido.length ? aprendido : undefined,
    experienciaPropiaEnEsteNicho,
    serieDemanda: serieDemanda.length > 1 ? serieDemanda : undefined,
    esVeredictoDeGraduacion: serieDemanda.length >= config.maduracionScans || undefined,
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
    desglosePorMarcaVehiculo,
    marcasMasBuscadasEnMl,
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

  reporte.analisis = {
    ...analisis,
    generadoEl: new Date(),
    modelo,
    // veredicto dictado con la serie de maduración completa (no con la foto
    // del primer scan): la UI lo marca para que se sepa qué tan sólido es
    esGraduacion: serieDemanda.length >= config.maduracionScans || undefined,
    scansDeLaSerie: serieDemanda.length || undefined,
  }
  reporte.markModified('analisis')
  await reporte.save()

  const { registrarGasto } = await import('./gastos.js')
  await registrarGasto(nicho._id, costoUsd)

  // rechazo por ventana estacional → el nicho se auto-agenda para volver a
  // evaluación en el mes declarado (el programador lo reactiva, siempre semanal)
  const revision = analisis.veredicto === 'no_entrar' ? parsearRevisarEn(analisis.revisarEn) : null
  if (revision && revision.getTime() > Date.now()) {
    nicho.revisarEl = revision
  }

  // no_entrar dictado con la SERIE COMPLETA es evidencia, no hipótesis: el
  // nicho se pausa solo y deja de gastar scraper (regla 29-jul, "gastamos
  // mucho"). Con revisarEl vuelve solo en su ventana; sin ventana queda
  // pausado hasta decisión manual. Antes solo los de radar se auto-pausaban.
  // salvo que la gente SÍ escriba esa búsqueda: ahí el rechazo pudo venir de
  // leer mal el listado y el nicho queda pendiente de otro escaneo, no apagado
  if (analisis.veredicto === 'no_entrar' && reporte.analisis.esGraduacion && nicho.estado === 'activo') {
    const { seBusca } = await import('./nivelBusqueda.js')
    if (seBusca(nivelBusqueda)) {
      nicho.notaEtapa = `no_entrar, pero la búsqueda está viva (${nivelBusqueda.nivel}): pendiente de revisión`
      console.log(`[analista] "${nicho.keyword}" NO se pausa: ${nicho.notaEtapa}`)
    } else {
      nicho.estado = 'pausado'
      nicho.notaEtapa = revision
        ? `no_entrar por ventana — vuelve solo ${analisis.revisarEn}`
        : 'no_entrar con serie completa'
      console.log(`[analista] "${nicho.keyword}" pausado solo: ${nicho.notaEtapa}`)
    }
  }
  await nicho.save()

  // la jugada NO se mide sola (decisión del usuario 23-jul tras el caso
  // minipimer=batidora de inmersión): el análisis PROPONE keywordJugada y el
  // botón "Medir la jugada" de la UI ejecuta — proponer es de la IA, gastar es
  // del importador.

  return reporte.analisis
}
