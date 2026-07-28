import { meliPut, meliPost, hayCuentaMeli } from './meli.js'

// Aplica en Mercado Libre (API oficial, scope Publicación) los arreglos que la
// auditoría propuso: título y/o descripción del item PROPIO. Cada campo se
// intenta por separado y el resultado se reporta campo a campo — ML puede
// rechazar el título (item de catálogo, con ventas) y aceptar la descripción.

const PLACEHOLDER = /\[[^\]]{0,60}\]|X{3,}|__+/

export function tienePlaceholder(texto) {
  return PLACEHOLDER.test(String(texto ?? ''))
}

export async function aplicarCambiosPropio(propio, { titulo, descripcion }) {
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
      const r = await meliPut(`/items/${idMl}`, { title: titulo.trim() })
      resultado.titulo = { ok: true, valor: r.title ?? titulo.trim() }
      propio.titulo = r.title ?? titulo.trim()
      aplicados.push({ campo: 'titulo', valor: propio.titulo, fecha: new Date() })
    } catch (err) {
      resultado.titulo = { ok: false, error: err.message }
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
