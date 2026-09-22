// Pura. Lee el objeto JSON que empieza en `inicio` (que debe ser un '{' o '[')
// contando llaves y respetando strings y escapes. Hace falta porque estas
// estructuras están embebidas en HTML: no hay forma de aislarlas con regex.
export function objetoDesde(texto, inicio) {
  const abre = texto[inicio]
  const cierra = abre === '{' ? '}' : ']'
  if (abre !== '{' && abre !== '[') return null
  let nivel = 0
  let enString = false
  let escapado = false
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i]
    if (escapado) { escapado = false; continue }
    if (c === '\\') { escapado = true; continue }
    if (c === '"') { enString = !enString; continue }
    if (enString) continue
    if (c === abre) nivel++
    else if (c === cierra) {
      nivel--
      if (nivel === 0) {
        try {
          return JSON.parse(texto.slice(inicio, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}
