import { periodosDelAnio } from '../estacionalidad.js'

// EL MAPA DE TEMPORADAS, APRENDIDO DE LOS DATOS.
//
// Cada nicho tiene su forma del año (estacionalidad.periodosDelAnio). Juntando
// todas las series, el sistema aprende qué eventos del calendario chileno
// mueven búsquedas, a qué nichos, con cuánta fuerza y qué tan seguido se
// repiten — y qué picos no explica ningún evento, que son las preguntas
// abiertas. Es lo que le permite al radar pensar "se viene la vuelta a clases:
// ¿qué nichos suben ahí?" con números medidos y no con memoria.

const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 : null }

// Pura. series: [{keyword, meses}] (una por keyword medida).
export function mapaDeTemporadas(series, { minimoMultiplicador = 1.3 } = {}) {
  const porEvento = new Map()
  const sinExplicar = []
  let conForma = 0, planas = 0
  for (const s of series ?? []) {
    const p = periodosDelAnio(s.meses, { keyword: s.keyword })
    if (!p) continue
    conForma++
    const picos = p.picos.filter((x) => x.multiplicador >= minimoMultiplicador)
    if (!picos.length) { planas++; continue }
    for (const x of picos) {
      if (!x.porque) { sinExplicar.push({ keyword: s.keyword, meses: x.texto, multiplicador: x.multiplicador, repite: `${x.repite}/${x.anios}` }); continue }
      // se agrupa por la explicación COMPLETA: "vuelta a clases" (seguro) y
      // "vuelta a clases o verano" (ambiguo) no son lo mismo
      const clave = `${x.porque.id}|${x.porque.certeza ?? ''}|${x.porque.alternativa ?? ''}`
      const e = porEvento.get(clave) ?? { id: x.porque.id, nombre: x.porque.nombre, certeza: x.porque.certeza ?? null, nichos: [] }
      e.nichos.push({ keyword: s.keyword, meses: x.texto, multiplicador: x.multiplicador, repite: x.repite, anios: x.anios })
      porEvento.set(clave, e)
    }
  }
  const eventos = [...porEvento.values()].map((e) => ({
    id: e.id, nombre: e.nombre, certeza: e.certeza, nichos: e.nichos.length,
    multiplicadorMediano: Math.round(mediana(e.nichos.map((n) => n.multiplicador)) * 10) / 10,
    // qué parte de sus nichos lo repite todos los años medidos
    confiablePct: Math.round(e.nichos.filter((n) => n.repite >= n.anios).length / e.nichos.length * 100),
    // los que más suben con el evento: lo que conviene tener listo antes
    masFuertes: [...e.nichos].sort((a, b) => b.multiplicador - a.multiplicador).slice(0, 8),
  })).sort((a, b) => b.nichos - a.nichos)
  return { series: conForma, planas, conPeriodo: conForma - planas, eventos, sinExplicar: sinExplicar.sort((a, b) => b.multiplicador - a.multiplicador) }
}
