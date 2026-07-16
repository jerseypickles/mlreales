import mongoose from 'mongoose'

export async function conectarMongo(uri) {
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri)
  return mongoose.connection
}

export async function desconectarMongo() {
  await mongoose.disconnect()
}
