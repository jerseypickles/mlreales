import { pedirJSON } from './llm.js'
import { Nicho } from '../models/Nicho.js'

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

Entrega 8-12 keywords variadas: mezcla apuestas de temporada próxima (comprables ya) con tendencias emergentes. Keywords concretas como las escribiría un comprador chileno.`

export async function sugerirNichos({ contexto } = {}) {
  const existentes = await Nicho.find().select('keyword').lean()
  const fecha = new Date().toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'America/Santiago' })

  const user = [
    `Fecha actual: ${fecha}.`,
    existentes.length ? `Nichos que ya estamos trackeando (no los repitas): ${existentes.map((n) => n.keyword).join(', ')}.` : '',
    contexto ? `Contexto del importador: ${contexto}` : '',
    'Propón los nichos a investigar ahora.',
  ]
    .filter(Boolean)
    .join('\n')

  return pedirJSON({
    system: SYSTEM_SUGERIDOR,
    user,
    schema: SCHEMA_SUGERENCIAS,
    maxTokens: 8000,
  })
}
