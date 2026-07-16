import mongoose from 'mongoose'

// Se llena en Fase 2 con el actor de detalle (nivel 1 trae sellerID vacío).
const sellerSchema = new mongoose.Schema({
  sellerId: { type: String, required: true, unique: true },
  nombre: String,
  esTiendaOficial: Boolean,
  officialStoreId: mongoose.Schema.Types.Mixed,
  reputacion: String, // ej: "5_green"
  powerSeller: String, // nivel MercadoLíder: "platinum" | "gold" | "silver" | null
  productosTrackeados: { type: [String], default: [] },
  ultimaActualizacion: Date,
})

export const Seller = mongoose.model('Seller', sellerSchema)
