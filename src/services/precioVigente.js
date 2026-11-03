// EL PRECIO DE UNA UNIDAD PARA EL COMPRADOR, sin dejar pasar un $0.
//
// Medido el 3-nov-2026: en una promoción por volumen ("10% llevando 2") ML
// informa `price: 0`, porque el precio depende de cuántas unidades lleve el
// comprador. El sistema encadenaba `promo ?? efectivo ?? lista`, y `??` deja
// pasar el 0: dos productos quedaron con precio efectivo $0 desde que empezó la
// promoción, sin economía por unidad y, con eso, sin plan de publicidad ni gama
// de precio. Un precio que no es positivo no es un precio: se sigue con el
// siguiente de la cadena.

export const positivo = (x) => (Number.isFinite(x) && x > 0 ? x : null)

// Pura. El precio que se pidió explícitamente, si no el de la promoción vigente
// (cuando trae precio por unidad), si no el efectivo medido y si no el de lista.
export function precioVigente({ precio = null, promo = null, medicion = null } = {}) {
  return (
    positivo(precio) ??
    positivo(promo?.activa?.precio) ??
    positivo(medicion?.precioEfectivo) ??
    positivo(medicion?.precio) ??
    null
  )
}
