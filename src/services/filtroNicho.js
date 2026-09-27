// LO QUE NO ES DEL NICHO NO SE MIDE.
//
// La búsqueda de ML mezcla productos que comparten una palabra: en "carpa
// camping" (27-sep-2026) la mitad del top eran LONAS DE REPUESTO PARA TOLDO
// plegable 3x3, más baños vestidores y lonas para cubrir autos. Las lonas son
// las que más venden (hasta 10.000 cada una), así que la mediana de precio
// ($11.611) era de lona y los 52.175 vendidos del top también: el nicho medía
// otro producto. El importador lo vio en pantalla: "el toldo plegable está
// bien cotizado si se busca, pero carpa camping es otra cosa".
//
// Cada nicho guarda frases excluidas (Nicho.competenciaExcluida). Un producto
// queda fuera si su título trae TODAS las palabras de alguna frase (con
// plurales y sin tildes, igual que calzaConBusqueda del panel).

const raiz = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/(es|s)$/, '')
const palabras = (t) => String(t ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(raiz)

// Pura. ¿El título trae la frase? (todas sus palabras, en cualquier orden)
export function tituloTraeFrase(titulo, frase) {
  const ws = palabras(titulo)
  const fs = palabras(frase).filter((w) => w.length >= 2)
  return fs.length > 0 && fs.every((f) => ws.some((w) => w === f || (f.length >= 4 && w.startsWith(f))))
}

// Pura. La primera frase que saca al producto del nicho, o null.
export function fraseQueExcluye(titulo, frases) {
  if (!titulo || !frases?.length) return null
  return frases.find((f) => tituloTraeFrase(titulo, f)) ?? null
}

// Pura. Separa snapshots del nicho de los que no son. Sin título se queda
// (no se sabe qué es, y sacarlo sería inventar).
export function separarSnapshots(snapshots, productosPorSku, frases) {
  if (!frases?.length || !snapshots) return { dentro: snapshots, fuera: [] }
  const dentro = [], fuera = []
  for (const s of snapshots) (fraseQueExcluye(productosPorSku.get(s.sku)?.titulo, frases) ? fuera : dentro).push(s)
  return { dentro, fuera }
}
