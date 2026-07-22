import mongoose from 'mongoose'

// Cuenta de Mercado Libre del propio vendedor (OAuth). Se espera UNA sola.
// OJO: ML rota el refresh token en cada renovación (single-use) — el que está
// guardado es siempre el único válido; perderlo obliga a reconectar a mano.
const meliCuentaSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  nickname: { type: String, default: null },
  accessToken: { type: String, required: true },
  refreshToken: { type: String, required: true },
  expiraEl: { type: Date, required: true },
  scopes: { type: String, default: null },
  conectadoEl: { type: Date, default: Date.now },
  actualizadoEl: { type: Date, default: Date.now },
})

export const MeliCuenta = mongoose.model('MeliCuenta', meliCuentaSchema)
