// Los modelos a veces devuelven JSON con escapes doble-codificados: el texto
// parseado queda con "ó" y "\n" LITERALES en vez de "ó" y saltos de línea.
// Este decodificador recorre cualquier estructura y los repara; es idempotente
// (texto limpio pasa intacto).

const RE_ESCAPES = /\\u[0-9a-fA-F]{4}|\\n|\\r|\\t/

export function decodificarEscapes(valor) {
  if (typeof valor === 'string') {
    if (!RE_ESCAPES.test(valor)) return valor
    return valor
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
  }
  if (Array.isArray(valor)) return valor.map(decodificarEscapes)
  if (valor && typeof valor === 'object') {
    const limpio = {}
    for (const [clave, v] of Object.entries(valor)) limpio[clave] = decodificarEscapes(v)
    return limpio
  }
  return valor
}
