import { config } from '../config/env.js'
import { Nicho } from '../models/Nicho.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { pedirJSON, llmDisponible } from './llm.js'
import { posicionesRecientes } from './propios.js'
import { keywordReal, palabrasClave } from './busquedasReales.js'
import { encolarScanNicho } from '../jobs/queues.js'
import { registrarGasto, gastoDelMes } from './gastos.js'

// Cableado automático propio → nicho, en escalera de costo:
// 1) el producto ya rankea en un listado trackeado → ese nicho, gratis
// 2) el LLM deriva la búsqueda desde el título (una llamada para todos),
//    keywordReal la canoniza a lo que la gente escribe de verdad, y se calza
//    contra los nichos existentes
// 3) sin calce → se CREA el nicho y se encola su primer scan (gasto de actor
//    recurrente: respeta el techo de presupuesto)

// Match tolerante: exacto primero; si no, contención de raíces en cualquier
// dirección ("panel solar" calza con "panel solar 100w"; "carpa" con "carpa
// camping 4 personas").
export function nichoQueCalza(nichos, keyword) {
  const exacto = nichos.find((n) => n.keyword === keyword)
  if (exacto) return exacto
  const objetivo = palabrasClave(keyword)
  if (!objetivo.size) return null
  return (
    nichos.find((n) => {
      const propias = palabrasClave(n.keyword)
      if (!propias.size) return false
      const chicas = propias.size <= objetivo.size ? propias : objetivo
      const grandes = propias.size <= objetivo.size ? objetivo : propias
      return [...chicas].every((p) => grandes.has(p))
    }) ?? null
  )
}

const SCHEMA_KEYWORDS = {
  type: 'object',
  additionalProperties: false,
  required: ['keywords'],
  properties: {
    keywords: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sku', 'keyword'],
        properties: {
          sku: { type: 'string' },
          keyword: {
            type: 'string',
            description: 'La búsqueda de 2-4 palabras, en minúsculas, que un comprador escribiría en ML para encontrar este producto',
          },
        },
      },
    },
  },
}

const SYSTEM_CABLEADOR = `Eres experto en el buscador de Mercado Libre Chile. Para cada producto te paso el título de mi publicación Y su foto principal; devuelve la búsqueda EXACTA (2-4 palabras, minúsculas, sin tildes opcional) que un comprador chileno escribiría para encontrarlo — la keyword del NICHO, no el título recortado: sin marca (salvo que la marca sea lo que se busca), sin atributos secundarios (color, pack, modelo).

MIRA LA FOTO antes que el título: el título puede estar mal puesto y la foto no miente. Decide qué ES el producto de verdad y cuál es la búsqueda de MAYOR volumen donde compite de igual a igual (ej: una pistola de juguete que trae diana y pinos compite en "pistola juguete" o "pistola dardos", no en "tiro al blanco"; el accesorio no define el nicho, lo define el producto principal que se ve en la foto).

Te paso también los NICHOS EXISTENTES del tablero: si el producto pertenece a uno de ellos, responde EXACTAMENTE esa keyword (para reusarlo en vez de crear uno duplicado).`

// El autosuggest puede estar bloqueado (timeouts de 10 s por consulta): la
// canonización no puede colgar la respuesta HTTP — pasado el tope se usa la ideada.
async function canonizarConTope(ideada, ms = 8000) {
  try {
    const real = await Promise.race([
      keywordReal(ideada),
      new Promise((resolver) => setTimeout(() => resolver(null), ms)),
    ])
    return real?.keyword ?? ideada
  } catch {
    return ideada
  }
}

