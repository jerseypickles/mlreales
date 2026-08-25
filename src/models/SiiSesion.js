import mongoose from 'mongoose'

// Sesión del SII. Se espera UNA sola, la de la empresa.
//
// ACÁ NO VIVE LA CLAVE TRIBUTARIA, y es una decisión explícita del importador
// del 25-ago-2026: el sistema guarda solo las COOKIES de una sesión que él
// abrió a mano en sii.cl. La clave no pasa por Render, ni por Mongo, ni por
// este código, ni por el contexto del asistente.
//
// El precio es que la sesión expira (unas 2 horas) y hay que reconectar. Para
// un trámite mensual eso no es una molestia: alguien se sienta una vez al mes
// a declarar y esa es exactamente la ventana en que se necesita el dato.
const siiSesionSchema = new mongoose.Schema({
  // el string de cookies completo del dominio www4.sii.cl
  cookies: { type: String, required: true },
  // cookie TOKEN: viaja además como conversationId en el cuerpo de cada llamada
  token: { type: String, required: true },
  rut: { type: String, required: true },
  dv: { type: String, required: true },
  expiraEl: { type: Date, default: null },
  conectadoEl: { type: Date, default: Date.now },
  // última vez que una llamada real funcionó: distinto de "no ha expirado",
  // porque el SII puede cortar la sesión antes de su propio vencimiento
  ultimoUsoEl: { type: Date, default: null },
})

export const SiiSesion = mongoose.model('SiiSesion', siiSesionSchema)
