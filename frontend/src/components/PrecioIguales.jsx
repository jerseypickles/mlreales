import { Tag, ArrowRight } from 'lucide-react'
import { Aviso, ReglaPrecios } from './sistema.jsx'
import { fmtNum, fmtPrecio } from '../lib/formato.js'

// EL PRECIO CONTRA LOS QUE VENDEN LO MISMO, AL LADO DEL ANUNCIO (18-nov-2026). Pedido del importador al ver que
// «Quién vende lo mismo» todavía no entraba en lo que decide la publicidad: avisar acá cuando el producto está caro
// contra sus iguales, antes de gastar. El plan de campañas mira lo que deja cada venta, no si el precio compite.
//
// Es un aviso, no una orden: no cambia lo que recomienda el plan. Y dice siempre con qué se compara:
//   · lo que el importador confirmó en Mis productos;
//   · lo que solo propone la lectura de fotos (un indicio: falta que él confirme);
//   · lo más parecido, cuando por la foto nadie vende el mismo (referencia: nunca dice «caro»).
// El título lo dice en palabras; el color solo lo repite.
export function lecturaPrecio(pos) {
  if (!pos) return null
  if (pos.base === 'parecidos') return { tono: 'neutra', titulo: 'Precio contra lo más parecido.', cierre: 'No son tu mismo producto: sirven de referencia.' }
  const falta = pos.base === 'por-foto'
  if (pos.caro) {
    return falta
      ? { tono: 'atencion', titulo: 'Puede que estés caro contra los que venden lo mismo.', cierre: 'Hazlo en Mis productos antes de gastar más en este anuncio.' }
      : { tono: 'atencion', titulo: 'Estás caro contra los que venden lo mismo.', cierre: 'Antes de gastar más en este anuncio, mira el precio: quien hace clic también ve a los otros.' }
  }
  const titulo = pos.nivel === 'ninguno-mas-barato' ? 'Nadie que venda lo mismo cobra menos que tú.' : 'Tu precio está en la mitad más barata de los que venden lo mismo.'
  return { tono: falta ? 'neutra' : 'bien', titulo, cierre: falta ? '' : 'Por precio no pierdes contra ellos.' }
}

// cuántos de los que venden lo mismo cobran menos, sin «4 de 4» ni «0 de 64»
const cuantosMenos = (pos) =>
  pos.masBaratos === 0 ? (pos.n === 1 ? 'El otro no cobra' : `Ninguno de los ${fmtNum(pos.n)} cobra`)
    : pos.masBaratos === pos.n ? (pos.n === 1 ? 'El otro cobra' : `Los ${fmtNum(pos.n)} cobran`)
      : `${fmtNum(pos.masBaratos)} de ${fmtNum(pos.n)} cobran`
// la misma lectura en una línea, para una tarjeta chica
const enCorto = (pos) =>
  pos.base === 'parecidos'
    ? `Nadie vende el mismo. De las ${fmtNum(pos.n)} más parecidas, ${fmtNum(pos.masBaratos)} cobran menos por unidad.`
    : `${cuantosMenos(pos)} menos por unidad${pos.masBaratos ? `: desde ${fmtPrecio(pos.masBaratoUnidad)}, tú ${fmtPrecio(pos.precioUnidad)}` : ''}.${pos.base === 'por-foto' ? ' Por la foto; falta que lo confirmes.' : ''}`
// el nombre de un producto en pocas palabras, para nombrarlo dentro de una frase
const nombreCorto = (titulo) => String(titulo ?? '').split(/\s+/).filter(Boolean).slice(0, 4).join(' ')

const pendiente = (pos) => [
  pos.sinRevisar > 0 ? `Hay ${fmtNum(pos.sinRevisar)} ${pos.sinRevisar === 1 ? 'publicación nueva' : 'publicaciones nuevas'} de la búsqueda sin mirar por foto.` : '',
  pos.scanDias > 14 ? `Los precios son del scan de hace ${fmtNum(pos.scanDias)} días.` : '',
].filter(Boolean).join(' ')

