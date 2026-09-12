import { SerieNichoMl } from '../../models/SerieNichoMl.js'
import { ObservacionProductoMl } from '../../models/ObservacionProductoMl.js'
import { ModeloMl } from '../../models/ModeloMl.js'
import { PrediccionMl } from '../../models/PrediccionMl.js'
import { pronosticarDemanda, VERSION_DEMANDA } from './demanda.js'
import { ventanasIndependientes, VERSION_COMERCIAL } from './comercial.js'
import { ejecutarEntrenamiento } from './ejecutar.js'
import { huellaDe } from './registro.js'
import { indiceMes, normalizarMeses, variablesDemanda } from './series.js'
import { config } from '../../config/env.js'
import { datosConContexto, estadoIntegracion } from './integracion.js'
import { OBJETIVO_CONTEXTO, VERSION_CONTEXTO } from './contexto.js'

export async function seriesActuales({ keywords } = {}) {
  return SerieNichoMl.aggregate([
    { $match: { pais: 2152, idioma: 'es', fuente: 'google-ads', ...(keywords ? { keyword: { $in: keywords } } : {}) } },
    { $sort: { capturadoEl: -1, _id: -1 } },
    { $group: { _id: '$keyword', dato: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$dato' } },
    { $sort: { keyword: 1 } },
  ])
}

export async function entrenarModelosMl() {
  if (!config.mlActivo) return { omitido: true, motivo: 'ML_ACTIVO=false' }
  const series = await seriesActuales()
  const observaciones = await ObservacionProductoMl.find({ hasta: { $gte: new Date(Date.now() - 730 * 86400e3), $lte: new Date() } }).sort({ hasta: 1, itemId: 1 }).lean()
  const unidas = await datosConContexto({ observaciones })
  const tareas = [
    { objetivo: 'busquedas-google', version: VERSION_DEMANDA,
      datos: series.map((s) => ({ keyword: s.keyword, meses: s.meses.map((m) => ({ periodo: m.periodo, valor: m.valor })) })) },
    { objetivo: 'unidades-por-visita', version: VERSION_COMERCIAL,
      datos: ventanasIndependientes(observaciones).map(({ itemId, categoria, desde, hasta, visitas, unidades, precio, full }) => ({ itemId, categoria, desde, hasta, visitas, unidades, precio, full })) },
    { objetivo: OBJETIVO_CONTEXTO, version: VERSION_CONTEXTO,
      datos: unidas.datos.map(({ itemId, categoria, desde, hasta, visitas, unidades, precio, full, contexto }) => ({ itemId, categoria, desde, hasta, visitas, unidades, precio, full, contexto })) },
  ]
  const salida = []
  for (const t of tareas) {
    const huella = huellaDe({ version: t.version, datos: t.datos })
    let modelo = await ModeloMl.findOne({ huella }).lean()
    if (!modelo) {
      const resultado = await ejecutarEntrenamiento(t.objetivo, t.datos)
      resultado.runtime = { node: process.version, biblioteca: 'ml-matrix@6.15.0' }
      modelo = await ModeloMl.findOneAndUpdate({ huella }, { $setOnInsert: { huella, objetivo: t.objetivo, resultado, creadoEl: new Date() } }, { upsert: true, new: true }).lean()
    }
    salida.push({ id: modelo._id, objetivo: t.objetivo, estado: modelo.resultado.estado, cobertura: modelo.resultado.cobertura, evaluacion: modelo.resultado.evaluacion ?? null })
  }
  await evaluarPrediccionesMl()
  await registrarPronosticosMl(series.map((s) => s.keyword))
  return { modo: 'sombra', modelos: salida, integracion: { ventanasUnidas: unidas.datos.length, omitidas: unidas.omitidas } }
}

export async function registrarPronosticosMl(keywords, { ahora = new Date() } = {}) {
  const modelo = await ModeloMl.findOne({ objetivo: 'busquedas-google', 'resultado.estado': 'sombra',
    creadoEl: { $gte: new Date(+ahora - 90 * 86400e3), $lte: ahora } }).sort({ creadoEl: -1 }).lean()
  if (!modelo) return { estado: 'sin-modelo-entrenado', pronosticos: [] }
  const series = await seriesActuales({ keywords })
  const pronosticos = []
  const mesActual = indiceMes(ahora.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }).slice(0, 7))
  for (const serie of series) {
    if (+new Date(serie.capturadoEl) > +ahora) continue
    const ultimoMes = indiceMes(serie.meses.at(-1)?.periodo)
    if (ultimoMes === null || mesActual - ultimoMes > 2 || ultimoMes >= mesActual) continue
    for (const datos of pronosticarDemanda(modelo.resultado, serie)) {
      // Exigir horizonte futuro: nunca registrar un hindcast como pronóstico.
      if (indiceMes(datos.periodo) <= mesActual) continue
      const huella = huellaDe({ modelo: String(modelo._id), serie: String(serie._id), periodo: datos.periodo })
      const doc = await PrediccionMl.findOneAndUpdate({ huella }, { $setOnInsert: {
        huella, modeloId: modelo._id, serieId: serie._id, keyword: serie.keyword, emitidoEl: ahora,
        periodo: datos.periodo, datos,
      } }, { upsert: true, new: true }).lean()
      pronosticos.push({ keyword: serie.keyword, id: doc._id, ...doc.datos })
    }
  }
  return { estado: 'sombra', modeloId: modelo._id, objetivo: 'busquedas-google', pronosticos }
}

