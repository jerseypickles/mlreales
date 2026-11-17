import mongoose from 'mongoose'

// QUIÉN VENDE LO MISMO (17-nov-2026). Pedido del dueño: «no va a servir solo
// el título, tiene que leer la imagen del producto competidor para que haga
// match de que sí es el mismo producto… y nosotros en el frontend indicaremos
// si es lo mismo». Una fila por publicación ajena revisada para un producto
// propio: lo que propuso la lectura de fotos y lo que dijo el dueño al mirar
// la foto. El precio, lo vendido y la posición no se guardan acá: salen de los
// snapshots de cada scan del nicho, que ya traen la historia.
const igualPropioSchema = new mongoose.Schema({
  // el producto propio: 'familia:<id>' (vale para todos sus colores) o su sku
  clave: { type: String, required: true },
  // la publicación ajena (Producto.sku)
  sku: { type: String, required: true },
  // lo que dijo el dueño: 'igual' (el mismo producto) o 'distinto'
  relacion: { type: String, enum: ['igual', 'distinto'], default: null },
  // unidades que trae esa publicación (un pack de 2 son 2)
  unidades: { type: Number, default: 1 },
  marcadoEl: { type: Date, default: null },
  // lo que propuso la lectura de fotos: { relacion, unidades, motivo, modelo, el }. No decide nada.
  sugerencia: { type: mongoose.Schema.Types.Mixed, default: null },
})
igualPropioSchema.index({ clave: 1, sku: 1 }, { unique: true })

export const IgualPropio = mongoose.models.IgualPropio ?? mongoose.model('IgualPropio', igualPropioSchema)
