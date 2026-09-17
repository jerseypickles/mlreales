import { createHash } from 'node:crypto'
import { ajustarRidge, predecirRidge, errorPorGrupo } from './regresion.js'
import { contextoValido, VERSION_CONTEXTO, OBJETIVO_CONTEXTO, VARIABLES_CONTEXTO } from './contexto.js'

export const VERSION_COMERCIAL = 'unidades-visitas-v1'
const DIA = 86400e3
// Una promo de ML mueve el precio 5-15%; más que eso ya son dos precios
// distintos y el promedio de la semana no describe ninguno.
export const VARIACION_PRECIO_MAX = 1.15
const grupoPrueba = (id) => createHash('sha256').update(String(id)).digest()[0] % 4 === 0

// Muestreo determinista sin ventanas solapadas dentro de un mismo producto.
// Cero ventas SÍ es observación; ausencia de medición NO es cero.
export function ventanasIndependientes(observaciones) {
  const ultima = new Map()
  return [...observaciones].sort((a, b) => +new Date(a.hasta) - +new Date(b.hasta) || String(a.itemId).localeCompare(String(b.itemId)))
    .filter((o) => {
      const desde = +new Date(o.desde), hasta = +new Date(o.hasta)
      if (!o.itemId || !o.categoria || !Number.isFinite(desde) || !Number.isFinite(hasta) ||
        Math.abs(hasta - desde - 7 * DIA) > 1000 || !Number.isFinite(o.visitas) || o.visitas < 30 ||
        !Number.isFinite(o.unidades) || o.unidades < 0 || !Number.isFinite(o.precio) || o.precio <= 0 || typeof o.full !== 'boolean') return false
      if (o.precioMin > 0 && o.precioMax / o.precioMin > VARIACION_PRECIO_MAX) return false
      if (desde < (ultima.get(o.itemId) ?? -Infinity)) return false
      ultima.set(o.itemId, hasta)
      return true
    })
}

function variables(o, categorias, conContexto = false) {
  if (!categorias.includes(o.categoria) || !Number.isFinite(o.precio) || o.precio <= 0 || typeof o.full !== 'boolean') return null
  if (conContexto && !contextoValido(o.contexto)) return null
  // El producto nuevo tiene atributos, no una identidad ya memorizada.
  return [Math.log(o.precio), Number(o.full), ...categorias.slice(1).map((c) => Number(c === o.categoria)), ...(conContexto ? o.contexto.xs : [])]
}

function preparar(datos, categorias, conContexto = false) {
  return datos.flatMap((o) => {
    const xs = variables(o, categorias, conContexto)
    return xs ? [{ grupo: o.itemId, xs, fin: +new Date(o.hasta) / DIA,
      y: Math.log1p(o.unidades / o.visitas * 100) }] : []
  })
}

