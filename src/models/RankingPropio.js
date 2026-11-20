import mongoose from 'mongoose'

// EL RANKING DE MÁS VENDIDOS DONDE COMPITE CADA PUBLICACIÓN PROPIA (20-nov-2026; services/rankingPropio.js).
// Una lectura por día de la página «Más vendidos» de una categoría, sola o filtrada por una marca: es la página a la
// que lleva el cartel «N.º más vendido» de cada publicación. De ahí salen candidatos para «Quién vende lo mismo» que
// la búsqueda del nicho no trae. Va aparte del ranking que descubre nichos (RankingMasVendidos): ese es por categoría
// y lo leen el radar y el panorama; este es por categoría y marca y solo lo lee la vista de un producto propio.
const rankingPropioSchema = new mongoose.Schema({
  categoriaId: { type: String, required: true },
  // id del valor de la marca en ML (atributo BRAND); null = el ranking de la categoría sin filtrar
  marcaId: { type: String, default: null },
  dia: { type: String, required: true }, // AAAA-MM-DD, día de Chile
  leidoEl: { type: Date, required: true },
  // la página filtrada por la marca no trajo ranking y se leyó la de la categoría entera
  sinFiltro: { type: Boolean, default: false },
  // en el orden del ranking: { id, itemId, tipo, posicion, titulo, vendedor, precio, vendidos, tiendaOficial, url, imagen }
  items: { type: [mongoose.Schema.Types.Mixed], default: [] },
})
rankingPropioSchema.index({ categoriaId: 1, marcaId: 1, dia: 1 }, { unique: true })

export const RankingPropio = mongoose.models.RankingPropio ?? mongoose.model('RankingPropio', rankingPropioSchema)
