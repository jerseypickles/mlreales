import { config } from '../src/config/env.js'
import { conectarMongo, desconectarMongo } from '../src/db/mongo.js'
import { estadoMl, entrenarModelosMl } from '../src/services/ml/servicio.js'

const comando = process.argv[2]
if (!['estado', 'entrenar', 'capturar-series'].includes(comando)) {
  console.log('Uso: node scripts/ml.js estado|entrenar|capturar-series')
  process.exitCode = 1
} else if (!config.mongoUri) {
  console.error('Falta MONGO_URI. Configura el acceso a la base para auditar o entrenar con datos reales.')
  process.exitCode = 1
} else {
  try {
    await conectarMongo(config.mongoUri)
    let resultado
    if (comando === 'capturar-series') {
      if (!config.mlActivo) throw new Error('ML_ACTIVO=false')
      const { Nicho } = await import('../src/models/Nicho.js')
      const { CurvaEstacional } = await import('../src/models/CurvaEstacional.js')
      const { volumenMensual, hayCredenciales } = await import('../src/services/volumenBusqueda.js')
      if (!hayCredenciales()) throw new Error('Falta configurar DataForSEO para recuperar las series')
      const nichos = await Nicho.find({ estado: 'activo' }).select('keyword').lean()
      const curvas = await CurvaEstacional.find({ keyword: { $in: nichos.map((n) => n.keyword) } }).select('keyword keywordMedida').lean()
      const exactas = new Map(curvas.map((c) => [c.keyword, c.keywordMedida ?? c.keyword]))
      const keywords = [...new Set(nichos.map((n) => exactas.get(n.keyword) ?? n.keyword))]
      await volumenMensual(keywords)
      resultado = await estadoMl()
    } else {
      resultado = comando === 'estado' ? await estadoMl() : await entrenarModelosMl()
    }
    console.log(JSON.stringify(resultado, null, 2))
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  } finally {
    await desconectarMongo()
  }
}
