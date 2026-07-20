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
        required: ['keyword', 'nicho', 'producto', 'especificacion', 'productoClave', 'unidadPedido'],
        properties: {
          keyword: { type: 'string', description: 'La keyword original, tal cual se entregó, para emparejar' },
          nicho: { type: 'string', description: 'Nombre del nicho en inglés comercial de Alibaba, 2-4 palabras (ej: "solar garden fountain")' },
          producto: { type: 'string', description: 'Nombre corto del producto en inglés, máximo 8 palabras (ej: "IPL hair removal device, home use")' },
          especificacion: {
            type: 'string',
            description: 'SOLO los atributos que el proveedor necesita para cotizar, en inglés, 4-8 ítems separados por "; " (ej: "999,999 flashes; 5 intensity levels; ice cooling; 220V CL plug; retail box")',
          },
          productoClave: {
            type: 'string',
            description: 'Clave canónica del producto físico en inglés, minúsculas y kebab-case (ej: "ipl-hair-removal-device"). Dos nichos que se surten con EL MISMO producto de fábrica llevan EXACTAMENTE la misma clave aunque sus keywords de venta difieran; productos distintos, claves distintas.',
          },
          unidadPedido: {
            type: 'string',
            description:
              'La unidad física en la que se PIDE y COTIZA, en inglés y explícita con su contenido (ej: "master case (12 packs × 80 wipes)", "set of 2", "unit"). La Qty y el target price de la hoja se expresan en esta unidad — si el análisis recomienda comprar cajas, la unidad es la caja con su contenido detallado, jamás dejar que el proveedor adivine.',
          },
        },
      },
    },
  },
}

const SYSTEM_RFQ = `Preparas una hoja de cotización (RFQ) para proveedores chinos a partir de recomendaciones de un analista de e-commerce.

Para cada ítem entrega nicho y producto en inglés comercial (como se busca en Alibaba/1688) y una especificación LIMPIA: solo los atributos físicos y técnicos que el proveedor necesita para cotizar — potencia, medidas, capacidad, materiales, accesorios incluidos, enchufe 220V Chile si es eléctrico, empaque. NADA de contexto de mercado, precios, marcas de competidores ni consejos de validación. TODO en inglés al 100%: ni una palabra en español en nicho, producto o especificación (el proveedor no lee español). Corto, directo, cotizable.

UNIDAD DE PEDIDO: cada ítem declara unidadPedido — la unidad física en que se pide y cotiza, con su contenido explícito. En productos que se venden por bulto (cajas, packs, sets) la cantidad y el precio SIEMPRE se malinterpretan si la unidad no está escrita: "650" sin unidad puede ser bolsas, packs o cajas. Sé quirúrgico.

DETECCIÓN DE COMPRA DUPLICADA: recibes todos los nichos juntos a propósito. Si dos o más nichos se surten con el mismo producto físico de fábrica (distintas keywords de venta en Mercado Libre, un solo ítem que comprar en China), asígnales exactamente la misma productoClave — así el sistema los fusiona en una sola línea de cotización. Sé estricto: misma clave solo si un mismo pedido de fábrica sirve para ambos listings.`

