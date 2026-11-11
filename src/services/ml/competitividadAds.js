// LO QUE ML DICE QUE CADA CAMPAÑA DEJA DE MOSTRAR, Y POR QUÉ (11-nov-2026).
//
// Pedido del importador: «revisa si la API de Mercado Libre tiene mejores
// endpoints». La documentación de Chile de Product Ads publica, en el detalle
// de cada campaña, qué parte de las subastas en que pudo aparecer ganó
// (`impression_share`), qué parte perdió porque se le acabó el presupuesto del
// día (`lost_impression_share_by_budget`) y qué parte perdió porque otros
// anuncios le ganaron (`lost_impression_share_by_ad_rank`). Medido ese día en
// las campañas de la cuenta: son fracciones y las tres suman 1.
//
// Hasta acá, «¿le falta presupuesto?» se deducía de cuánto del presupuesto se
// gastaba. Esto lo responde ML directamente y separa los dos frenos, que piden
// cosas distintas: al que pierde por presupuesto le sirve más presupuesto; al
// que pierde por ranking, no.
//
// La condición del importador: «siempre que valga la pena a nosotros». Por eso
// nada de acá recomienda gastar más por su cuenta. Lo que decide es la plata
// (revisarCampana). Esto solo quita un «subir» que no traería ninguna venta y
// deja el dato al lado de la recomendación.

export const UMBRALES_COMPETITIVIDAD = {
  presupuesto: 0.2, // desde acá el presupuesto es un freno que se nota
  sinFreno: 0.05, // bajo esto, el presupuesto no está frenando nada
  ranking: 0.5, // desde acá el freno principal es el ranking
  minImpresiones: 500, // con menos, las fracciones son de muy pocas subastas
}

const numero = (x) => (Number.isFinite(x) ? x : null)
const pct = (x) => Math.round(x * 100)
const plata = (n) => `$${Math.round(n).toLocaleString('es-CL')}`

// Pura. De las métricas crudas de ML a fracciones con nombre. Devuelve null si
// la campaña no participó en subastas en el período (ML trae todo en cero).
export function leerCompetitividad(metricas) {
  const m = metricas ?? {}
  const mostrado = numero(m.impression_share)
  const perdidoPresupuesto = numero(m.lost_impression_share_by_budget) ?? 0
  const perdidoRanking = numero(m.lost_impression_share_by_ad_rank) ?? 0
  if (mostrado == null || !(mostrado + perdidoPresupuesto + perdidoRanking > 0)) return null
  const acos = numero(m.acos_benchmark)
  return {
    mostrado,
    perdidoPresupuesto,
    perdidoRanking,
    // de las subastas en que pudo salir en las primeras posiciones, las que ganó (ML lo entrega en porcentaje)
    arribaPct: numero(m.top_impression_share),
    // el ROAS objetivo que usan los anuncios a los que les va bien en lo mismo (ML entrega el ACOS, en porcentaje)
    roasReferencia: acos > 0 ? Math.round((100 / acos) * 10) / 10 : null,
    impresiones: numero(m.prints),
  }
}

// Pura. Cuál es el freno de la campaña y cómo se dice en una línea. No recomienda gasto.
//
// Los textos van en palabras de todos los días, contando «de cada 100 veces». La primera versión hablaba de
// «apariciones» y «ranking» y el importador no la entendió: «no entiendo qué quiere decir que esté verde o naranjo».
export function describirCompetitividad(c) {
  if (!c) return null
  const U = UMBRALES_COMPETITIVIDAD
  const salio = pct(c.mostrado), sinPresupuesto = pct(c.perdidoPresupuesto), leGanaron = pct(c.perdidoRanking)
  if (c.perdidoPresupuesto >= U.presupuesto) {
    return { freno: 'presupuesto', texto: `De cada 100 veces que el anuncio pudo salir, en ${sinPresupuesto} no salió porque ya se había gastado el presupuesto del día${c.perdidoRanking >= U.presupuesto ? ` y en ${leGanaron} porque otro anuncio le ganó el lugar` : ''}.` }
  }
  if (c.perdidoRanking >= U.ranking) {
    return { freno: 'ranking', texto: `De cada 100 veces que el anuncio pudo salir, en ${leGanaron} otro anuncio le ganó el lugar. ${c.perdidoPresupuesto < U.sinFreno ? 'El presupuesto alcanza: subirlo no cambiaría nada.' : `Por falta de presupuesto dejó de salir en ${sinPresupuesto}.`}` }
  }
  return { freno: 'ninguno', texto: `El anuncio sale en ${salio} de cada 100 veces que puede salir${c.perdidoRanking > 0 ? `; en ${leGanaron} otro anuncio le gana el lugar` : ''}${c.perdidoPresupuesto >= U.sinFreno ? ` y en ${sinPresupuesto} se queda sin presupuesto` : ''}.` }
}

// Pura. Cruza la recomendación del plan (ya decidida con la plata) con el dato
// de ML. Devuelve solo lo que cambia en la fila del producto.
export function ajustarPorCompetitividad(fila, c) {
  if (!c) return {}
  const U = UMBRALES_COMPETITIVIDAD
  const salida = { competitividad: c }
  // con pocas subastas el dato se muestra, pero no cambia una recomendación
  if (!(c.impresiones >= U.minImpresiones)) return salida
  const resultado = fila?.metricas?.resultado7
  if (fila?.accion === 'subir') {
    if (c.perdidoPresupuesto < U.sinFreno) {
      // el plan quería subir porque deja plata, pero ML dice que no hay subastas que se pierdan por presupuesto:
      // más presupuesto quedaría sin gastar
      const actual = fila.metricas?.gastoDiario ?? fila.budgetDiario ?? null
      return {
        ...salida,
        accion: 'mantener',
        budgetDiario: actual,
        texto: `${Number.isFinite(resultado) ? `Deja plata (${plata(resultado)} en 7 días), pero subir` : 'Subir'} el presupuesto no traería más venta: según Mercado Libre el presupuesto de hoy alcanza y el anuncio nunca deja de salir por eso${c.perdidoRanking >= U.presupuesto ? ` (en ${pct(c.perdidoRanking)} de cada 100 veces lo que pasa es que otro anuncio le gana el lugar)` : ''}. Mantén${actual != null ? ` ${plata(actual)}/día` : ''}.`,
      }
    }
    if (c.perdidoPresupuesto >= U.presupuesto) {
      return { ...salida, texto: `${fila.texto} Mercado Libre lo confirma: de cada 100 veces que el anuncio pudo salir, en ${pct(c.perdidoPresupuesto)} no salió porque ya se había gastado el presupuesto del día.` }
    }
    return salida
  }
  // deja plata y el plan no sube (no hay aire en el margen): el dato va al lado, sin empujar a gastar
  if (fila?.accion === 'mantener' && Number.isFinite(resultado) && resultado >= 0 && c.perdidoPresupuesto >= U.presupuesto) {
    return { ...salida, texto: `${fila.texto} Dato de Mercado Libre: en ${pct(c.perdidoPresupuesto)} de cada 100 veces el anuncio no sale porque ya se gastó el presupuesto del día.` }
  }
  return salida
}
