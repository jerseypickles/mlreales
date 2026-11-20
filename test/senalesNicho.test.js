import test from 'node:test'
import assert from 'node:assert/strict'
import { nivelEntre, tendenciaDeVenta, senalGoogle, senalBusquedaMl, senalVentaMl, ventaNivelada, lecturaDeDemanda, veredictoMedido, aplicarSenales, FACTOR_RUIDO } from '../src/services/senalesNicho.js'
import { terminosDeAnchas } from '../src/services/panoramaMl.js'
import { mismaBusqueda } from '../src/services/busquedasReales.js'

const mesa = Array.from({ length: 30 }, (_, i) => i + 1) // 1…30: tercios en 11 y 21

test('señales: el nivel es el tercio entre los nichos de la mesa, no una vara fija', () => {
  assert.deepEqual(nivelEntre(25, mesa), { nivel: 'alto', lugar: 80 })
  assert.equal(nivelEntre(15, mesa).nivel, 'medio')
  assert.equal(nivelEntre(3, mesa).nivel, 'bajo')
  assert.deepEqual(nivelEntre(5, [1, 2, 3]), { nivel: null, lugar: null }, 'con tan pocos nichos no hay tercios')
  assert.deepEqual(nivelEntre(null, mesa), { nivel: null, lugar: null })
})

test('señales: la venta sube o baja solo si se aleja más que el ruido medido entre dos mediciones', () => {
  assert.equal(tendenciaDeVenta([2, 2, 2, 5, 6, 5]), 'sube')
  assert.equal(tendenciaDeVenta([6, 5, 6, 2, 2, 1]), 'baja')
  assert.equal(tendenciaDeVenta([4, 5, 4, 5, 6, 5]), 'estable', `un cambio menor a ×${FACTOR_RUIDO} es el vaivén normal`)
  assert.equal(tendenciaDeVenta([0.1, 0.1, 0.3, 0.3]), 'estable', 'de casi nada a casi nada no es triplicarse')
  assert.equal(tendenciaDeVenta([2, 9, 9]), null, 'con tres mediciones no hay dos mitades')
})

test('señales: Google dice cuánto se busca y cómo viene contra el mercado', () => {
  const g = senalGoogle({ busquedasMes: 25, variacionInteranualPct: -20, variacionRelativaPct: 2 }, mesa)
  assert.deepEqual([g.nivel, g.tendencia, g.contraMercado, g.confianza], ['alto', 'estable', true, 'alta'], 'cayó con todo el mercado: está plano')
  assert.equal(senalGoogle({ busquedasMes: 25, variacionInteranualPct: 30 }, mesa).tendencia, 'sube')
  assert.equal(senalGoogle({ busquedasMes: 3, keywordMedida: 'otra frase' }, mesa).confianza, 'media')
  assert.deepEqual([senalGoogle(null, mesa).nivel, senalGoogle(null, mesa).confianza], [null, null])
})

test('señales: la búsqueda en ML es el autocompletado más las tendencias de categorías anchas', () => {
  assert.equal(mismaBusqueda('nivel láser', 'Nivel Laser Autonivelante 360'), true)
  assert.equal(mismaBusqueda('soporte monitor', 'soporte'), false)
  const categorias = new Map([['R', { ruta: 'Herramientas' }], ['H', { ruta: 'Herramientas > Medición > Niveles' }]])
  const anchas = { categorias: 1, terminos: terminosDeAnchas([
    { categoriaId: 'R', dia: '2026-11-10', terminos: ['nivel laser', 'taladro'], grupos: null },
    { categoriaId: 'R', dia: '2026-11-17', terminos: [], grupos: { crecen: ['taladro'], buscadas: ['nivel laser'], suben: ['sierra circular'] } },
    { categoriaId: 'H', dia: '2026-11-17', terminos: [], grupos: { crecen: ['nivel laser verde'], buscadas: [], suben: [] } }, // una hoja no cuenta
  ], categorias) }
  assert.deepEqual(anchas.terminos.map((t) => [t.termino, t.grupo, t.semanas, t.de]), [['taladro', 'crecen', 2, 2], ['nivel laser', 'buscadas', 2, 2], ['sierra circular', 'suben', 1, 2]])
  const b = senalBusquedaMl('nivel laser', { nivel: 'alto', posicion: 2, deCuantas: 8, prefijo: 'nivel' }, anchas)
  assert.deepEqual([b.nivel, b.enTendencias.categoria, b.enTendencias.grupo, b.tendencia, b.confianza], ['alto', 'Herramientas', 'buscadas', 'estable', 'media'])
  assert.equal(senalBusquedaMl('sierra circular', { nivel: 'medio' }, anchas).tendencia, 'sube')
  const fuera = senalBusquedaMl('lampara de mesa', { nivel: 'alto' }, anchas)
  assert.deepEqual([fuera.enTendencias, fuera.tendenciasMedidas, fuera.confianza], [null, true, 'baja'], 'solo el autocompletado es un dato flojo')
  assert.equal(senalBusquedaMl('lampara de mesa', { nivel: 'alto' }, null).tendenciasMedidas, false, 'sin capturas, no aparecer no dice nada')
  assert.equal(senalBusquedaMl('x', { nivel: 'renombrar' }).nivel, 'otra-frase')
})