// Eco robusto: el LLM a veces devuelve la keyword con tildes o mayúsculas
// distintas. Si el eco no calza, el nicho quedaría "pendiente" para siempre y
// CADA arranque regeneraría el tablero completo (fuga de plata silenciosa).
const sinTilde = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
export const ecoKeyword = (k) => sinTilde(k).trim().toLowerCase()
export const claveRespaldo = (k) =>
  sinTilde(k)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export async function generarRfqPendientes() {
  const nichos = await Nicho.find({ estado: 'activo' }).lean()

  // todos los nichos con veredicto de entrada; pendiente = sin rfq, rfq más
  // viejo que el análisis, o sin productoClave (feature nueva)
  const candidatos = []
  let hayPendientes = false
  for (const n of nichos) {
    const rep = await Reporte.findOne({ nichoId: n._id, analisis: { $ne: null } })
      .sort({ fecha: -1 })
      .select('analisis fecha')
      .lean()
    const analisis = rep?.analisis
    if (!analisis || analisis.veredicto === 'no_entrar') continue
    const fechaAnalisis = new Date(analisis.generadoEl ?? rep.fecha)
    const vigente =
      n.rfq?.desdeAnalisis &&
      n.rfq?.productoClave &&
      n.rfq?.unidadPedido &&
      new Date(n.rfq.desdeAnalisis).getTime() >= fechaAnalisis.getTime()
    if (!vigente) hayPendientes = true
    candidatos.push({ nicho: n, analisis, fechaAnalisis })
  }
  if (!hayPendientes || !candidatos.length) return { generados: 0, costoUsd: 0 }

  // se mandan TODOS juntos (no solo los pendientes): la detección de compra
  // duplicada necesita ver el tablero completo para asignar claves consistentes
  const pendientes = candidatos
  const user = `Ítems a preparar (uno por nicho; detecta compras duplicadas entre ellos):\n${JSON.stringify(
    pendientes.map((p) => ({
      keyword: p.nicho.keyword,
      titular: p.analisis.recomendacion?.titular ?? null,
      segmento: p.analisis.recomendacion?.segmento ?? null,
      especificacionOriginal: p.analisis.recomendacion?.especificacionProducto ?? null,
      // el pedido de prueba del análisis nombra la unidad real ("300-500 cajas")
      pedidoDePrueba: p.analisis.recomendacion?.primeraCompra ?? null,
    })),
    null,
    1,
  )}`

  // el tablero completo con specs + unidad supera cómodo los 6k tokens de
  // salida cuando hay ~40 nichos: techo holgado o la respuesta llega truncada
  const { datos, costoUsd } = await pedirJSON({ system: SYSTEM_RFQ, user, schema: SCHEMA_RFQ, maxTokens: 16000 })
  const porKeyword = new Map(datos.items.map((i) => [ecoKeyword(i.keyword), i]))

  let generados = 0
  let sinEco = 0
  for (const p of pendientes) {
    const item = porKeyword.get(ecoKeyword(p.nicho.keyword))
    const rec = p.analisis.recomendacion ?? {}
    // una clave fijada A MANO (unir/separar compras en la planilla) manda por
    // sobre el juicio del LLM y sobrevive a cualquier regeneración
    const claveManual = p.nicho.rfq?.claveManual === true
    const clavePropia = (sugerida) =>
      claveManual ? p.nicho.rfq.productoClave : sugerida?.trim() || claveRespaldo(p.nicho.keyword)
    // sin eco del LLM: caer a lo que traiga el análisis, con clave de respaldo
    // — el nicho sale igual del estado pendiente y el bucle no puede ocurrir
    const rfq = item
      ? {
          nichoIngles: item.nicho,
          productoIngles: item.producto,
          especificacion: item.especificacion,
          productoClave: clavePropia(item.productoClave),
          unidadPedido: item.unidadPedido?.trim() || 'unit',
          desdeAnalisis: p.fechaAnalisis,
          generadoEl: new Date(),
          ...(claveManual ? { claveManual: true } : {}),
        }
      : {
          nichoIngles: p.analisis.nichoIngles ?? null,
          productoIngles: rec.productoIngles ?? null,
          especificacion: rec.especificacionProducto ?? null,
          productoClave: clavePropia(null),
          unidadPedido: 'unit',
          desdeAnalisis: p.fechaAnalisis,
          generadoEl: new Date(),
          sinEco: true,
          ...(claveManual ? { claveManual: true } : {}),
        }
    if (!item) sinEco++
    await Nicho.updateOne({ _id: p.nicho._id }, { $set: { rfq } })
    generados++
  }
  if (sinEco) console.warn(`[rfq] ${sinEco} nicho(s) sin eco del LLM — guardados con respaldo del análisis`)

  const { registrarGasto } = await import('./gastos.js')
  await registrarGasto(pendientes[0].nicho._id, costoUsd)

  return { generados, costoUsd, sinEco }
}
