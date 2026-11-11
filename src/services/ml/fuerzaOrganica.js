// ¿EL PRODUCTO YA SE VENDE SOLO? (11-nov-2026)
//
// Pedido del importador: «necesitamos que el learning machine indique cuándo un
// producto está fuerte y tal vez no necesite publicidad… posiblemente ya solo se
// vende por review y por estar arriba».
//
// El plan de campañas sabía si la publicidad deja plata, pero no si hacía falta:
// una venta que el comprador habría hecho igual también aparece como venta por
// anuncio. Hay dos formas de saberlo, de la más firme a la más débil:
//
//   1. LA PRUEBA. Días con stock y sin gasto de anuncio (pausa, campaña apagada)
//      contra días con anuncio: cuánto vende por día en cada caso. Es lo único
//      que comprueba algo. Medido ese día en la historia de la cuenta: un
//      producto con buenas reseñas al que se le apagó la publicidad no volvió a
//      vender, y otro siguió vendiendo dos tercios de lo que vendía.
//   2. LA MEZCLA. Lo que Mercado Libre cuenta como venta orgánica contra la
//      venta directa del anuncio, y las visitas que no vienen de un clic pagado.
//      No comprueba nada (la atribución de ML es suya), pero avisa a quién vale
//      la pena hacerle la prueba.
//
// Las reseñas y la posición orgánica son el porqué, no la medida: se muestran
// como contexto. Nada de esto cambia el plan ni toca una campaña; propone la
// prueba y después dice qué pasó.

export const VENTANA_MEZCLA = 28 // días con stock para leer la mezcla
export const VENTANA_PRUEBA = 90 // historia para comparar con y sin anuncio
export const MIN_UNIDADES = 8 // ventas (orgánicas + directas) para leer la mezcla
export const MIN_DIAS_PRUEBA = 7 // días con stock por lado
export const SOLO = 0.7 // sin anuncio vende al menos esto de lo que vendía con anuncio
export const DEPENDE = 0.3
export const MEZCLA_SOLO = 60 // % de ventas y de visitas sin anuncio para proponer la prueba
export const MEZCLA_DEPENDE = 30

const r2 = (x) => Math.round(x * 100) / 100
const suma = (xs, k) => xs.reduce((a, d) => a + (d[k] ?? 0), 0)
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)
const coma = (n) => String(n).replace('.', ',')
const deDiez = (p) => Math.round(p / 10)

