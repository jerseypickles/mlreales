import mongoose from 'mongoose'

// EL HTML TAL COMO ML LO SIRVIÓ, PARA PODER DIAGNOSTICAR SIN VOLVER A PEDIRLO.
//
// Los errores de esta semana fueron todos del mismo tipo: ML cambió la forma de
// un dato y el parser siguió leyendo la vieja. El vendedor venía como
// "MGM IMPORTACIONES {icon_cockade}" en vez de "{label} {icon_cockade}" y
// quedó en null para listados enteros; el envío pasó de `CXD` a `CFF`.
//
// Para investigar cualquiera de esos hubo que volver a scrapear y esperar que
// ML sirviera la misma variante — que no siempre pasa, porque la forma depende
// del nicho y del momento. Con el crudo guardado, el diagnóstico es leer un
// documento.
//
// SOLO LA ÚLTIMA CORRIDA Y SOLO LA PÁGINA 1, comprimida con brotli: el HTML de
// un listado pesa ~1,95 MB y comprime a ~136 KB (14,7x medido). Noventa nichos
// son ~12 MB, contra una base de 71 MB. Guardar las dos páginas y varias
// corridas la duplicaría para diagnosticar lo mismo.
const htmlCrudoSchema = new mongoose.Schema({
  keyword: { type: String, required: true, unique: true },
  fecha: { type: Date, required: true },
  fuente: String, // 'zyte' | 'apify'
  chars: Number, // tamaño sin comprimir, para ver de un vistazo si vino recortado
  htmlBr: Buffer, // brotli
  // Lo que el parser SACÓ de este HTML. Comparar esto con lo que saca hoy dice
  // si cambió ML o cambiamos nosotros, que es la primera pregunta siempre.
  resumen: {
    items: Number,
    conPrecio: Number,
    conVendedor: Number,
    conVendidos: Number,
    conCatalogId: Number,
    anuncios: Number,
  },
})

export const HtmlCrudo = mongoose.model('HtmlCrudo', htmlCrudoSchema)