test('señales: la venta en ML se nivela por temporada y pide dos mediciones', () => {
  assert.equal(ventaNivelada(10, 0.6), 10 / 0.6)
  assert.equal(ventaNivelada(10, 0.2), 20, 'la corrección tiene tope')
  const v = senalVentaMl({ reseniasDia: 25, scans: 5, factorTemporada: 1, serie: [20, 22, 25, 24, 26] }, mesa)
  assert.deepEqual([v.nivel, v.tendencia, v.confianza, v.temporada], ['alto', 'estable', 'alta', null])
  assert.equal(senalVentaMl({ reseniasDia: 25, scans: 2, factorTemporada: 0.7 }, mesa).temporada, 'baja')
  assert.equal(senalVentaMl({ reseniasDia: 25, scans: 2, factorTemporada: 0.7 }, mesa).confianza, 'media')
  const una = senalVentaMl({ reseniasDia: 25, scans: 1 }, mesa)
  assert.deepEqual([una.nivel, una.valor, una.confianza], [null, null, null], 'una sola medición no es una venta medida')
})

test('lectura de demanda: manda la venta en ML; Google la explica o la reemplaza mientras no hay venta', () => {
  const s = (venta, google, extra = {}) => ({ ventaMl: { nivel: venta, valor: venta ? 5 : null, nivelada: venta ? 5 : null, scans: venta ? 4 : 0, confianza: venta ? 'alta' : null, tendencia: null, temporada: null, ...extra }, google: { nivel: google }, busquedaMl: { nivel: 'alto' } })
  // casi no se vende: menos de una reseña nueva al día entre todas las publicaciones
  const muerto = lecturaDeDemanda(s('bajo', 'alto', { valor: 0, nivelada: 0 }))
  assert.deepEqual([muerto.nivel, muerto.caso], ['casi-nula', 'se-busca-no-se-vende'])
  assert.match(muerto.frase, /En Google se busca mucho, pero en Mercado Libre casi no se vende/)
  assert.equal(lecturaDeDemanda(s('bajo', 'bajo', { valor: 0.4, nivelada: 0.4 })).caso, 'casi-no-se-vende')
  // el tercio bajo no es lo mismo que no venderse
  const poco = lecturaDeDemanda(s('bajo', 'medio'))
  assert.deepEqual([poco.nivel, poco.caso], ['debil', 'vende-poco'])
  assert.match(poco.frase, /^Está entre los nichos que menos venden en Mercado Libre\./)
  assert.equal(lecturaDeDemanda(s('bajo', 'alto')).caso, 'se-busca-vende-poco')
  const sinGoogle = lecturaDeDemanda(s('alto', 'bajo'))
  assert.deepEqual([sinGoogle.nivel, sinGoogle.caso, sinGoogle.firme], ['fuerte', 'vende-sin-google', true])
  assert.equal(lecturaDeDemanda(s('alto', 'alto')).frase, 'Está entre los nichos que más venden en Mercado Libre y también se busca mucho en Google.')
  assert.equal(lecturaDeDemanda(s('medio', 'medio')).nivel, 'media')
  assert.match(lecturaDeDemanda(s('medio', 'medio', { tendencia: 'baja' })).frase, /La venta viene bajando\.$/)
  const nuevo = lecturaDeDemanda(s(null, 'alto', { scans: 1 }))
  assert.deepEqual([nuevo.nivel, nuevo.caso], ['sin-medir', 'sin-venta-medida'])
  assert.match(nuevo.frase, /falta 1 medición/)
  const invierno = lecturaDeDemanda(s('bajo', 'alto', { temporada: 'fuera', valor: 0.2, nivelada: 0.4 }))
  assert.deepEqual([invierno.nivel, invierno.caso], ['sin-medir', 'fuera-de-temporada'], 'fuera de temporada la venta de hoy no condena al nicho')
})

