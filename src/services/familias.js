import { Snapshot } from '../models/Snapshot.js'

// FAMILIAS DE NICHO: dos keywords pueden medir el MISMO mercado aunque no
// compartan ni una palabra (gua sha vs rodillo facial) — la señal honesta es
// el solape de SKUs entre sus últimos scans, no el texto. Familia ≠ misma
// compra (rfq.productoClave): la familia dice "sobra una medición", la compra
// dice "sobra un pedido".

// solape = |A∩B| / min(|A|,|B|): un nicho chico contenido en uno grande da 1
export function solape(a, b) {
  if (!a?.size || !b?.size) return 0
  let comunes = 0
  for (const sku of a) if (b.has(sku)) comunes++
  return comunes / Math.min(a.size, b.size)
}

// Set de SKUs del último scan de cada keyword (top N por posición).
// Consultas index-backed EN PARALELO (una agregación que ordena todos los
// snapshots tardaba segundos y corría en cada carga del tablero Y del
// sidebar) + cache 10 min por combinación de keywords: las familias cambian
// con los scans, no con cada refresco de página.
const cacheSkus = new Map() // clave → {hasta, mapa}
const TTL_SKUS_MS = 10 * 60e3

// LÍMITE: el listado completo, no el top 30.
//
// Con 30 el detector no encontraba UNA sola familia en todo el tablero. El
// caso que lo delató: "paleta maquillaje" y "paleta de sombras" miden el mismo
// mercado —el importador lo sabía— y daban 23% de solape con el top 30 y 60%
// con el listado entero. El ranking de dos búsquedas distintas diverge en la
// cabeza aunque el mercado sea idéntico; el solape real vive en el cuerpo.
//
// Verificado sobre los 56 nichos activos: con 30 detecta 0 familias, con 100
// detecta 1 y ningún falso positivo.
export async function topSkusPorKeyword(keywords, { limite = 100 } = {}) {
  if (!keywords.length) return new Map()
  const clave = `${[...keywords].sort().join('|')}#${limite}`
  const hit = cacheSkus.get(clave)
  if (hit && Date.now() < hit.hasta) return hit.mapa

  const pares = await Promise.all(
    keywords.map(async (kw) => {
      const ultimo = await Snapshot.findOne({ keyword: kw }).sort({ fecha: -1 }).select('fecha').lean()
      if (!ultimo) return [kw, new Set()]
      const snaps = await Snapshot.find({ keyword: kw, fecha: ultimo.fecha })
        .sort({ posicion: 1 })
        .limit(limite)
        .select('sku')
        .lean()
      return [kw, new Set(snaps.map((s) => s.sku))]
    }),
  )
  const mapa = new Map(pares)
  cacheSkus.set(clave, { hasta: Date.now() + TTL_SKUS_MS, mapa })
  if (cacheSkus.size > 8) {
    for (const [k, v] of cacheSkus) if (Date.now() >= v.hasta) cacheSkus.delete(k)
  }
  return mapa
}

// Agrupa filas del tablero (ordenadas por score desc) en familias por solape.
// Cada fila: {keyword, familiaAparte?, jugadaDeKeyword?}. El líder de cada
// familia es la primera fila en el orden dado (= mayor score). Los hijos de
// jugada se unen a su padre por construcción. familiaAparte (marcado a mano)
// impide volver a unir un falso positivo.
export function agruparFamilias(filas, skusPorKeyword, { umbral = 0.5 } = {}) {
  const kws = filas.map((f) => f.keyword)
  const padre = new Map(kws.map((k) => [k, k]))
  const find = (k) => {
    while (padre.get(k) !== k) {
      padre.set(k, padre.get(padre.get(k)))
      k = padre.get(k)
    }
    return k
  }
  const unir = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) padre.set(rb, ra)
  }
  const aparte = new Map(filas.map((f) => [f.keyword, new Set(f.familiaAparte ?? [])]))
  const excluida = (a, b) => aparte.get(a)?.has(b) || aparte.get(b)?.has(a)

  for (let i = 0; i < kws.length; i++) {
    for (let j = i + 1; j < kws.length; j++) {
      if (excluida(kws[i], kws[j])) continue
      if (solape(skusPorKeyword.get(kws[i]), skusPorKeyword.get(kws[j])) >= umbral) unir(kws[i], kws[j])
    }
  }
  for (const f of filas) {
    if (f.jugadaDeKeyword && padre.has(f.jugadaDeKeyword) && !excluida(f.keyword, f.jugadaDeKeyword)) {
      unir(f.jugadaDeKeyword, f.keyword)
    }
  }

  const lideres = new Map() // raíz → keyword líder (primera en orden de score)
  for (const f of filas) {
    const raiz = find(f.keyword)
    if (!lideres.has(raiz)) lideres.set(raiz, f.keyword)
  }
  const deMiembro = new Map() // keyword → {lider, solapePct, esJugadaDelLider}
  const deLider = new Map() // líder → [{keyword, solapePct}]
  for (const f of filas) {
    const lider = lideres.get(find(f.keyword))
    if (lider === f.keyword) continue
    const pct = Math.round(solape(skusPorKeyword.get(f.keyword), skusPorKeyword.get(lider)) * 100)
    const entrada = { lider, solapePct: pct, esJugadaDelLider: f.jugadaDeKeyword === lider }
    deMiembro.set(f.keyword, entrada)
    if (!deLider.has(lider)) deLider.set(lider, [])
    deLider.get(lider).push({ keyword: f.keyword, solapePct: pct })
  }
  return { deMiembro, deLider }
}
