// Misma regla que el servidor (src/services/filtroNicho.js): el título trae
// todas las palabras de la frase, con plurales y sin tildes. Para contar en
// pantalla cuántos productos saca una frase antes de aplicarla.
const raiz = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/(es|s)$/, '')
const palabras = (t) => String(t ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(raiz)
export function tituloTrae(titulo, frase) {
  const ws = palabras(titulo)
  const fs = palabras(frase).filter((w) => w.length >= 2)
  return fs.length > 0 && fs.every((f) => ws.some((w) => w === f || (f.length >= 4 && w.startsWith(f))))
}
