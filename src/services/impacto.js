// Lupa de cambios: qué se le hizo a cada publicación y si sirvió.
// Cada intervención (título editado a mano, descripción o ficha aplicadas por
// API) se cruza con la serie de mediciones para responder lo único que importa:
// ¿subieron las visitas y las ventas después de esto?
//
// Cuidado metodológico: `visitas` es la ventana móvil de 7 días de ML, así que
// durante la primera semana post-cambio la cifra todavía arrastra días viejos.
// Hasta que pasen 7 días el veredicto es "midiendo", no un número inventado.

const DIAS_VENTANA = 7

const num = (v) => (Number.isFinite(v) ? v : null)

export function intervencionesDe(propio) {
  const lista = []
  for (const h of propio.historialTitulos ?? []) {
    if (!h?.fecha) continue
    lista.push({ tipo: 'titulo', fecha: new Date(h.fecha), anterior: h.anterior ?? null, nuevo: h.nuevo ?? null })
  }
  for (const h of propio.historialLogistica ?? []) {
    if (!h?.fecha) continue
    lista.push({ tipo: 'logistica', fecha: new Date(h.fecha), anterior: h.anterior ?? null, nuevo: h.nuevo ?? null })
  }
  for (const a of propio.auditoria?.aplicado ?? []) {
    if (!a?.fecha) continue
    lista.push({ tipo: a.campo, fecha: new Date(a.fecha), nuevo: a.valor ?? null })
  }
  return lista.sort((a, b) => a.fecha - b.fecha)
}

// Promedio de un campo en las mediciones de una ventana [desde, hasta)
function promedio(mediciones, campo, desde, hasta) {
  const valores = mediciones
    .filter((m) => {
      const t = new Date(m.fecha).getTime()
      return t >= desde && t < hasta && Number.isFinite(m[campo])
    })
    .map((m) => m[campo])
  if (!valores.length) return null
  return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10
}

// Ventas del período: delta del acumulado `vendidos`; si la cuenta no lo
// entrega, delta de reseñas (la señal de demanda del proyecto)
function ventasEntre(mediciones, desde, hasta) {
  const dentro = mediciones.filter((m) => {
    const t = new Date(m.fecha).getTime()
    return t >= desde && t < hasta
  })
  const conVendidos = dentro.filter((m) => Number.isFinite(m.vendidos))
  if (conVendidos.length >= 2) {
    return { valor: conVendidos[conVendidos.length - 1].vendidos - conVendidos[0].vendidos, fuente: 'ventas reales' }
  }
  const conReviews = dentro.filter((m) => Number.isFinite(m.numReviews))
  if (conReviews.length >= 2) {
    return { valor: conReviews[conReviews.length - 1].numReviews - conReviews[0].numReviews, fuente: 'reseñas nuevas' }
  }
  return { valor: null, fuente: null }
}

export function evaluarImpacto(propio, { ahora = new Date(), diasVentana = DIAS_VENTANA } = {}) {
  const mediciones = propio.mediciones ?? []
  const intervenciones = intervencionesDe(propio)
  if (!intervenciones.length) return { intervenciones: [], resumen: null }

  const ventanaMs = diasVentana * 86400e3
  const evaluadas = intervenciones.map((it, i) => {
    const corte = it.fecha.getTime()
    const finDespues = Math.min(ahora.getTime(), intervenciones[i + 1]?.fecha.getTime() ?? Infinity)
    const diasTranscurridos = Math.floor((finDespues - corte) / 86400e3)

    const visitasAntes = promedio(mediciones, 'visitas', corte - ventanaMs, corte)
    // la ventana móvil de ML necesita 7 días limpios para no mezclar
    const visitasDespues = diasTranscurridos >= diasVentana ? promedio(mediciones, 'visitas', corte + ventanaMs, finDespues) : null
    const ventasAntes = ventasEntre(mediciones, corte - ventanaMs, corte)
    const ventasDespues = ventasEntre(mediciones, corte, finDespues)

    let veredicto = 'midiendo'
    let delta = null
    if (num(visitasAntes) !== null && num(visitasDespues) !== null) {
      delta = visitasDespues - visitasAntes
      const base = Math.max(visitasAntes, 1)
      if (delta / base >= 0.2) veredicto = 'mejoró'
      else if (delta / base <= -0.2) veredicto = 'empeoró'
      else veredicto = 'sin cambio'
    }
    // ventas reales mandan sobre visitas cuando las hay: el objetivo del cambio
    // es vender, no traer clicks — visitas planas con ventas subiendo es mejora
    const conVentasReales =
      veredicto !== 'midiendo' &&
      ventasAntes.fuente === 'ventas reales' &&
      ventasDespues.fuente === 'ventas reales' &&
      ventasAntes.valor !== null &&
      ventasDespues.valor !== null &&
      (ventasAntes.valor > 0 || ventasDespues.valor > 0)
    if (conVentasReales && ventasDespues.valor !== ventasAntes.valor) {
      veredicto = ventasDespues.valor > ventasAntes.valor ? 'mejoró' : 'empeoró'
    }
    return {
      tipo: it.tipo,
      fecha: it.fecha,
      anterior: it.anterior ?? undefined,
      nuevo: it.nuevo ?? undefined,
      diasTranscurridos,
      visitasAntes,
      visitasDespues,
      deltaVisitas: delta,
      ventasAntes: ventasAntes.valor,
      ventasDespues: ventasDespues.valor,
      fuenteVentas: ventasDespues.fuente ?? ventasAntes.fuente,
      veredicto,
      // texto corto listo para mostrar y para que el auditor lo lea
      lectura:
        veredicto === 'midiendo'
          ? `aplicado hace ${diasTranscurridos} día(s): faltan ${Math.max(0, diasVentana - diasTranscurridos)} para leer el efecto`
          : conVentasReales
            ? `ventas ${ventasAntes.valor} → ${ventasDespues.valor} · visitas ${visitasAntes} → ${visitasDespues}`
            : `visitas ${visitasAntes} → ${visitasDespues} (${delta > 0 ? '+' : ''}${delta})`,
    }
  })

  const concluyentes = evaluadas.filter((e) => e.veredicto !== 'midiendo')
  const resumen = concluyentes.length
    ? {
        cambios: evaluadas.length,
        mejoraron: concluyentes.filter((e) => e.veredicto === 'mejoró').length,
        empeoraron: concluyentes.filter((e) => e.veredicto === 'empeoró').length,
        ultimo: concluyentes[concluyentes.length - 1],
      }
    : { cambios: evaluadas.length, midiendo: true }

  return { intervenciones: evaluadas, resumen }
}
