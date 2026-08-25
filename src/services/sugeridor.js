import { pedirJSON } from './llm.js'
import { palabrasClave } from './busquedasReales.js'
import { Nicho } from '../models/Nicho.js'
import { Reporte } from '../models/Reporte.js'
import { Producto } from '../models/Producto.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { ventasPorItem } from './ventasMl.js'
import { criteriosActivos } from './criterios.js'
import { leccionesAprendidas, hermanasDeLoQueVende } from './aprendizajes.js'

// Palabras que dominan el tablero: si una raíz aparece en 3+ keywords activas
// (ej: "solar"), esa vertical está saturada y el radar no debe abrir más ahí.
export function palabrasSaturadas(keywords, { umbral = 3 } = {}) {
  const conteo = new Map()
  for (const k of keywords) {
    for (const p of palabrasClave(k)) conteo.set(p, (conteo.get(p) ?? 0) + 1)
  }
  return new Set([...conteo].filter(([, c]) => c >= umbral).map(([p]) => p))
}

const SCHEMA_SUGERENCIAS = {
  type: 'object',
  additionalProperties: false,
  required: ['sugerencias'],
  properties: {
    sugerencias: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['keyword', 'categoria', 'razon', 'estacionalidad', 'ventanaImportacion', 'riesgo'],
        properties: {
          keyword: { type: 'string', description: 'Keyword tal como se buscaría en mercadolibre.cl, en minúsculas' },
          categoria: { type: 'string' },
          // acotada a propósito: los filtros de negocio que se agregaron el
          // 15-ago (ticket, diferenciabilidad, peso) hicieron que el modelo
          // escribiera justificaciones larguísimas y la respuesta se truncara
          // por max_tokens con 12 sugerencias. La razón la lee una persona de
          // paso en el sidebar, no la consume el pipeline.
          razon: { type: 'string', description: 'Por qué este nicho ahora. MÁXIMO 2 frases, va en una fila del tablero' },
          estacionalidad: {
            type: 'object',
            additionalProperties: false,
            required: ['tipo', 'mesesPico'],
            properties: {
              tipo: { type: 'string', enum: ['estacional', 'tendencia', 'todo_el_año'] },
              mesesPico: { type: 'array', items: { type: 'string' } },
            },
          },
          ventanaImportacion: {
            type: 'string',
            description: 'Cuándo habría que comprar en China considerando 35-50 días de tránsito marítimo',
          },
          riesgo: { type: 'string' },
        },
      },
    },
  },
}

