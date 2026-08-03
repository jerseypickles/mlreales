import { pedirJSON } from './llm.js'
import { palabrasClave } from './busquedasReales.js'
import { Nicho } from '../models/Nicho.js'
import { Reporte } from '../models/Reporte.js'
import { Producto } from '../models/Producto.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { ventasPorItem } from './ventasMl.js'
import { criteriosActivos } from './criterios.js'

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
          razon: { type: 'string', description: 'Por qué este nicho ahora' },
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
- Evita nichos dominados por marcas oficiales fuertes (electrónica de marca, juguetes con licencia). Ojo: belleza y cuidado personal GENÉRICOS sí valen — el importador ya vendió cosmético genérico con éxito en ML Chile y sabe tramitar el registro ISP.

APRENDE DEL HISTORIAL del importador (te lo paso con resultados):
- Los nichos que él creó a mano revelan sus intereses generales.
- Los ganadores (entrar/score alto) enseñan el MÉTODO, no la categoría: si lo solar funcionó, NO propongas más solar — busca la misma estructura (producto liviano, demanda medible, poco Full, ticket medio) en OTRA categoría.
- Los descartados (no_entrar) enseñan qué evitar: no propongas variaciones triviales de esos.
- EXCEPCIÓN — PASILLOS PROBADOS CON PLATA REAL: cuando te paso pasillos donde el importador YA VENDE con su propia cuenta, esa categoría SÍ se profundiza (la venta real invierte la regla del método). Propón VECINOS del pasillo: qué más compra el mismo comprador (complementos, accesorios, el resto del ritual de uso) o qué más sale del mismo tipo de fábrica china. Vecino ≠ sinónimo: jamás reformulaciones del nicho probado; piensa en el pasillo completo (ej: brochas probadas → esponjas de maquillaje, organizador de cosméticos, espejo con luz, pestañas postizas, limpiador de brochas).

PORTAFOLIO DIVERSIFICADO (regla dura):
- El tablero es un portafolio de apuestas, no un embudo: de tus keywords, máximo 2 pueden ser vecinas de nichos ya existentes; todas las demás deben abrir categorías que el tablero NO cubre todavía.
- Te paso las verticales saturadas del tablero: ninguna keyword tuya puede contener esas palabras.
- Recorre verticales distintas en cada pasada: cocina/electrohogar (hornos eléctricos, hervidores, sandwicheras), clima de la temporada próxima (ventilador, enfriador portátil para el verano que viene), aparatos de belleza y cuidado personal, deporte/outdoor, mascotas, bebé/niños, organización del hogar, viaje, herramientas.

Entrega 8-12 keywords variadas: prioriza adyacencias al historial, y completa con temporada próxima (comprable ya) y tendencias emergentes. Keywords cortas y naturales (2-4 palabras), tal como las tipearía un comprador chileno en el buscador — el sistema las valida contra el autocompletado real de ML y descarta las que nadie escribe, así que no inventes frases descriptivas largas.`

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
    maxTokens: 8000,
  })
  return datos
}