export function entrenarComercial(observaciones, { conContexto = false } = {}) {
  const datos = ventanasIndependientes(observaciones).filter((o) => !conContexto || contextoValido(o.contexto))
  const version = conContexto ? VERSION_CONTEXTO : VERSION_COMERCIAL
  const productos = new Set(datos.map((o) => o.itemId))
  const cobertura = { productos: productos.size, ventanas: datos.length,
    ...(conContexto ? { nichos: new Set(datos.map((o) => o.contexto.nichoId)).size } : {}) }
  const insuficiente = () => ({ estado: 'datos-insuficientes', version, cobertura })
  if (productos.size < 12 || datos.length < 72 || conContexto && cobertura.nichos < 3) return insuficiente()
  // Holdout de productos completos Y de fechas posteriores. Un SKU nunca
  // aparece en ambos lados de la prueba final de transferencia.
  const hasta = Math.max(...datos.map((o) => +new Date(o.hasta)))
  const corte = hasta - 28 * DIA
  const train = datos.filter((o) => !grupoPrueba(o.itemId) && +new Date(o.hasta) <= corte)
  const test = datos.filter((o) => grupoPrueba(o.itemId) && +new Date(o.desde) >= corte)
  const categorias = [...new Set(train.map((o) => o.categoria))].sort()
  const trainFilas = preparar(train, categorias, conContexto)
  const testFilas = preparar(test, categorias, conContexto)
  if (new Set(trainFilas.map((f) => f.grupo)).size < 8 || new Set(testFilas.map((f) => f.grupo)).size < 3 ||
      trainFilas.length < Math.max(40, (categorias.length + (conContexto ? VARIABLES_CONTEXTO.length + 1 : 0)) * 8) || testFilas.length < 9) return insuficiente()
  // Lambda fijo, no ajustado con la prueba. La prueba se reserva para comparar.
  const ajuste = ajustarRidge(trainFilas, { lambda: 10 })
  const referencia = errorPorGrupo(trainFilas.map((f) => ({ ...f, error: f.y })))
  const errores = testFilas.map((f) => ({ ...f, error: Math.abs(predecirRidge(ajuste, f.xs) - f.y), errorBase: Math.abs(referencia - f.y) }))
  const maeLog = errorPorGrupo(errores), maeBase = errorPorGrupo(errores, 'errorBase')
  // Ablación sobre EXACTAMENTE las mismas filas y corte: comprobar si el
  // contexto aporta algo frente al modelo que solo conoce precio/categoría/Full.
  let sinContexto = null
  if (conContexto) {
    const base = ajustarRidge(preparar(train, categorias), { lambda: 10 })
    sinContexto = errorPorGrupo(preparar(test, categorias).map((f) => ({ ...f, error: Math.abs(predecirRidge(base, f.xs) - f.y) })))
  }
  const referenciaEvaluacion = conContexto ? Math.min(maeBase, sinContexto) : maeBase
  const categoriasFinales = [...new Set(datos.map((o) => o.categoria))].sort()
  return { estado: 'sombra', version, objetivo: conContexto ? OBJETIVO_CONTEXTO : 'unidades-por-visita', cobertura,
    ...(conContexto ? { variablesContexto: VARIABLES_CONTEXTO,
      rangosContexto: VARIABLES_CONTEXTO.map((_, i) => ({ minimo: Math.min(...datos.map((d) => d.contexto.xs[i])), maximo: Math.max(...datos.map((d) => d.contexto.xs[i])) })) } : {}),
    evaluacion: { tipo: 'productos-no-vistos-y-fechas-futuras', corte: new Date(corte),
      productosTrain: new Set(trainFilas.map((f) => f.grupo)).size, productosPrueba: new Set(testFilas.map((f) => f.grupo)).size,
      ventanasPrueba: testFilas.length, maeLog, referencia: referenciaEvaluacion,
      ...(conContexto ? { referenciaPromedio: maeBase, referenciaSinContexto: sinContexto,
        mejoraSobreSinContextoPct: sinContexto > 0 ? (1 - maeLog / sinContexto) * 100 : null } : {}),
      superaReferencia: referenciaEvaluacion > 0 && maeLog < referenciaEvaluacion * 0.95 },
    categorias: categoriasFinales,
    dominios: categoriasFinales.map((categoria) => {
      const precios = datos.filter((d) => d.categoria === categoria).map((d) => d.precio)
      const deCategoria = datos.filter((d) => d.categoria === categoria)
      return { categoria, minimo: Math.min(...precios), maximo: Math.max(...precios),
        productos: new Set(deCategoria.map((d) => d.itemId)).size,
        logisticas: [...new Set(deCategoria.map((d) => d.full))] }
    }),
    ajuste: ajustarRidge(preparar(datos, categoriasFinales, conContexto), { lambda: 10 }) }
}

export function predecirComercial(modelo, producto) {
  if (![VERSION_COMERCIAL, VERSION_CONTEXTO].includes(modelo?.version) || !modelo.ajuste) return null
  const conContexto = modelo.version === VERSION_CONTEXTO
  if (conContexto && (!contextoValido(producto.contexto) || !Array.isArray(modelo.rangosContexto) ||
    modelo.rangosContexto.length !== VARIABLES_CONTEXTO.length || producto.contexto.xs.some((v, i) =>
    v < modelo.rangosContexto[i].minimo - 1e-10 || v > modelo.rangosContexto[i].maximo + 1e-10))) return null
  const dominio = modelo.dominios.find((d) => d.categoria === producto.categoria)
  if (!dominio || dominio.productos < 3 || !dominio.logisticas.includes(producto.full) || producto.precio < dominio.minimo || producto.precio > dominio.maximo) return null
  const xs = variables(producto, modelo.categorias, conContexto)
  if (!xs) return null
  return { unidadesPor100Visitas: Math.max(0, Math.expm1(Math.min(20, predecirRidge(modelo.ajuste, xs)))),
    alcance: conContexto ? 'categoria-precio-y-contexto-observados' : 'categoria-y-precio-observados',
    ...(conContexto ? { evidencia: producto.contexto } : {}), rentabilidad: 'no-estimada', causal: false }
}