const SYSTEM_SUGERIDOR = `Eres un scout de nichos para un importador chileno que compra en China (Alibaba/1688) y vende en Mercado Libre Chile vía Full.

Propones keywords de búsqueda para nichos que valga la pena INVESTIGAR con datos (el sistema luego los escanea y mide demanda real). Piensa en:
- El calendario chileno: estaciones invertidas vs hemisferio norte, fiestas patrias (septiembre), navidad, vuelta a clases (marzo), CyberDay (mayo/octubre), verano (dic-feb), invierno (jun-ago).
- El lead time es ELIMINATORIO: entre comprar en China y tener stock vendible en Full pasan 50-70 días (producción + 35-50 días de mar + internación). Solo propone nichos estacionales cuyo pico de venta empiece al menos 2.5 meses DESPUÉS de la fecha actual. NUNCA propongas productos de la estación en curso: en pleno invierno ya es tarde para lo de invierno — lo que corresponde es proponer la temporada siguiente (primavera/fiestas patrias/verano según la fecha). Los nichos todo_el_año no tienen esta restricción.
- Productos importables: livianos o de volumen razonable, ticket entre $5.000 y $60.000 CLP. Prefiere lo que entra sin trámites, pero una oportunidad fuerte con certificación SEC (eléctricos 220V) o registro ISP (cosméticos) SÍ se puede proponer — deja el trámite explícito en el campo riesgo. Evita solo alimentos.
- Tendencias de producto que ya se ven en otros mercados y llegan a Chile con rezago.
- La MARCA DOMINANTE NO VETA un nicho. Lo dice el criterio del importador y está probado: entró a brochas con 63% de Full y marcas arriba, y vende 35 u/semana ganando por precio ($2.690 contra una mediana de $7.364). La publicidad compra la posición que no se gana orgánicamente, y no todo Chile compra por logo — mucha gente busca lo económico que funcione. Lo que sí importa es que el producto se pueda diferenciar con ficha y fotos propias, y que el ticket aguante el CAC. Belleza y cuidado personal genéricos valen: ya vendió cosmético genérico y sabe tramitar el ISP.

APRENDE DEL HISTORIAL del importador (te lo paso con resultados):
- Los nichos que él creó a mano revelan sus intereses generales.
- Los ganadores (entrar/score alto) enseñan el MÉTODO, no la categoría: si lo solar funcionó, NO propongas más solar — busca la misma estructura (producto liviano, demanda medible, poco Full, ticket medio) en OTRA categoría.
- Los descartados (no_entrar) enseñan qué evitar: no propongas variaciones triviales de esos.
- EXCEPCIÓN — PASILLOS PROBADOS CON PLATA REAL: cuando te paso pasillos donde el importador YA VENDE con su propia cuenta, esa categoría SÍ se profundiza (la venta real invierte la regla del método). Propón VECINOS del pasillo: qué más compra el mismo comprador (complementos, accesorios, el resto del ritual de uso) o qué más sale del mismo tipo de fábrica china. Vecino ≠ sinónimo: jamás reformulaciones del nicho probado; piensa en el pasillo completo (ej: brochas probadas → esponjas de maquillaje, organizador de cosméticos, espejo con luz, pestañas postizas, limpiador de brochas).

PORTAFOLIO DIVERSIFICADO (regla dura):
- El tablero es un portafolio de apuestas, no un embudo: de tus keywords, máximo 2 pueden ser vecinas de nichos ya existentes; todas las demás deben abrir categorías que el tablero NO cubre todavía.
- Te paso las verticales saturadas del tablero: ninguna keyword tuya puede contener esas palabras.
- Recorre verticales distintas en cada pasada: cocina/electrohogar (hornos eléctricos, hervidores, sandwicheras), aparatos de belleza y cuidado personal, mascotas, organización del hogar, herramientas y ferretería, repuestos de vehículo, salud y bienestar, computación y accesorios de escritorio, calzado, bebé/niños, deporte, viaje, y clima de la temporada próxima.
- CALZADO: solo el segmento GENÉRICO, el que se vende por función y no por logo. Medido el 16-ago en "zapatillas mujer": mediana $41.990 pero 87% tiendas oficiales y 84% del top son Puma, Skechers, Vans, Converse y Adidas — ahí no hay dónde entrar. Donde sí hay es en el calzado que nadie compra por marca: pantuflas (14.800/mes), suecos, calzado de trabajo o antideslizante, botas de agua, alpargatas, sandalias de baño. Evita todo lo que se elija por logo. Y ojo con las tallas: prefiere calzado de talla gruesa (S/M/L, o rangos) antes que numeración fina 35-44, porque cada número es stock inmovilizado aparte en Full y las devoluciones por talla son las más altas de ML.
- COMPUTACIÓN Y GAMING: entran completos, periféricos incluidos y con marca en el nicho. Soportes, bases refrigerantes, hubs, organizadores de cable, alfombrillas, brazos para monitor, fundas, y también mouse, teclados, audífonos, webcams, parlantes y sillas. Volúmenes medidos en Chile: silla gamer 40.500/mes, webcam 27.100, audífonos bluetooth 27.100, mouse inalámbrico 14.800, teclado mecánico 12.100, mouse gamer 9.900. Que arriba estén Logitech o Razer no lo veta — se entra por precio con publicidad, igual que en brochas. Lo único que sigue fuera son los EQUIPOS con catálogo cerrado por número de modelo (notebooks, tablets, celulares, monitores, componentes), no por la marca sino porque ahí todos comparten la misma página y no hay ficha propia que diferenciar.

TODO EL AÑO PRIMERO (regla dura, y es la que más importa):
- MÍNIMO 6 de cada 10 keywords deben ser tipo "todo_el_año": productos que se compran los 12 meses sin depender de una fecha. Los estacionales son el COMPLEMENTO, no la base.
- El porqué es de negocio, no de gusto: un estacional deja el capital dormido 10 meses, su stock sobrante paga bodega Full todo ese tiempo, y si se pierde la ventana hay que esperar un año entero. Un producto plano rota el capital 4 o 5 veces al año, y con un margen mucho menor rinde más. Además mantiene la cuenta vendiendo siempre, que es lo que sostiene la posición en el buscador.
- Este tablero está desbalanceado hacia lo estacional y hay que corregirlo, así que ante la duda propone lo plano.

FILTROS DE NEGOCIO (aplícalos antes de proponer):
- CABE EN FULL O NO SIRVE. Límites oficiales de ML Chile, medidos sobre el EMPAQUE final: menos de 20 kg, ningún lado sobre 120 cm y la suma de los tres bajo 260 cm. Lo que excede queda fuera de Full, y sin Full se pierde el posicionamiento que sostiene toda la operación. Además el envío se cobra por peso VOLUMÉTRICO (4.000 cm³/kg, se factura el mayor entre real y volumétrico), así que un bulto liviano pero grande paga como si pesara mucho y se come el margen sin avisar.
  En MOBILIARIO la restricción que manda NO es si cabe —el mueble empacado plano cabe holgado: una mesa auxiliar de 60x60x10 suma 130 de 260 permitidos, un escritorio plegable de 110x60x12 suma 182— sino CUÁNTO CUESTA su volumen. Medido: esa mesa a $39.990 paga $6.200 de envío (16% del precio) y un zapatero de $19.990 paga $5.800 (29%). Al revés de los productos chicos, donde el envío es fijo en ~$799 y subir el precio mejora el margen, acá el flete ESCALA con el bulto.
  Por eso en mueble el criterio es el GROSOR del empaque y el precio que lo sostiene: propón lo que viaje plano (repisas, mesas auxiliares, escritorios y sillas plegables, zapateros, organizadores, muebles para armar) con ticket sobre $25.000. Descarta lo que llegue armado y voluminoso —sofás, camas, closets— no porque no quepa sino porque su volumétrico se come el margen. Si dudas del bulto, propón igual y dilo en el porqué: el importador cotiza el cubicaje real con el proveedor.
- TICKET: el producto tiene que venderse en Chile por MÁS DE $10.000. No hay techo — mientras más caro, mejor, siempre que el flete desde China lo permita. El motivo: Full cobra un envío FIJO de ~$870-$1.079, así que en un producto de $3.000 la logística se come el 29% y en uno de $18.000 solo el 6%; y comprar un cliente con publicidad cuesta ~$1.700 medidos, o sea que bajo $10.000 la publicidad no puede ser rentable. Dato útil para elegir el precio de venta después, no para descartar: la tarifa de Full salta justo en $9.990 y otra vez en $19.990.
- DIFERENCIABLE: lo que decide NO es si hay marcas arriba, es si puedes publicar TU ficha con TUS fotos. Un nicho con marcas fuertes pero donde cada vendedor arma su propia publicación es entrable; uno donde ML impone catálogo único por número de modelo no lo es, porque ahí todos comparten la misma página y solo queda competir por precio sin poder diferenciarte. Mide el % de catálogo del nicho, no los logos del top.
- LIVIANO PARA SU PRECIO: el flete desde China se paga por volumen. Prefiere valor alto en poco espacio; evita muebles, cosas infladas de aire y cajas grandes de bajo precio.

COBERTURA DE VERTICALES (regla dura):
- Cada pasada tiene que tocar AL MENOS 5 verticales distintas de la lista, y al menos 2 de ellas deben ser verticales que el tablero NO cubre todavía. Sin esto el modelo se queda dando vueltas en belleza y hogar, que es de donde ya vienen la mitad de los nichos.
- Te paso las verticales que el tablero ya cubre: no gastes más de 2 keywords ahí.

NADA DE KEYWORDS GENÉRICAS DE UNA PALABRA:
- La keyword tiene que nombrar un PRODUCTO concreto, no una familia. "pistola" no sirve —¿de juguete, de silicona, de pintura, de calor?—, "pistola de silicona" sí. "lámpara" no, "lámpara de escritorio" sí. Una palabra suelta mide un mercado que no existe y arrastra semanas de scans antes de que se note.

Entrega 8-12 keywords variadas, con al menos 6 de cada 10 de tipo todo_el_año. Keywords cortas y naturales (2-4 palabras), tal como las tipearía un comprador chileno en el buscador — el sistema las valida contra el autocompletado real de ML y descarta las que nadie escribe, así que no inventes frases descriptivas largas.`

