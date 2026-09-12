import { parentPort, workerData } from 'node:worker_threads'
import { entrenarDemanda } from './demanda.js'
import { entrenarComercial } from './comercial.js'
import { OBJETIVO_CONTEXTO } from './contexto.js'

if (!parentPort) throw new Error('ejecutar como worker de entrenamiento')
const entrenar = workerData.objetivo === 'busquedas-google' ? entrenarDemanda
  : workerData.objetivo === OBJETIVO_CONTEXTO ? (datos) => entrenarComercial(datos, { conContexto: true }) : entrenarComercial
parentPort.postMessage(entrenar(workerData.datos))
