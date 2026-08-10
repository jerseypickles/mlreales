import { meliGet, meliPut, meliPost, hayCuentaMeli } from './meli.js'

// Aplica en Mercado Libre (API oficial, scope Publicación) los arreglos que la
// auditoría propuso: título y/o descripción del item PROPIO. Cada campo se
// intenta por separado y el resultado se reporta campo a campo — ML puede
// rechazar el título (item de catálogo, con ventas) y aceptar la descripción.

const PLACEHOLDER = /\[[^\]]{0,60}\]|X{3,}|__+/

export function tienePlaceholder(texto) {
  return PLACEHOLDER.test(String(texto ?? ''))
}

// Cambia el PRECIO de una publicación propia. Va aparte de aplicarCambiosPropio
// porque no nace de la auditoría: es una decisión comercial del importador, y
// con el envío de Full escalonado ($829 bajo $9.990, $1.040 hasta $19.989,
// $3.250 desde ahí) mover el precio mueve el margen de forma no lineal.
//
// Sobre una publicación sin stock el cambio igual sirve: ML la reactiva sola
// cuando llega mercadería a Full, y lo hace al precio que esté guardado.
export async function aplicarPrecioPropio(propio, precioClp) {
  if (!(await hayCuentaMeli())) {
    throw Object.assign(new Error('sin cuenta de Mercado Libre conectada'), { status: 503 })
  }
  if (!Number.isFinite(precioClp) || precioClp <= 0 || Math.round(precioClp) !== precioClp) {
    throw Object.assign(new Error('precio inválido: entero en pesos, mayor que 0'), { status: 400 })
  }
  const idMl = propio.itemIdMl ?? propio.sku
  if (!/^MLC\d+$/.test(idMl)) {
    throw Object.assign(
      new Error(`el sku ${idMl} no es un item id de publicación (MLC…): no se puede escribir por la API`),
      { status: 409 },
    )
  }

  const antes = await meliGet(`/items/${idMl}`).catch(() => null)
  const anterior = Number.isFinite(antes?.price) ? antes.price : null
  if (anterior === precioClp) {
    return { ok: true, sinCambio: true, precio: precioClp, estadoMl: antes?.status ?? null }
  }

  const r = await meliPut(`/items/${idMl}`, { price: precioClp })
  const nuevo = Number.isFinite(r?.price) ? r.price : precioClp

  // el historial es la serie que la lupa usa para medir el efecto del cambio:
  // sin registrarlo, la subida de precio queda como un salto sin explicación
  propio.historialPrecios.push({
    fecha: new Date(),
    anterior,
    nuevo,
    motivo: 'cambio de precio desde el tablero',
  })
  if (propio.historialPrecios.length > 20) propio.historialPrecios = propio.historialPrecios.slice(-20)
  await propio.save()

  return {
    ok: true,
    precio: nuevo,
    anterior,
    estadoMl: r?.status ?? antes?.status ?? null,
    // sin stock la publicación sigue pausada: el precio queda listo para
    // cuando ML la reactive, pero hoy nadie la ve
    sinStock: (antes?.available_quantity ?? 0) === 0,
  }
}