// Pura. `dias`: filas diarias desde el primer día con anuncio, en orden:
// { dia, gasto, unidades, organicas, directas, visitas, clicks, stockFraccion }.
// `contexto`: { resenias, nota, posicion } (lo que explica por qué se vendería solo).
export function fuerzaOrganica(dias, { resenias = null, nota = null, posicion = null } = {}) {
  // sin stock no vende, con o sin anuncio: esos días no dicen nada
  const conStock = (dias ?? []).filter((d) => d.stockFraccion == null || d.stockFraccion >= 0.5)
  const contexto = { resenias: Number.isFinite(resenias) ? resenias : null, nota: Number.isFinite(nota) && nota > 0 ? nota : null, posicion: Number.isFinite(posicion) ? posicion : null }
  if (!conStock.length) return { estado: 'sin-datos', base: null, ...contexto, texto: 'Sin días con stock y anuncio para medirlo.' }

  // la mezcla de las últimas semanas
  const m = conStock.slice(-VENTANA_MEZCLA)
  const organicas = suma(m, 'organicas'), directas = suma(m, 'directas'), visitas = suma(m, 'visitas'), clicks = suma(m, 'clicks')
  const ventasMedidas = organicas + directas
  const pctVentasSinAnuncio = pct(organicas, ventasMedidas)
  const pctVisitasSinAnuncio = visitas > 0 ? Math.max(0, 100 - pct(clicks, visitas)) : null
  const mezcla = { dias: m.length, organicas, directas, pctVentasSinAnuncio, visitas, clicks, pctVisitasSinAnuncio }

  // la prueba: días con gasto contra días sin gasto
  const h = conStock.slice(-VENTANA_PRUEBA)
  const con = h.filter((d) => d.gasto > 0), sin = h.filter((d) => !(d.gasto > 0))
  const lado = (xs) => ({ dias: xs.length, ventasDia: xs.length ? r2(suma(xs, 'unidades') / xs.length) : null })
  const prueba = { conAnuncio: lado(con), sinAnuncio: lado(sin) }
  const base = { ...contexto, mezcla, prueba }

  if (con.length >= MIN_DIAS_PRUEBA && sin.length >= MIN_DIAS_PRUEBA) {
    const a = prueba.conAnuncio.ventasDia, b = prueba.sinAnuncio.ventasDia
    const cifras = `Sin anuncio vendió ${coma(b)} al día en ${sin.length} días con stock; con anuncio, ${coma(a)} al día en ${con.length}.`
    if (!(a > 0) && !(b > 0)) return { ...base, estado: 'sin-ventas', base: 'comprobado', texto: `${cifras} No vende de ninguna de las dos formas: el problema no es la publicidad.` }
    const razon = a > 0 ? b / a : Infinity
    prueba.sinVsCon = Number.isFinite(razon) ? r2(razon) : null
    if (razon >= SOLO) return { ...base, estado: 'se-vende-solo', base: 'comprobado', texto: `${cifras} Se vende casi igual sin publicidad: el anuncio le está sobrando.` }
    if (razon <= DEPENDE) return { ...base, estado: 'depende-del-anuncio', base: 'comprobado', texto: `${cifras} Sin publicidad casi no se mueve: todavía la necesita.` }
    return { ...base, estado: 'mixto', base: 'comprobado', texto: `${cifras} Solo vende ${Math.round(razon * 100)}% de lo que vende con anuncio: la publicidad suma, pero no es todo.` }
  }

  if (ventasMedidas < MIN_UNIDADES) {
    return { ...base, estado: 'pocos-datos', base: null,
      texto: `Todavía pocas ventas para saberlo (${ventasMedidas} de ${MIN_UNIDADES}).${ventasMedidas > 0 ? ` Hasta ahora, ${organicas} sin anuncio y ${directas} por el anuncio.` : ''}` }
  }
  const n = deDiez(pctVentasSinAnuncio)
  const ventas = n === 0 ? 'casi ninguna venta llega sin anuncio' : n === 1 ? '1 de cada 10 ventas llega sin anuncio' : `${n} de cada 10 ventas llegan sin anuncio`
  const v = pctVisitasSinAnuncio != null ? deDiez(pctVisitasSinAnuncio) : null
  const visita = v == null ? '' : v === 0 ? ' (y casi ninguna visita)' : ` (visitas: ${v} de cada 10)`
  const mayuscula = (t) => t[0].toUpperCase() + t.slice(1)
  if (pctVentasSinAnuncio >= MEZCLA_SOLO && (pctVisitasSinAnuncio == null || pctVisitasSinAnuncio >= MEZCLA_SOLO)) {
    return { ...base, estado: 'se-vende-solo', base: 'indicio',
      texto: `${mayuscula(ventas)}${visita}. Puede que ya se venda solo: prueba ${MIN_DIAS_PRUEBA} días con la mitad del presupuesto (o en pausa) y mira si la venta total se mantiene. Acá va a quedar el resultado.` }
  }
  if (pctVentasSinAnuncio <= MEZCLA_DEPENDE) {
    return { ...base, estado: 'depende-del-anuncio', base: 'indicio', texto: `${n >= 1 ? `Solo ${ventas}` : mayuscula(ventas)}${visita}: por ahora depende de la publicidad.` }
  }
  return { ...base, estado: 'mixto', base: 'indicio', texto: `${mayuscula(ventas)}${visita}: vende de las dos formas. Todavía no conviene quitarle el anuncio.` }
}