// Pasillos donde el importador ya vende con su cuenta: la evidencia más dura
// que existe — el radar profundiza estos en vez de solo diversificar lejos.
async function pasillosProbados() {
  const propios = await ProductoPropio.find({ nichoId: { $ne: null } }).lean()
  if (!propios.length) return []
  const v30 = await ventasPorItem({ dias: 30 }).catch(() => new Map())
  const unidadesPorNicho = new Map()
  for (const p of propios) {
    const unidades = v30.get(p.itemIdMl ?? p.sku)?.unidades ?? 0
    if (!unidades) continue
    const clave = String(p.nichoId)
    unidadesPorNicho.set(clave, (unidadesPorNicho.get(clave) ?? 0) + unidades)
  }
  const lineas = []
  for (const [nichoId, unidades] of unidadesPorNicho) {
    const nicho = await Nicho.findById(nichoId).select('keyword').lean()
    if (!nicho) continue
    const rutas = await Producto.aggregate([
      { $match: { keywordOrigen: nicho.keyword, categoriaRuta: { $ne: null } } },
      { $group: { _id: '$categoriaRuta', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 1 },
    ])
    lineas.push(
      `"${nicho.keyword}"${rutas[0] ? ` (pasillo: ${rutas[0]._id})` : ''}: ${unidades} unidad(es) vendidas por el importador en 30 días`,
    )
  }
  return lineas
}

// Historial con resultados para que el sugeridor aprenda qué busca el usuario y qué funcionó.
async function armarHistorial() {
  const nichos = await Nicho.find().select('keyword origen estado').lean()
  if (!nichos.length) return { existentes: [], lineas: [] }

  const reportes = await Reporte.aggregate([
    { $match: { analisis: { $ne: null } } },
    { $sort: { fecha: -1 } },
    {
      $group: {
        _id: '$nichoId',
        veredicto: { $first: '$analisis.veredicto' },
        score: { $first: '$scoreOportunidad' },
      },
    },
  ])
  const porNicho = new Map(reportes.map((r) => [String(r._id), r]))

  const lineas = nichos.map((n) => {
    const r = porNicho.get(String(n._id))
    const partes = [`"${n.keyword}" (${n.origen === 'radar' ? 'propuesto por radar' : 'BUSCADO POR EL USUARIO'})`]
    if (r) partes.push(`score ${r.score ?? '?'}, veredicto ${r.veredicto}`)
    if (n.estado === 'pausado') partes.push('descartado')
    return partes.join(' — ')
  })

  const activas = nichos.filter((n) => n.estado === 'activo').map((n) => n.keyword)
  return { existentes: nichos.map((n) => n.keyword), lineas, saturadas: palabrasSaturadas(activas) }
}

export async function sugerirNichos({ contexto, tendencias } = {}) {
  const historial = await armarHistorial()
  const pasillos = await pasillosProbados().catch(() => [])
  const lecciones = await leccionesAprendidas().catch(() => [])
  const hermanas = await hermanasDeLoQueVende().catch(() => [])
  const criterios = await criteriosActivos().catch(() => [])
  const fecha = new Date().toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'America/Santiago' })

  const user = [
    `Fecha actual: ${fecha}.`,
    criterios.length
      ? `CRITERIOS DEL IMPORTADOR (los escribió él — cúmplelos al proponer):\n${criterios.map((c) => `- ${c}`).join('\n')}`
      : '',
    historial.lineas.length
      ? `Historial del importador con resultados (no repitas estas keywords):\n${historial.lineas.join('\n')}`
      : '',
    historial.saturadas?.size
      ? `Verticales SATURADAS del tablero — ninguna keyword puede contener estas palabras: ${[...historial.saturadas].join(', ')}`
      : '',
    pasillos.length
      ? `PASILLOS PROBADOS CON PLATA REAL (el importador YA VENDE aquí con su cuenta):\n${pasillos.map((p) => `- ${p}`).join('\n')}`
      : '',
    lecciones.length
      ? `LO QUE EL SISTEMA YA APRENDIÓ CON VENTAS REALES (memoria del negocio, no estimaciones):\n${lecciones.map((l) => `- ${l}`).join('\n')}`
      : '',
    hermanas.length
      ? `CATEGORÍAS HERMANAS de lo que YA VENDE, según el árbol real de Mercado Libre — las candidatas más fuertes porque comparten comprador y rama:\n${hermanas
          .map((h) => `- "${h.nombre}" (rama ${h.rama}, hermana de lo que vendes en "${h.hermanaDe}")`)
          .join('\n')}\nConviértelas en keywords que la gente ESCRIBA: el nombre de la categoría casi nunca es la búsqueda real.`
      : '',
    tendencias?.length
      ? `Búsquedas EN ALZA esta semana según el autocompletado real de ML (gente escribiéndolas más que antes — priorízalas como candidatas si cumplen las demás reglas):\n${tendencias.join('\n')}`
      : '',
    contexto ? `Contexto del importador: ${contexto}` : '',
    pasillos.length
      ? 'Propón los nichos a investigar ahora: primero 2-3 VECINOS de los pasillos probados (mismo comprador o mismo proveedor, jamás sinónimos), y completa abriendo categorías nuevas para diversificar (máximo 2 vecinas del resto de lo existente).'
      : 'Propón los nichos a investigar ahora: abre categorías nuevas para diversificar el portafolio (máximo 2 vecinas de lo existente).',
  ]
    .filter(Boolean)
    .join('\n\n')

  const { datos } = await pedirJSON({
    system: SYSTEM_SUGERIDOR,
    user,
    schema: SCHEMA_SUGERENCIAS,
    // 8000 alcanzaba antes de los filtros de negocio; con ellos el modelo
    // razona más por sugerencia y 12 sugerencias no cabían
    maxTokens: 16_000,
  })

  // EL FILTRO QUE FALTABA. El sugeridor razona con el contexto del negocio y el
  // autocompletado de ML, pero no veía ni el tamaño ni la dirección del mercado
  // — lanzaba nichos correctos sobre tendencias poco atractivas, y cada uno
  // cuesta scans y análisis durante semanas antes de que se note.
  //
  // Se mide ANTES de abrirlos: volumen en una sola llamada y crecimiento de los
  // últimos años. Ojo con la doctrina: esto mide CHILE, no Mercado Libre, así
  // que solo descarta lo que no alcanza ni para una compra (bajo 200 búsquedas
  // al mes) y para el resto ordena. Si alguien busca eso DENTRO de ML lo sigue
  // contestando el autocompletado, que es la fuente correcta para esa pregunta.
  try {
    const { medirAtractivo } = await import('./atractivoNicho.js')
    const sugerencias = datos?.sugerencias ?? []
    const medidas = await medirAtractivo(sugerencias.map((s) => s.keyword))
    const porKeyword = new Map(medidas.map((m) => [m.keyword, m]))
    datos.sugerencias = sugerencias
      .map((s) => ({ ...s, atractivo: porKeyword.get(s.keyword) ?? null }))
      .filter((s) => !s.atractivo || s.atractivo.suficiente)
      .sort((a, b) => (b.atractivo?.volumen ?? 0) * (b.atractivo?.crecimiento === 'crece' ? 1.35 : 1)
        - (a.atractivo?.volumen ?? 0) * (a.atractivo?.crecimiento === 'crece' ? 1.35 : 1))
    datos.descartadasPorVolumen = medidas
      .filter((m) => !m.suficiente)
      .map((m) => ({ keyword: m.keyword, volumen: m.volumen }))
  } catch (err) {
    // sin medición el radar sigue proponiendo como antes: mejor a ciegas que detenido
    console.warn(`[sugeridor] atractivo no medido: ${err.message}`)
  }
  return datos
}
