import { config } from '../config/env.js'
import { pedirJSON } from './llm.js'
import { meliGet } from './meli.js'
import { registrarGasto } from './gastos.js'

// Revisor de ficha técnica (las "Características" de la publicación): compara
// los atributos cargados contra lo que la categoría de ML define y contra lo
// que el propio listing evidencia (título, descripción, foto). ML indexa y
// filtra por estos atributos: una ficha coja o contradictoria saca la
// publicación de los filtros donde compran.

const SCHEMA_FICHA = {
  type: 'object',
  additionalProperties: false,
  required: ['diagnostico', 'correcciones', 'faltanSinDato'],
  properties: {
    diagnostico: { type: 'string', description: '2-3 frases: qué está mal o falta en la ficha y qué cuesta en filtros' },
    correcciones: {
      type: 'array',
      description: 'Atributos a escribir (corregidos o nuevos), SOLO con valores respaldados por la evidencia',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'nombre', 'valor', 'razon'],
        properties: {
          id: { type: 'string', description: 'ID del atributo en la categoría, ej BRAND, MODEL' },
          nombre: { type: 'string' },
          valor: { type: 'string', description: 'value_name a escribir' },
          razon: { type: 'string', description: 'Por qué, en 1 frase, citando la evidencia' },
        },
      },
    },
    faltanSinDato: {
      type: 'array',
      description: 'Atributos que la categoría pide y convienen, pero cuyo dato real no está en la evidencia (los llena el vendedor)',
      items: { type: 'string' },
    },
  },
}

const SYSTEM_FICHA = `Eres experto en fichas técnicas de Mercado Libre Chile. Te paso MI publicación (título, descripción, foto y atributos actuales), los atributos que la CATEGORÍA define (con sus IDs y valores permitidos cuando existen) y las fichas de los GANADORES del nicho.

Tu trabajo: dejar la ficha 10/10 para los filtros del buscador.
- CORRIGE atributos con valores erróneos o contradictorios con el resto del listing (ej: "Tipos de cabello: Todo tipo de cabello" cuando es el pelo de la brocha → "Sintético"; cantidad que no calza con el título).
- AGREGA los atributos que la categoría define y los ganadores llenan, cuando el valor se deduce con certeza del título/descripción/foto.
- Marca "Genérica" es válida para producto importado sin marca; Modelo puede ser un nombre corto inventado (regla estándar de importadores) — dilo en la razón.
- Si un valor permitido de la lista calza, usa EXACTAMENTE ese texto.
- JAMÁS inventes datos físicos (medidas, materiales, capacidades) que no estén en la evidencia: eso va en faltanSinDato.
- No propongas cambios en atributos que ya están bien.

Responde en español de Chile.`

const soloUtiles = (atributosCategoria) =>
  (atributosCategoria ?? [])
    .filter((a) => !a?.tags?.hidden && !a?.tags?.read_only && !a?.tags?.inferred && !a?.tags?.variation_attribute)
    .map((a) => ({
      id: a.id,
      nombre: a.name,
      requerido: Boolean(a.tags?.required || a.tags?.catalog_required) || undefined,
      valoresPermitidos: Array.isArray(a.values) && a.values.length
        ? a.values.slice(0, 15).map((v) => v?.name).filter(Boolean)
        : undefined,
    }))

export async function revisarFicha(propio) {
  const idMl = propio.itemIdMl ?? propio.sku
  const item = await meliGet(`/items/${idMl}`)
  const categoria = await meliGet(`/categories/${item.category_id}/attributes`)
  const descripcion = await meliGet(`/items/${idMl}/description`).catch(() => null)

  // fichas de los ganadores de la última auditoría, si existen (mejor contexto)
  const rivales = (propio.auditoria?.competidores ?? []).map((c) => ({
    titulo: c.titulo,
    atributos: c.atributos, // puede venir undefined en auditorías viejas: ok
  }))

  const entrada = {
    miPublicacion: {
      titulo: item.title,
      categoria: item.category_id,
      descripcion: (descripcion?.plain_text ?? '').slice(0, 3000) || null,
      atributosActuales: (item.attributes ?? []).map((a) => ({ id: a.id, nombre: a.name, valor: a.value_name })),
    },
    atributosDeLaCategoria: soloUtiles(categoria),
    fichasDeGanadores: rivales,
  }

  const bloques = [
    { type: 'text', text: `Revisa la ficha de mi publicación:\n\n${JSON.stringify(entrada)}` },
  ]
  const foto = item.pictures?.[0]?.secure_url ?? propio.imagen
  if (typeof foto === 'string' && foto.startsWith('http')) {
    bloques.push({ type: 'text', text: 'FOTO PRINCIPAL DE MI PRODUCTO:' })
    bloques.push({ type: 'image', source: { type: 'url', url: foto } })
  }

  let llm
  try {
    llm = await pedirJSON({
      system: SYSTEM_FICHA,
      user: bloques,
      schema: SCHEMA_FICHA,
      maxTokens: 6000,
      modelo: config.llmModelAnalista,
    })
  } catch (err) {
    if (bloques.length === 1) throw err
    console.warn(`[ficha] llamada con foto falló (${err.message}): reintentando solo texto`)
    llm = await pedirJSON({
      system: SYSTEM_FICHA,
      user: bloques.slice(0, 1),
      schema: SCHEMA_FICHA,
      maxTokens: 6000,
      modelo: config.llmModelAnalista,
    })
  }
  await registrarGasto(propio.nichoId ?? null, llm.costoUsd)

  const ficha = {
    generadoEl: new Date(),
    diagnostico: llm.datos.diagnostico,
    correcciones: llm.datos.correcciones,
    faltanSinDato: llm.datos.faltanSinDato,
    modelo: llm.modelo,
    costoUsd: llm.costoUsd,
  }
  propio.auditoria = { ...(propio.auditoria ?? {}), ficha }
  propio.markModified('auditoria')
  await propio.save()
  return ficha
}
