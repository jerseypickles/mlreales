// Clave de COMPRA de un nicho: dos keywords distintas de Mercado Libre pueden
// surtirse del mismo producto de fábrica (un solo pedido cubre ambos listings).
// Los nichos que comparten clave se muestran unidos en la mesa de compra.
//
// La clave la fija el usuario con unir/separar en Oportunidades. Antes existía
// además un pase de LLM (services/rfq.js) que la proponía junto con la
// traducción al inglés para una planilla de cotización al proveedor: esa
// planilla era un Excel de ida sin retorno — las respuestas del proveedor no
// tenían dónde volver, nunca se usó, y el pase costaba tokens en cada arranque.

const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g')
const sinTilde = (t) => String(t).normalize('NFD').replace(DIACRITICOS, '')

export const claveRespaldo = (k) =>
  sinTilde(k)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