export async function aplicarCambiosPropio(propio, { titulo, descripcion, atributos }) {
  if (!(await hayCuentaMeli())) {
    throw Object.assign(new Error('sin cuenta de Mercado Libre conectada'), { status: 503 })
  }
  const idMl = propio.itemIdMl ?? propio.sku
  if (!/^MLC\d+$/.test(idMl)) {
    throw Object.assign(
      new Error(`el sku ${idMl} no es un item id de publicación (MLC…): no se puede escribir por la API`),
      { status: 409 },
    )
  }

  const resultado = {}
  const aplicados = []

  if (titulo !== undefined) {
    if (typeof titulo !== 'string' || !titulo.trim() || titulo.length > 60) {
      throw Object.assign(new Error('titulo inválido (1 a 60 caracteres)'), { status: 400 })
    }
    try {
      let nuevoTitulo
      try {
        const r = await meliPut(`/items/${idMl}`, { title: titulo.trim() })
        nuevoTitulo = r.title ?? titulo.trim()
      } catch (err) {
        // formato "user products" (tag user_product_listing): el título vive en
        // family_name y ML compone el título final agregando el color de la
        // variante — por eso conviene mandar el texto SIN el color al final
        // (la doc: title se mapea a family_name y family_name tiene prioridad)
        const item = await meliGet(`/items/${idMl}`).catch(() => null)
        if (!item?.user_product_id && !item?.family_name) throw err
        const r = await meliPut(`/items/${idMl}`, { family_name: titulo.trim() })
        nuevoTitulo = r.title ?? r.family_name ?? titulo.trim()
      }
      resultado.titulo = { ok: true, valor: nuevoTitulo }
      propio.titulo = nuevoTitulo
      aplicados.push({ campo: 'titulo', valor: propio.titulo, fecha: new Date() })
    } catch (err) {
      // sonda 27-jul: ML rechaza TODA edición de family_name por API en
      // publicaciones user-products con esta app (error 374 incluso con
      // cambios mínimos) — el título se cambia a mano en Seller Central
      const bloqueadoPorMl = /family name is invalid|modify the title/i.test(err.message)
      resultado.titulo = {
        ok: false,
        error: bloqueadoPorMl
          ? 'ML no permite editar el título de publicaciones nuevas (user products) por API: copia el título y pégalo en Seller Central (Publicaciones → Modificar)'
          : err.message,
      }
    }
  }

  if (descripcion !== undefined) {
    if (typeof descripcion !== 'string' || !descripcion.trim()) {
      throw Object.assign(new Error('descripcion inválida'), { status: 400 })
    }
    if (tienePlaceholder(descripcion)) {
      throw Object.assign(
        new Error('la descripción trae un placeholder sin completar (ej: [COMPLETAR…]): rellénalo antes de aplicar'),
        { status: 400 },
      )
    }
    try {
      // PUT modifica una descripción existente; si el item nació sin ella, ML
      // exige POST para crearla
      try {
        await meliPut(`/items/${idMl}/description`, { plain_text: descripcion })
      } catch (err) {
        if (!/404/.test(err.message)) throw err
        await meliPost(`/items/${idMl}/description`, { plain_text: descripcion })
      }
      resultado.descripcion = { ok: true }
      aplicados.push({ campo: 'descripcion', valor: descripcion.slice(0, 200), fecha: new Date() })
    } catch (err) {
      resultado.descripcion = { ok: false, error: err.message }
    }
  }

  if (atributos !== undefined) {
    // ficha técnica: [{id, valor}] → PUT attributes (verificado escribible el
    // 27-jul incluso en publicaciones user-products donde el título no lo es)
    const lista = Array.isArray(atributos)
      ? atributos.filter((a) => a && typeof a.id === 'string' && typeof (a.valor ?? a.value_name) === 'string')
      : []
    if (!lista.length) {
      throw Object.assign(new Error('atributos inválidos: se espera [{id, valor}]'), { status: 400 })
    }
    try {
      await meliPut(`/items/${idMl}`, {
        attributes: lista.map((a) => ({ id: a.id, value_name: a.valor ?? a.value_name })),
      })
      resultado.atributos = { ok: true, cantidad: lista.length }
      aplicados.push({ campo: 'atributos', valor: lista.map((a) => `${a.id}=${a.valor ?? a.value_name}`).join(' · ').slice(0, 300), fecha: new Date() })
    } catch (err) {
      resultado.atributos = { ok: false, error: err.message }
    }
  }

  if (aplicados.length) {
    // rastro en la auditoría: el panel muestra qué ya se aplicó y cuándo
    propio.auditoria = {
      ...(propio.auditoria ?? {}),
      aplicado: [...(propio.auditoria?.aplicado ?? []), ...aplicados],
    }
    propio.markModified('auditoria')
    await propio.save()
  }

  return resultado
}
