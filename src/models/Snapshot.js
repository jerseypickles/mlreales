import mongoose from 'mongoose'

// Serie temporal: 1 documento por producto por scan. Todos los snapshots de un
// mismo scan comparten la misma `fecha`, lo que permite reconstruir el listado
// completo de ese momento.
const snapshotSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  fecha: { type: Date, required: true },
  precio: Number,
  precioAnterior: Number,
  descuentoPct: Number,
  cuotas: String,
  rating: Number,
  numReviews: Number,
  // SEGUNDA MEDIDA DE RESEÑAS, EN OBSERVACIÓN.
  //
  // `numReviews` sale del nivel 2 (ficha) y cubre el top 50. Éste sale de
  // /reviews/item de la API oficial: gratis, y responde para el 100% del
  // listado (medido 109/109 y 97/97 el 29-ago-2026).
  //
  // NO alimenta el score todavía, y la razón es que NO mide lo mismo: la API
  // cuenta las reseñas de la PUBLICACIÓN y la ficha muestra a veces el agregado
  // del CATÁLOGO, sumando a todos los vendedores del producto. Razones medidas
  // contra la ficha: 1,000 / 1,005 / 0,997 / 1,013 / 0,966 / 0,919 / 0,297.
  // Esa última —ficha 5.765, API 1.713— no es ruido, es otra cosa.
  //
  // Se guarda en paralelo para poder comparar ESTABILIDAD entre scans, que es
  // lo que de verdad importa: el sistema usa el delta, no el conteo. Como es
  // por publicación, no debería sufrir los saltos de catálogo que hubo que
  // filtrar en julio — pero eso se demuestra con una serie, no con una foto.
  numReviewsApi: Number,
  vendidos: Number, // badge público "+N vendidos", en baldes (nivel 1)
  // "últimas N unidades" del listado: 1..5, o null si ML no lo muestra (= más
  // de 5). Es el stock del COMPETIDOR, no el propio. Ojo strict mode: sin
  // declararlo acá Mongoose lo descarta en silencio, como pasó con promoMl.
  unidadesRestantes: Number,
  selloMl: String, // "MÁS VENDIDO", "OFERTA IMPERDIBLE", "OFERTA RELÁMPAGO"
  stock: Number, // Fase 2 (nivel 2)
  posicion: Number,
  // la posición es pagada (anuncio) u orgánica; null = proveedor que no lo dice
  esAnuncio: Boolean,
  keyword: String,
  // ids de las preguntas visibles en la página (nivel 2): el diff entre scans
  // cuenta preguntas NUEVAS reales — segundo proxy de demanda, independiente
  // del conteo de reseñas y sus agregados de catálogo
  preguntasIds: { type: [String], default: undefined },
})

snapshotSchema.index({ sku: 1, fecha: -1 })
snapshotSchema.index({ keyword: 1, fecha: -1 })

export const Snapshot = mongoose.model('Snapshot', snapshotSchema)
