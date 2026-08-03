import { meliGet, meliPost, meliPut, hayCuentaMeli } from './meli.js'
import { ProductoPropio } from '../models/ProductoPropio.js'

// Crea una publicación NUEVA en ML desde un borrador de listing. A diferencia
// de editar (family_name bloqueado por ML, error 374), POST /items acepta el
// título libre. Nace PAUSADA por defecto: queda lista con título/descripción/
// ficha perfectos para activarla cuando llegue el stock.
export async function publicarEnMl({
  titulo,
  descripcion = null,
  precioClp,
  stock = 1,
  imagenes = [],
  atributos = [],
  categoriaId = null,
  categoriaDebeContener = null,
  tipoPublicacion = 'gold_special',
  pausada = true,
  nichoId = null,
}) {
  if (!(await hayCuentaMeli())) throw new Error('sin cuenta ML conectada')
  if (!titulo?.trim() || !Number.isFinite(precioClp) || !imagenes.length) {
    throw new Error('titulo, precioClp e imagenes[] son obligatorios')
  }

  // categoría: explícita, o predicha por ML — con candado opcional de familia
  // (ej: "cuidado" exige que la ruta contenga Cuidado Personal)
  let categoria = categoriaId
  if (!categoria) {
    const pred = await meliGet(`/sites/MLC/domain_discovery/search?q=${encodeURIComponent(titulo)}&limit=3`)
    if (!pred?.[0]?.category_id) throw new Error('el predictor de categoría no devolvió nada: pasa categoriaId explícita')
    categoria = pred[0].category_id
  }
  const cat = await meliGet(`/categories/${categoria}`)
  const rutaCategoria = (cat?.path_from_root ?? []).map((c) => c.name).join(' > ')
  if (categoriaDebeContener && !rutaCategoria.toLowerCase().includes(categoriaDebeContener.toLowerCase())) {
    throw new Error(`categoría "${rutaCategoria}" no contiene "${categoriaDebeContener}" — revisa o pasa categoriaId explícita`)
  }

  // cuentas en flujo user-products (como CAMBSTORE) exigen family_name en vez
  // de title al crear (error 369 body.required_fields si falta)
  const item = await meliPost('/items', {
    family_name: titulo.trim(),
    category_id: categoria,
    price: Math.round(precioClp),
    currency_id: 'CLP',
    available_quantity: stock,
    buying_mode: 'buy_it_now',
    condition: 'new',
    listing_type_id: tipoPublicacion,
    pictures: imagenes.map((url) => ({ source: url })),
    attributes: atributos,
  })

  if (descripcion) {
    // items nuevos aceptan POST; si ML ya le creó una vacía, cae al PUT
    try {
      await meliPost(`/items/${item.id}/description`, { plain_text: descripcion })
    } catch {
      await meliPut(`/items/${item.id}/description`, { plain_text: descripcion })
    }
  }
  if (pausada) await meliPut(`/items/${item.id}`, { status: 'paused' })

  // el nuevo item entra solo a Mis productos (ciclo de 45 min lo mide al tiro)
  const propio = await ProductoPropio.findOneAndUpdate(
    { sku: item.id },
    {
      $setOnInsert: { sku: item.id, url: item.permalink, titulo: item.title },
      $set: { nichoId },
    },
    { upsert: true, new: true },
  )

  return {
    itemId: item.id,
    permalink: item.permalink,
    categoria: rutaCategoria,
    estado: pausada ? 'paused' : item.status,
    propioId: propio._id,
  }
}