test('veredicto por lo medido: tres preguntas con reglas a la vista', () => {
  const contexto = { todasEntrada: mesa.map((x) => x * 3), todasEconomia: mesa.map((x) => x * 3) }
  const fuerte = { nivel: 'fuerte', frase: 'Entre los que más venden.' }, media = { nivel: 'media', frase: 'Ritmo medio.' }
  const debil = { nivel: 'debil', frase: 'Entre los que menos venden.' }, nula = { nivel: 'casi-nula', frase: 'Casi no se vende.' }
  const bien = veredictoMedido({ demanda: fuerte, entrada: 80, economia: 70, muro: 500 }, contexto)
  assert.equal(bien.veredicto, 'entrar')
  assert.deepEqual(bien.pasos.map((p) => [p.id, p.estado]), [['demanda', 'bien'], ['entrada', 'bien'], ['plata', 'bien']])
  // demanda fuerte pero entrar cuesta: con condiciones, y la condición se dice
  const dificil = veredictoMedido({ demanda: fuerte, entrada: 10, economia: 70, muro: 10000 }, contexto)
  assert.equal(dificil.veredicto, 'entrar_con_condiciones')
  assert.match(dificil.porQue, /entrar cuesta/)
  assert.match(dificil.pasos[1].frase, /\+10\.000 vendidos/)
  assert.equal(veredictoMedido({ demanda: media, entrada: 80, economia: 70 }, contexto).veredicto, 'entrar_con_condiciones')
  // vender menos que la mayoría no cierra la puerta: el producto propio que más vende puede estar en un nicho así
  const poco = veredictoMedido({ demanda: debil, entrada: 90, economia: 90 }, contexto)
  assert.equal(poco.veredicto, 'entrar_con_condiciones')
  assert.match(poco.porQue, /pide un producto distinto/)
  // lo que casi no se vende no se recomienda, por bien que se vea lo demás
  const no = veredictoMedido({ demanda: nula, entrada: 90, economia: 90 }, contexto)
  assert.deepEqual([no.veredicto, no.porQue], ['no_entrar', 'Casi no se vende en Mercado Libre.'])
  // la venta no paga ni su publicidad
  assert.equal(veredictoMedido({ demanda: fuerte, entrada: 80, economia: 0 }, contexto).veredicto, 'no_entrar')
  // sin venta medida no se inventa un veredicto
  assert.equal(veredictoMedido({ demanda: { nivel: 'sin-medir', caso: 'sin-venta-medida', frase: '…' }, entrada: 80, economia: 70 }, contexto).veredicto, 'falta-medir')
  assert.equal(veredictoMedido({ demanda: fuerte, entrada: 80, economia: 70, midiendo: true }, contexto).veredicto, 'falta-medir')
})

test('señales: se aplican a toda la mesa con lo que ya leyó', async () => {
  const oportunidades = Array.from({ length: 9 }, (_, i) => ({ nichoId: `n${i}`, keyword: `producto ${i}`, curvaAnual: { busquedasMes: (9 - i) * 1000, curva: Array(12).fill(10) },
    nivelBusqueda: { nivel: 'alto' }, componentes: { entrada: 50 + i, economia: 40 + i }, vendidosHistoricos: { maximoPorItem: 1000 } }))
  const resenas = new Map(oportunidades.map((o, i) => [o.nichoId, { mediana: i, scans: 4, meses: [10], serie: [i, i, i, i] }]))
  resenas.delete('n8') // un nicho recién abierto
  const r = await aplicarSenales(oportunidades, { resenas, anchas: null, factorTemporada: () => 1 })
  assert.equal(r.nichos, 9)
  assert.equal(r.demanda['sin-medir'], 1)
  // el más buscado en Google casi no se vende: la lectura lo dice y el veredicto no lo recomienda
  assert.deepEqual([oportunidades[0].senales.google.nivel, oportunidades[0].senales.ventaMl.nivel, oportunidades[0].demanda.caso, oportunidades[0].veredictoMedido.veredicto],
    ['alto', 'bajo', 'se-busca-no-se-vende', 'no_entrar'])
  // el que le sigue vende poco frente a los demás, pero vende: queda con condiciones
  assert.deepEqual([oportunidades[1].senales.ventaMl.nivel, oportunidades[1].demanda.nivel, oportunidades[1].veredictoMedido.veredicto], ['bajo', 'debil', 'entrar_con_condiciones'])
  assert.deepEqual([oportunidades[7].senales.google.nivel, oportunidades[7].demanda.caso], ['bajo', 'vende-sin-google'])
  assert.equal(oportunidades[8].veredictoMedido.veredicto, 'falta-medir')
})

test('lo medido viaja al analista tal como está en la mesa, y si el nicho no está no se inventa', async () => {
  const { lecturaMedidaDeNicho } = await import('../src/services/senalesNicho.js')
  const fila = { nichoId: 'n1', demanda: { nivel: 'casi-nula', frase: 'Casi no se vende.', tendencia: null, firme: true },
    veredictoMedido: { veredicto: 'no_entrar', porQue: 'Casi no se vende en Mercado Libre.', pasos: [{ id: 'demanda', pregunta: '¿Hay demanda?', estado: 'problema', frase: 'Casi no se vende.' }] } }
  const leer = async ({ todos }) => { assert.equal(todos, true, 'también los nichos que no están en la vista por defecto'); return { oportunidades: [fila, { nichoId: 'n2' }] } }
  const m = await lecturaMedidaDeNicho('n1', { leer })
  assert.deepEqual([m.veredicto, m.demanda.nivel, m.preguntas[0].respuesta], ['no_entrar', 'casi-nula', 'problema'])
  assert.match(m.regla, /venta medida en Mercado Libre/)
  assert.equal(await lecturaMedidaDeNicho('n2', { leer }), null, 'una fila sin señales no dice nada')
  assert.equal(await lecturaMedidaDeNicho('otro', { leer }), null)
})
