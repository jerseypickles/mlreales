import { pedirJSON } from './llm.js'
import { Nicho } from '../models/Nicho.js'
import { Reporte } from '../models/Reporte.js'

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
- El lead time: comprar en China toma 35-50 días por mar. Un producto de temporada hay que comprarlo 2-3 meses antes del pico.
- Productos importables: livianos o de volumen razonable, sin certificaciones complejas (evita eléctricos de alto voltaje enchufados a red si requieren certificación SEC, alimentos, cosméticos), ticket entre $5.000 y $60.000 CLP.
- Tendencias de producto que ya se ven en otros mercados y llegan a Chile con rezago.
- Evita nichos dominados por marcas oficiales fuertes (electrónica de marca, juguetes con licencia).

APRENDE DEL HISTORIAL del importador (te lo paso con resultados):
- Los nichos que él creó a mano revelan sus intereses: propone VECINOS de esos (misma categoría, otro ángulo, accesorios, complementos).
- Los nichos con veredicto entrar/entrar_con_condiciones y score alto son ganadores: propone adyacentes que compartan comprador o proveedor en China.
- Los descartados (no_entrar) enseñan qué evitar: no propongas variaciones triviales de esos.

Entrega 8-12 keywords variadas: prioriza adyacencias al historial, y completa con temporada próxima (comprable ya) y tendencias emergentes. Keywords concretas como las escribiría un comprador chileno.`

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

  return { existentes: nichos.map((n) => n.keyword), lineas }
}

export async function sugerirNichos({ contexto } = {}) {
  const historial = await armarHistorial()
  const fecha = new Date().toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'America/Santiago' })

  const user = [
    `Fecha actual: ${fecha}.`,
    historial.lineas.length
      ? `Historial del importador con resultados (no repitas estas keywords):\n${historial.lineas.join('\n')}`
      : '',
    contexto ? `Contexto del importador: ${contexto}` : '',
    'Propón los nichos a investigar ahora, priorizando adyacencias a lo que el usuario busca y a los ganadores.',
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
