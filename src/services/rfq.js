import { pedirJSON } from './llm.js'
import { Nicho } from '../models/Nicho.js'
import { Reporte } from '../models/Reporte.js'

// Campos en inglés para la hoja de cotización (RFQ) SIN regenerar el análisis
// completo: una sola llamada barata al LLM acota todos los nichos pendientes a
// la vez y el resultado queda guardado en nicho.rfq. Se considera pendiente el
// nicho sin rfq o cuyo análisis es más nuevo que el rfq guardado.

const SCHEMA_RFQ = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['keyword', 'nicho', 'producto', 'especificacion'],
        properties: {
          keyword: { type: 'string', description: 'La keyword original, tal cual se entregó, para emparejar' },
          nicho: { type: 'string', description: 'Nombre del nicho en inglés comercial de Alibaba, 2-4 palabras (ej: "solar garden fountain")' },
          producto: { type: 'string', description: 'Nombre corto del producto en inglés, máximo 8 palabras (ej: "IPL hair removal device, home use")' },
          especificacion: {
            type: 'string',
            description: 'SOLO los atributos que el proveedor necesita para cotizar, en inglés, 4-8 ítems separados por "; " (ej: "999,999 flashes; 5 intensity levels; ice cooling; 220V CL plug; retail box")',
          },
        },
      },
    },
  },
}

const SYSTEM_RFQ = `Preparas una hoja de cotización (RFQ) para proveedores chinos a partir de recomendaciones de un analista de e-commerce.

Para cada ítem entrega nicho y producto en inglés comercial (como se busca en Alibaba/1688) y una especificación LIMPIA: solo los atributos físicos y técnicos que el proveedor necesita para cotizar — potencia, medidas, capacidad, materiales, accesorios incluidos, enchufe 220V Chile si es eléctrico, empaque. NADA de contexto de mercado, precios, marcas de competidores, consejos de validación ni texto en español. Corto, directo, cotizable.`

export async function generarRfqPendientes() {
  const nichos = await Nicho.find({ estado: 'activo' }).lean()

  const pendientes = []
  for (const n of nichos) {
    const rep = await Reporte.findOne({ nichoId: n._id, analisis: { $ne: null } })
      .sort({ fecha: -1 })
      .select('analisis fecha')
      .lean()
    const analisis = rep?.analisis
    if (!analisis || analisis.veredicto === 'no_entrar') continue
    const fechaAnalisis = new Date(analisis.generadoEl ?? rep.fecha)
    const vigente = n.rfq?.desdeAnalisis && new Date(n.rfq.desdeAnalisis).getTime() >= fechaAnalisis.getTime()
    if (vigente) continue
    pendientes.push({ nicho: n, analisis, fechaAnalisis })
  }
  if (!pendientes.length) return { generados: 0, costoUsd: 0 }

  const user = `Ítems a preparar (uno por nicho):\n${JSON.stringify(
    pendientes.map((p) => ({
      keyword: p.nicho.keyword,
      titular: p.analisis.recomendacion?.titular ?? null,
      segmento: p.analisis.recomendacion?.segmento ?? null,
      especificacionOriginal: p.analisis.recomendacion?.especificacionProducto ?? null,
    })),
    null,
    1,
  )}`

  const { datos, costoUsd } = await pedirJSON({ system: SYSTEM_RFQ, user, schema: SCHEMA_RFQ, maxTokens: 6000 })
  const porKeyword = new Map(datos.items.map((i) => [i.keyword.trim().toLowerCase(), i]))

  let generados = 0
  for (const p of pendientes) {
    const item = porKeyword.get(p.nicho.keyword)
    if (!item) continue
    await Nicho.updateOne(
      { _id: p.nicho._id },
      {
        $set: {
          rfq: {
            nichoIngles: item.nicho,
            productoIngles: item.producto,
            especificacion: item.especificacion,
            desdeAnalisis: p.fechaAnalisis,
            generadoEl: new Date(),
          },
        },
      },
    )
    generados++
  }

  const { registrarGasto } = await import('./gastos.js')
  await registrarGasto(pendientes[0].nicho._id, costoUsd)

  return { generados, costoUsd }
}
