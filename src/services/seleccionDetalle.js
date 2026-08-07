// A quién le pagamos detalle. El cupo del actor es de COSTO, no de relevancia:
// elegir "las primeras N posiciones" concentra el gasto en un solo segmento
// (normalmente el más barato) y deja ciego al resto — caso saca puntos negros
// 7-ago: las máquinas vivían en las posiciones 32-51 y el veredicto las
// enterró por "no vender". El cupo se reparte en tres bolsillos:
//   1. NÚCLEO: las primeras posiciones, que mandan el ranking y la serie.
//   1.b CONTINUIDAD: quien ya estaba en la canasta comparable sigue dentro —
//      si sale, el delta se calcula sobre otra canasta y la serie miente.
//   2. COBERTURA: al menos un representante de cada banda de precio, para que
//      ningún segmento quede sin medir.
//   3. ROTACIÓN: lo que hace más tiempo no se mide entra antes que lo fresco.
const PCT_NUCLEO = 0.6
const BANDAS = 4

const porPosicion = (a, b) => (a.posicion ?? Infinity) - (b.posicion ?? Infinity)

// Banda de precio (0..BANDAS-1) por cuartiles del listado completo
function bandasDePrecio(items) {
  const precios = items.map((i) => i.precio).filter(Number.isFinite).sort((a, b) => a - b)
  if (precios.length < BANDAS) return new Map(items.map((i) => [i.sku, 0]))
  const cortes = []
  for (let k = 1; k < BANDAS; k++) cortes.push(precios[Math.floor((precios.length * k) / BANDAS)])
  return new Map(
    items.map((i) => {
      if (!Number.isFinite(i.precio)) return [i.sku, 0]
      let banda = 0
      while (banda < cortes.length && i.precio >= cortes[banda]) banda++
      return [i.sku, banda]
    }),
  )
}

export function elegirObjetivosDetalle(items, { topN, medidoEl = new Map(), enSerie = new Set() } = {}) {
  const candidatos = items.filter((i) => i.url)
  if (candidatos.length <= topN) return candidatos

  const banda = bandasDePrecio(candidatos)
  const orden = [...candidatos].sort(porPosicion)
  const elegidos = orden.slice(0, Math.ceil(topN * PCT_NUCLEO))
  const yaElegido = new Set(elegidos.map((i) => i.sku))

  // 1.b CONTINUIDAD (antes que cobertura y rotación): los que ya venían
  // midiéndose sostienen la canasta comparable del delta. Sacarlos rompe la
  // serie y hunde las ventas/día sin que el mercado cambie (caso 7-ago:
  // manguera pasó de 4.970 a 2.741 reseñas medidas con MÁS items).
  for (const i of orden) {
    if (elegidos.length >= topN) break
    if (yaElegido.has(i.sku) || !enSerie.has(i.sku)) continue
    elegidos.push(i)
    yaElegido.add(i.sku)
  }
  const cubiertas = new Set(elegidos.map((i) => banda.get(i.sku)))

  // más viejo primero (nunca medido = 0), y a igualdad, mejor posición
  const antiguedad = (i) => medidoEl.get(i.sku) ?? 0
  const resto = orden.filter((i) => !yaElegido.has(i.sku)).sort((a, b) => antiguedad(a) - antiguedad(b) || porPosicion(a, b))

  // 2. una plaza garantizada por banda sin representante
  for (let b = 0; b < BANDAS && elegidos.length < topN; b++) {
    if (cubiertas.has(b)) continue
    const candidato = resto.find((i) => !yaElegido.has(i.sku) && banda.get(i.sku) === b)
    if (!candidato) continue
    elegidos.push(candidato)
    yaElegido.add(candidato.sku)
    cubiertas.add(b)
  }

  // 3. el cupo que sobra, por rotación
  for (const i of resto) {
    if (elegidos.length >= topN) break
    if (yaElegido.has(i.sku)) continue
    elegidos.push(i)
    yaElegido.add(i.sku)
  }

  return elegidos.sort(porPosicion)
}