export async function cablearPropiosAuto() {
  const propios = await ProductoPropio.find({ estado: 'activo' })
  const pendientes = propios.filter((p) => !p.nichoId)
  if (!pendientes.length) {
    return { resultados: [], omitido: true, motivo: 'todos los productos activos ya tienen nicho cableado' }
  }

  const nichos = await Nicho.find().select('keyword').lean()
  const resultados = []

  // 1) señal gratis y fuerte: el producto ya aparece en un listado trackeado
  const posiciones = await posicionesRecientes(pendientes.flatMap((p) => [p.sku, p.itemIdMl].filter(Boolean)))
  const sinSenal = []
  for (const p of pendientes) {
    const pos = posiciones.get(p.sku) ?? (p.itemIdMl ? posiciones.get(p.itemIdMl) : null)
    const nicho = pos ? nichos.find((n) => n.keyword === pos.keyword) : null
    if (nicho) {
      p.nichoId = nicho._id
      await p.save()
      resultados.push({ sku: p.sku, titulo: p.titulo ?? null, accion: 'rankea', keyword: nicho.keyword })
    } else {
      sinSenal.push(p)
    }
  }

  // 2) el resto necesita título (para derivar la búsqueda) e IA disponible
  const conTitulo = []
  for (const p of sinSenal) {
    if (p.titulo) conTitulo.push(p)
    else resultados.push({ sku: p.sku, titulo: null, accion: 'sin-titulo' })
  }
  if (!conTitulo.length) return { resultados }
  if (!llmDisponible()) {
    for (const p of conTitulo) resultados.push({ sku: p.sku, titulo: p.titulo, accion: 'sin-ia' })
    return { resultados }
  }

  // la foto principal de cada producto va como imagen real: el modelo decide
  // por lo que VE, no por un título que puede estar mal puesto
  const bloques = [
    {
      type: 'text',
      text: JSON.stringify({
        nichosExistentes: nichos.map((n) => n.keyword),
        productos: conTitulo.map((p) => ({ sku: p.sku, titulo: p.titulo })),
      }),
    },
  ]
  for (const p of conTitulo) {
    if (typeof p.imagen === 'string' && p.imagen.startsWith('http')) {
      bloques.push({ type: 'text', text: `FOTO DE ${p.sku}:` })
      bloques.push({ type: 'image', source: { type: 'url', url: p.imagen } })
    }
  }

  let llm
  try {
    llm = await pedirJSON({ system: SYSTEM_CABLEADOR, user: bloques, schema: SCHEMA_KEYWORDS, maxTokens: 2000 })
  } catch (err) {
    // una URL de imagen rechazada no debe botar el cableado: reintento solo texto
    if (bloques.length === 1) throw err
    console.warn(`[cableador] llamada con fotos falló (${err.message}): reintentando solo texto`)
    llm = await pedirJSON({ system: SYSTEM_CABLEADOR, user: bloques.slice(0, 1), schema: SCHEMA_KEYWORDS, maxTokens: 2000 })
  }
  const { datos, costoUsd } = llm
  await registrarGasto(null, costoUsd)
  const keywordPorSku = new Map((datos.keywords ?? []).map((k) => [k.sku, k.keyword]))

  for (const p of conTitulo) {
    const ideada = String(keywordPorSku.get(p.sku) ?? '').trim().toLowerCase()
    if (ideada.length < 2) {
      resultados.push({ sku: p.sku, titulo: p.titulo, accion: 'sin-keyword' })
      continue
    }
    const keyword = await canonizarConTope(ideada)

    const existente = nichoQueCalza(nichos, keyword)
    if (existente) {
      p.nichoId = existente._id
      await p.save()
      resultados.push({ sku: p.sku, titulo: p.titulo, accion: 'existente', keyword: existente.keyword })
      continue
    }

    // crear nicho nuevo = scans recurrentes de actor: respeta el techo mensual
    if ((await gastoDelMes()) >= config.presupuestoUsdMes) {
      resultados.push({ sku: p.sku, titulo: p.titulo, accion: 'presupuesto', keyword })
      continue
    }
    const nicho = await Nicho.create({ keyword, origen: 'manual', frecuenciaScan: 'diario' })
    nichos.push({ _id: nicho._id, keyword: nicho.keyword }) // dos propios pueden caer al mismo nicho nuevo
    await encolarScanNicho(nicho._id, { motivo: 'auto-cableado-propio' })
    p.nichoId = nicho._id
    await p.save()
    resultados.push({ sku: p.sku, titulo: p.titulo, accion: 'creado', keyword })
  }

  return { resultados, costoUsd }
}
