import mongoose from 'mongoose'

// REVISAR UN PRODUCTO ANTES DE TRAERLO (18-nov-2026). Lectura del dueño al mirar qué se vendió y qué no de su
// primera importación: lo que no se movió era el mismo producto que ya vendían otros, más caro. En sus palabras:
// «vale más traer un producto diferente a la competencia que traer el mismo y competir por precio».
//
// Un candidato es un producto que todavía no se compra: la foto que manda el proveedor, qué es, a cuánto se piensa
// vender y cuánto costaría puesto en Chile. Se revisa contra el último scan de su nicho con la misma lectura de
// fotos de «Quién vende lo mismo»: para esa lectura es un producto propio más (services/revisionCompra.js), y lo
// que la foto propone y lo que el dueño confirma vive en IgualPropio con la clave `candidato:<id>`.
const candidatoCompraSchema = new mongoose.Schema({
  nichoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nicho', required: true, index: true },
  // qué es, con su medida si la tiene («lámpara de mesa 300 w con sensor»): de acá sale la medida que se compara
  descripcion: { type: String, required: true },
  // la foto, ya achicada en el navegador: el tipo de imagen y su contenido en base64
  foto: { tipo: { type: String, default: null }, base64: { type: String, default: null } },
  // a cuánto se piensa vender la publicación y cuántas unidades traería
  precioClp: { type: Number, default: null },
  unidades: { type: Number, default: 1 },
  // lo que costaría cada unidad puesta en Chile; sin él no se puede decir cuánto quedaría por venta
  costoUnitarioClp: { type: Number, default: null },
  creadoEl: { type: Date, default: Date.now },
})

export const CandidatoCompra = mongoose.models.CandidatoCompra ?? mongoose.model('CandidatoCompra', candidatoCompraSchema)