export async function evaluarPrediccionesMl() {
  const pendientes = await PrediccionMl.find({ evaluacion: null }).lean()
  if (!pendientes.length) return { evaluadas: 0 }
  const series = await seriesActuales({ keywords: [...new Set(pendientes.map((p) => p.keyword))] })
  const porKeyword = new Map(series.map((s) => [s.keyword, s]))
  let evaluadas = 0
  for (const p of pendientes) {
    const s = porKeyword.get(p.keyword)
    const real = s?.meses.find((m) => m.periodo === p.periodo)?.valor
    if (!Number.isFinite(real) || +new Date(s.capturadoEl) <= +new Date(p.emitidoEl)) continue
    await PrediccionMl.updateOne({ _id: p._id, evaluacion: null }, { $set: { evaluacion: {
      real, errorAbsoluto: Math.abs(real - p.datos.estimado),
      errorReferencia: Math.abs(real - p.datos.referencia), serieId: s._id, medidoEl: s.capturadoEl,
    } } })
    evaluadas++
  }
  return { evaluadas }
}

// Evidencia observada del catálogo actual para descubrir productos vecinos.
// No se presenta una tasa propia como tasa esperada de un candidato nuevo.
export async function perfilesPropiosMl({ ahora = new Date() } = {}) {
  const datos = ventanasIndependientes(await ObservacionProductoMl.find({ hasta: { $gte: new Date(+ahora - 90 * 86400e3), $lte: ahora } }).lean())
  const grupos = new Map()
  for (const o of datos) grupos.set(o.itemId, [...(grupos.get(o.itemId) ?? []), o])
  return [...grupos.values()].map((xs) => {
    const ultimo = xs.at(-1), visitas = xs.reduce((a, o) => a + o.visitas, 0), unidades = xs.reduce((a, o) => a + o.unidades, 0)
    return { itemId: ultimo.itemId, titulo: ultimo.titulo, categoria: ultimo.categoria, precio: ultimo.precio,
      ventanasSinSolapar: xs.length, visitas, unidades, unidadesPor100Visitas: unidades / visitas * 100,
      desde: xs[0].desde, hasta: ultimo.hasta, alcance: 'resultado-propio-observado; no tasa transferible ni rentabilidad' }
  }).sort((a, b) => b.unidades - a.unidades).slice(0, 20)
}

export async function estadoMl({ ahora = new Date() } = {}) {
  const [capturas, observaciones, modelos, predicciones, evaluadas, integracion] = await Promise.all([
    seriesActuales(), ObservacionProductoMl.find({ hasta: { $gte: new Date(+ahora - 730 * 86400e3), $lte: ahora } }).lean(),
    ModeloMl.aggregate([{ $sort: { creadoEl: -1 } }, { $group: { _id: '$objetivo', modelo: { $first: '$$ROOT' } } }]),
    PrediccionMl.countDocuments(), PrediccionMl.countDocuments({ evaluacion: { $ne: null } }),
    estadoIntegracion({ ahora }),
  ])
  const ventanas = ventanasIndependientes(observaciones)
  const mesActual = indiceMes(ahora.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }).slice(0, 7))
  const series = capturas.filter((s) => +new Date(s.capturadoEl) <= +ahora).map((s) => {
    const meses = normalizarMeses(s.meses).filter((m) => indiceMes(m.periodo) < mesActual)
    const ultimo = indiceMes(meses.at(-1)?.periodo)
    return { keyword: s.keyword, meses: meses.length, desde: meses[0]?.periodo ?? null,
      hasta: meses.at(-1)?.periodo ?? null, capturadoEl: s.capturadoEl,
      continua24Meses: ultimo !== null && variablesDemanda(meses, ultimo, 3) !== null,
      reciente: ultimo !== null && mesActual - ultimo <= 2 }
  })
  const ultimaCaptura = series.reduce((ultima, s) => Math.max(ultima, +new Date(s.capturadoEl)), 0)
  return { modo: 'sombra', usaParaDecidir: false, consultadoEl: ahora,
    alcance: { usaCostoCompra: false, estimaRentabilidad: false }, integracion,
    fuentes: { demanda: { ultimaCapturaEl: ultimaCaptura ? new Date(ultimaCaptura) : null },
      comercial: { ultimaVentanaEl: ventanas.at(-1)?.hasta ?? null, historialDias: 730, perfilDias: 90 } },
    cobertura: { keywords: series.length, con24Meses: series.filter((s) => s.continua24Meses).length,
      productos: new Set(ventanas.map((o) => o.itemId)).size, ventanasIndependientes: ventanas.length, predicciones, evaluadas },
    series: series.slice(0, 100),
    modelos: modelos.map(({ modelo: m }) => ({ id: m._id, objetivo: m.objetivo, creadoEl: m.creadoEl,
      vigente: m.resultado.estado === 'sombra' && +new Date(m.creadoEl) <= +ahora && +ahora - +new Date(m.creadoEl) <= 90 * 86400e3,
      estado: m.resultado.estado, cobertura: m.resultado.cobertura, evaluacion: m.resultado.evaluacion ?? null })) }
}