// Para «Qué hacer hoy»: el paso de un producto que está gastando en anuncios y se ve caro contra sus iguales.
export const pasoPrecio = (pos) => (pos?.caro ? `${pos.base === 'por-foto' ? 'confirma en Mis productos quién vende lo mismo' : 'mira el precio antes de gastar más'}. ${enCorto(pos)}` : null)

// `corto`: una línea, para las tarjetas del plan. `conRegla`: debajo, dónde cae el precio propio entre los otros.
// `onVer` lleva a Mis productos, donde se confirma y se ve a qué precio se quedaría dónde.
export function PrecioIguales({ pos, corto = false, conRegla = false, onVer }) {
  const l = lecturaPrecio(pos)
  if (!l) return null
  const boton = onVer ? (
    <button type="button" className="boton-secundario boton-chico" onClick={() => onVer(pos)}>
      ver en Mis productos <ArrowRight size={14} aria-hidden="true" />
    </button>
  ) : null
  if (corto) return <Aviso tono={l.tono} Icono={Tag} titulo={l.titulo} accion={boton}>{enCorto(pos)}</Aviso>
  return (
    <>
      <Aviso tono={l.tono} Icono={Tag} titulo={l.titulo} accion={boton}>
        {[pos.frase, l.cierre, pendiente(pos)].filter(Boolean).join(' ')}
      </Aviso>
      {conRegla && pos.precios?.length ? (
        <ReglaPrecios
          titulo={pos.base === 'parecidos' ? 'Tu precio por unidad entre las publicaciones más parecidas' : 'Tu precio por unidad entre los que venden lo mismo'}
          fuente={`${fmtNum(pos.precios.length)} ${pos.precios.length === 1 ? 'publicación' : 'publicaciones'}${pos.keyword ? ` de “${pos.keyword}”` : ''}${pos.base === 'por-foto' ? ' · por la foto, sin confirmar' : ''}`}
          puntos={pos.precios}
          marcas={[{ id: 'tu', valor: pos.precioUnidad, titulo: `tú hoy${pos.unidades > 1 ? ` (tu publicación trae ${fmtNum(pos.unidades)} a ${fmtPrecio(pos.precio)})` : ''}`, tono: 'destacada' }]}
          formato={fmtPrecio}>
          Cada rayita es lo que cobra por unidad una publicación. La mitad cobra menos de {fmtPrecio(pos.medianaUnidad)}.
        </ReglaPrecios>
      ) : null}
    </>
  )
}

// Arriba del plan: los productos con campaña o propuesta que están caros contra sus iguales, de una vez.
// `grupos`: [{ titulo, miembros: [{ itemId }] }] del plan; `precioDe`: Map(itemId → posición).
export function AvisoPreciosCaros({ grupos, precioDe, onProducto }) {
  const caros = (grupos ?? []).map((g) => ({ g, pos: g.miembros.map((p) => precioDe.get(p.itemId)).find((x) => x?.caro) })).filter((x) => x.pos)
  if (!caros.length) return null
  const nombres = caros.map(({ g, pos }) => `${nombreCorto(g.titulo)}: ${cuantosMenos(pos).toLowerCase()} menos por unidad${pos.base === 'por-foto' ? ' (por la foto, falta confirmar)' : ''}`)
  return (
    <Aviso tono="atencion" Icono={Tag} titulo="Mira el precio antes que el anuncio."
      accion={onProducto ? <button type="button" className="boton-secundario boton-chico" onClick={() => onProducto(caros[0].pos.itemId)}>ver {caros.length === 1 ? 'el producto' : 'el primero'} <ArrowRight size={14} aria-hidden="true" /></button> : null}>
      {caros.length === 1 ? 'Un producto con campaña o propuesta está' : `${fmtNum(caros.length)} productos con campaña o propuesta están`} más {caros.length === 1 ? 'caro' : 'caros'} que la mayoría de los que venden lo mismo. {nombres.join('; ')}.
    </Aviso>
  )
}
