// Comparador de cartera propia dentro de un nicho. Cuando ya vendes, tu mejor
// maestro no es la competencia: son tus propios productos. Dos SKUs hermanos
// con el mismo precio y distinta conversión son un A/B natural que aísla qué
// funciona — el sistema audita cada listing por separado y se pierde eso.
//
// Diagnóstico por producto: mucho tráfico + poca conversión = problema de
// CIERRE (fotos, ficha, precio); poco tráfico + buena conversión = problema de
// EXPOSICIÓN (título, keywords, Full, ads). El trasplante entre hermanos es la
// acción más barata que existe: ya sabes que funciona en tu propia cuenta.

const pct = (n) => Math.round(n * 10) / 10

export function compararCartera(productos, { demandaNichoDia = null } = {}) {
  const filas = productos
    .map((p) => ({
      sku: p.sku,
      titulo: p.titulo ?? p.sku,
      visitas: Number.isFinite(p.visitas7d) ? p.visitas7d : null,
      ventas: Number.isFinite(p.ventas7d) ? p.ventas7d : null,
      precio: Number.isFinite(p.precioEfectivo) ? p.precioEfectivo : null,
      conversion: Number.isFinite(p.conversion7d) ? p.conversion7d : null,
      esFull: p.esFull ?? null,
    }))
    .filter((f) => f.visitas != null || f.ventas != null)
  if (filas.length < 2) return null

  const conConversion = filas.filter((f) => f.conversion != null)
  const conVisitas = filas.filter((f) => f.visitas != null)
  const mejorCierre = conConversion.length ? conConversion.reduce((a, b) => (b.conversion > a.conversion ? b : a)) : null
  const mejorTrafico = conVisitas.length ? conVisitas.reduce((a, b) => (b.visitas > a.visitas ? b : a)) : null

  const lecciones = []
  // 1. trasplante cruzado: el que convierte mejor no es el que más tráfico trae
  if (mejorCierre && mejorTrafico && mejorCierre.sku !== mejorTrafico.sku) {
    const ventaja = mejorTrafico.conversion ? pct((mejorCierre.conversion / mejorTrafico.conversion - 1) * 100) : null
    lecciones.push({
      tipo: 'trasplante',
      texto:
        `"${mejorCierre.titulo}" convierte ${mejorCierre.conversion}%` +
        (ventaja ? ` (${ventaja}% mejor que "${mejorTrafico.titulo}")` : '') +
        ` con ${mejorCierre.visitas} visitas vs ${mejorTrafico.visitas}: copia SU página (fotos, ficha, descripción) al de más tráfico, y el TÍTULO del de más tráfico al que convierte mejor.`,
    })
  }
  // 2. diagnóstico por producto contra el promedio de la cartera
  const promConv = conConversion.length
    ? conConversion.reduce((s, f) => s + f.conversion, 0) / conConversion.length
    : null
  const promVis = conVisitas.length ? conVisitas.reduce((s, f) => s + f.visitas, 0) / conVisitas.length : null
  for (const f of filas) {
    if (f.conversion == null || f.visitas == null || promConv == null) continue
    if (f.visitas > promVis * 1.2 && f.conversion < promConv * 0.85) {
      lecciones.push({
        tipo: 'cierre',
        sku: f.sku,
        texto: `"${f.titulo}": trae el tráfico (${f.visitas} visitas) pero cierra peor que tus otros (${f.conversion}% vs ${pct(promConv)}% promedio) — el problema está en la página, no en la exposición.`,
      })
    } else if (f.visitas < promVis * 0.8 && f.conversion > promConv * 1.15) {
      lecciones.push({
        tipo: 'exposicion',
        sku: f.sku,
        texto: `"${f.titulo}": el que mejor convierte (${f.conversion}%) es el que menos ven (${f.visitas} visitas) — su techo está en exposición: título, Full y ads.`,
      })
    }
  }
  // 3. mismo precio, distinta conversión → la diferencia no es el precio
  const precios = new Set(filas.map((f) => f.precio).filter(Boolean))
  if (precios.size === 1 && conConversion.length >= 2) {
    const spread = Math.max(...conConversion.map((f) => f.conversion)) - Math.min(...conConversion.map((f) => f.conversion))
    if (spread >= 2) {
      lecciones.push({
        tipo: 'no-es-precio',
        texto: `Todos a ${[...precios][0]} y la conversión va de ${Math.min(...conConversion.map((f) => f.conversion))}% a ${Math.max(...conConversion.map((f) => f.conversion))}%: la diferencia NO es el precio, es la página.`,
      })
    }
  }

  const ventasDia = filas.reduce((s, f) => s + (f.ventas ?? 0), 0) / 7
  return {
    productos: filas.sort((a, b) => (b.conversion ?? -1) - (a.conversion ?? -1)),
    ventasDia: pct(ventasDia),
    // cuota del nicho: qué parte de la demanda medida capturas
    sharePct: demandaNichoDia > 0 ? pct((ventasDia / demandaNichoDia) * 100) : null,
    demandaNichoDia,
    lecciones,
  }
}
