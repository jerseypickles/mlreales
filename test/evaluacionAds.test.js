import test from 'node:test'
import assert from 'node:assert/strict'
import { economiaCompleta, configuracionCampana, cambioDeConfiguracion, evaluarAjustesAds, describirCambio, notasPorCambio } from '../src/services/ml/evaluacionAds.js'
import { transicionesSemanales, bitacoraProducto, economiaVenta } from '../src/services/ml/planCampanas.js'
import { casoAjusteAds } from './helpers/adsFixtures.js'

const evaluar = (c) => evaluarAjustesAds(c.recs ?? [c.rec], new Map([['A', c.dias]]), new Map([['A', c.eco]]), { hoy: c.hoy, cambios: c.cambios ?? [c.cambio] })

test('economía completa distingue cero declarado de costo, comisión o envío desconocidos', () => {
  const eco = casoAjusteAds().eco
  assert.equal(economiaCompleta({ ...eco, costo: 0, envio: 0, cargoFijo: 0 }), true)
  for (const k of ['costo', 'envio', 'cargoFijo', 'comisionPct']) for (const v of [null, undefined, NaN, -1]) assert.equal(economiaCompleta({ ...eco, [k]: v }), false)
  assert.equal(economiaCompleta({ ...eco, envioSupuesto: true }), false)
})

test('gasto efectivo distinto no crea cambio de configuración; la primera lectura es una base', () => {
  const c = { id: 1, estado: 'active', presupuestoDiario: 1000 }
  const ads = { B: { campanaId: 2 }, A: { campanaId: 1, estado: 'active' } }
  const config = configuracionCampana(c, ads)
  const base = cambioDeConfiguracion(1, config, null, new Date('2025-01-01'))
  assert.equal(base.antes, null)
  assert.equal(cambioDeConfiguracion(1, configuracionCampana({ ...c, metricas: { cost: 9000 } }, ads), base, new Date('2025-01-02')), null)
  const subida = cambioDeConfiguracion(1, { ...config, presupuestoDiario: 1500 }, base, new Date('2025-01-03'))
  assert.deepEqual(subida.antes, config)
  assert.notEqual(subida.clave, base.clave)
  assert.equal(cambioDeConfiguracion(1, subida.despues, base, new Date('2025-01-03')).clave, subida.clave)
})

test('un ajuste observado se evalúa una vez con ingresos cobrados, sin atribuir autoría ni causalidad', () => {
  const c = casoAjusteAds()
  const r = evaluar({ ...c, recs: [c.rec, { ...c.rec, calculadoEl: '2025-01-08T16:00:00Z' }] })
  assert.equal(r.evaluadas, 1)
  assert.equal(r.tasaAcierto, 100)
  assert.equal(r.detalle[0].plataAntes, 38500)
  assert.equal(r.detalle[0].plataDespues, 80500)
  assert.equal(r.tasaSinSeguir, null)
  assert.match(r.nota, /no confirma quién/)
  assert.equal(evaluar({ ...c, cambios: [] }).evaluadas, 0)
  assert.equal(evaluar({ ...c, cambios: [{ ...c.cambio, antes: null }] }).evaluadas, 0)
})

test('no usa costos añadidos después ni recomendaciones emitidas después del ajuste', () => {
  const c = casoAjusteAds()
  assert.equal(evaluar({ ...c, rec: { ...c.rec, metricas: { economia: { ...c.eco, costo: null } } } }).evaluadas, 0)
  assert.equal(evaluar({ ...c, rec: { ...c.rec, calculadoEl: '2025-01-11T16:00:00Z' } }).evaluadas, 0)
  assert.equal(evaluar({ ...c, eco: { ...c.eco, costo: 2200 } }).excluidas['economia-cambio'], 1)
  const congelada = { ...c.cambio, recomendaciones: [c.rec] }
  assert.equal(evaluar({ ...c, cambios: [congelada], recs: [] }).evaluadas, 1, 'el recálculo diario no borra la recomendación previa')
})

test('espera días completos y rechaza seguimiento ausente, evento, quiebre, precios o promoción distintos', () => {
  const c = casoAjusteAds()
  assert.equal(evaluar({ ...c, hoy: '2025-01-17' }).pendientes.length, 1)
  assert.equal(evaluar({ ...c, cambio: { ...c.cambio, ultimaVistaEl: '2025-01-12' } }).excluidas['seguimiento-configuracion-incompleto'], 1)
  for (const cambio of [{ evento: true }, { stockFraccion: null }, { stockFraccion: 0.5 }, { cambioLogistica: true }, { precio: 8000 }, { promo: 'rebaja' }, { adsMedido: false }, { ingresosClp: null }]) {
    assert.equal(evaluar({ ...c, dias: c.dias.map((d, i) => i === 12 ? { ...d, ...cambio } : d) }).evaluadas, 0, JSON.stringify(cambio))
  }
})

test('no confunde campañas compartidas ni cambios simultáneos con una prueba individual', () => {
  const c = casoAjusteAds()
  assert.equal(evaluar({ ...c, cambio: { ...c.cambio, despues: { ...c.cambio.despues, roasObjetivo: 4 } } }).evaluadas, 0)
  const antes = { ...c.antes, anuncios: [...c.antes.anuncios, { itemId: 'B', estado: 'active' }] }
  const r = evaluar({ ...c, rec: { ...c.rec, configuracion: antes }, cambio: { ...c.cambio, antes, despues: { ...antes, presupuestoDiario: 1500 } } })
  assert.equal(r.excluidas['campana-compartida'], 1)
  assert.equal(evaluar({ ...c, cambios: [c.cambio, { ...c.cambio, clave: 'otro', observadoEl: '2025-01-15T16:00:00Z', antes: null }] }).excluidas['otro-cambio-en-ventana'], 1)
})

test('la bitácora no declara ganancias ni recomienda escalar sin costos completos', () => {
  const c = casoAjusteAds()
  const dias = c.dias.map(d => ({ ...d, unidadesAds: d.unidades, ventaAds: d.ingresosClp }))
  const r = bitacoraProducto(dias, { ...c.eco, costo: null, esTecho: true })
  assert.equal(r.veredicto, 'sin-economia'); assert.equal(r.acumulado, null); assert.equal(r.tendencia, null)
  assert.ok(r.semanas.every(s => s.plata === null))
})

test('transiciones no saltan semanas incompletas ni aprenden con mercadería supuesta gratis', () => {
  const c = casoAjusteAds(), eco = economiaVenta({ precio: 10000, comisionPct: 10, envio: 500, costo: 2000 })
  const dias = c.dias.map(d => ({ ...d, unidadesAds: d.unidades, ventaAds: d.ingresosClp }))
  assert.ok(transicionesSemanales(dias, eco).length > 0)
  assert.equal(transicionesSemanales(dias, { ...eco, costo: null }).length, 0)
  const r = transicionesSemanales(dias.map((d, i) => i >= 7 && i < 14 ? { ...d, ingresosClp: null } : d), eco)
  assert.deepEqual(r.map(x => x.desde), ['2025-01-15'])
})

test('no reutiliza la misma semana para dos ajustes ni un costo recién registrado', () => {
  const c = casoAjusteAds()
  const rec2 = { ...c.rec, dia: '2025-01-18', calculadoEl: '2025-01-18T16:00:00Z', budgetDiario: 2000, configuracion: c.cambio.despues }
  const cambio2 = { ...c.cambio, clave: 'segundo', observadoEl: '2025-01-19T16:00:00Z',
    anteriorDesde: c.cambio.observadoEl, anteriorVistaEl: '2025-01-19T15:00:00Z', antes: c.cambio.despues,
    despues: { ...c.cambio.despues, presupuestoDiario: 2000 } }
  const r = evaluar({ ...c, recs: [c.rec, rec2], cambios: [c.cambio, cambio2] })
  assert.equal(r.evaluadas, 1); assert.equal(r.excluidas['ventanas-solapadas'], 1)
  const eco = { ...c.eco, costoVigenteDesde: '2025-01-05' }
  assert.equal(evaluar({ ...c, eco, rec: { ...c.rec, metricas: { economia: eco } } }).excluidas['costo-recien-registrado'], 1)
})

test('una respuesta parcial o sin results no certifica cobertura de anuncios', async () => {
  const { lecturaCompletaAds } = await import('../src/services/ml/evaluacionAds.js')
  assert.equal(lecturaCompletaAds({}), false)
  assert.equal(lecturaCompletaAds({ results: [], paging: { total: 3 } }), false)
  assert.equal(lecturaCompletaAds({ results: Array(50).fill({}) }), false)
  assert.equal(lecturaCompletaAds({ results: [{}], paging: { total: 1 } }), true)
  assert.equal(lecturaCompletaAds({ results: [] }), true)
})

// ─── nota por hechos de cada decisión sobre una campaña ─────────────────────
const config = (x = {}) => ({ estado: 'active', presupuestoDiario: 4000, roasObjetivo: 5, estrategia: 'PROFITABILITY', anuncios: [{ itemId: 'A', estado: 'active' }], ...x })
const ecoA = { comisionPct: 15, envio: 1000, costo: 5000, cargoFijo: 0 }
// del 1 al 20 de marzo: hasta el 10 gasta 2.000 al día y vende una; después gasta 1.000 y vende una
const diasA = (cambios = {}) => Array.from({ length: 20 }, (_, i) => {
  const dia = `2026-03-${String(i + 1).padStart(2, '0')}`
  return { dia, evento: false, adsMedido: true, stockFraccion: 1, gasto: i + 1 <= 10 ? 2000 : 1000, unidadesAds: 1, ventaAds: 10000, ...(cambios[dia] ?? {}) }
})
const decision = (dia, antes, despues, extra = {}) => ({ clave: `c-${dia}`, campanaId: 7, observadoEl: `${dia}T15:00:00Z`, antes, despues, ...extra })
const notas = (cambios, { hoy = '2026-03-20', dias = diasA() } = {}) => notasPorCambio(cambios, new Map([['A', dias]]), new Map([['A', ecoA]]), { hoy, nombreDe: () => 'CAMPAÑA' })

test('un cambio de campaña se describe en palabras y lo que Mercado Libre mueve por stock no es una decisión', () => {
  const antes = config({ anuncios: [{ itemId: 'A', estado: 'active' }, { itemId: 'B', estado: 'active' }, { itemId: 'C', estado: 'active' }] })
  const d = describirCambio(antes, config({ presupuestoDiario: 2000, roasObjetivo: 6, anuncios: [{ itemId: 'A', estado: 'active' }, { itemId: 'B', estado: 'paused' }] }))
  assert.deepEqual(d.partes.map((p) => [p.dial, p.sentido]), [['presupuesto', 'baja'], ['roas', 'sube'], ['anuncios', 'baja']])
  assert.equal(d.texto, 'Bajaste el presupuesto de $4.000 a $2.000 al día, subiste el ROAS objetivo de 5 a 6 y sacaste 2 anuncios')
  // un anuncio que queda en espera por stock (o vuelve) no lo decidió el dueño
  assert.equal(describirCambio(config(), config({ anuncios: [{ itemId: 'A', estado: 'hold' }] })).partes.length, 0)
  assert.equal(describirCambio(config({ anuncios: [{ itemId: 'A', estado: 'hold' }] }), config()).partes.length, 0)
})

test('cada decisión recibe nota por la plata que dejaba la campaña antes y después, aunque cambie dos diales a la vez', () => {
  const c = decision('2026-03-10', config(), config({ presupuestoDiario: 2000, roasObjetivo: 6 }), { recomendaciones: [{ itemId: 'A', accion: 'bajar', calculadoEl: '2026-03-09T10:00:00Z' }] })
  const r = notas([c])
  const [caso] = r.casos
  // antes: 10.000 × 0,85 − 6.000 − 2.000 de gasto = 500 al día; después, con 1.000 de gasto, 1.500
  assert.deepEqual([caso.estado, caso.resultado, caso.antes.plataDia, caso.despues.plataDia, caso.antes.dias, caso.despues.dias], ['con-nota', 'mejoro', 500, 1500, 7, 7])
  assert.equal(caso.seguiaElPlan, true)
  assert.equal(caso.campana, 'CAMPAÑA')
  assert.match(caso.lectura, /Antes dejaba \$500 al día y después \$1\.500: mejoró/)
  assert.deepEqual(r.resumen, { decisiones: 1, conNota: 1, n: 1, mejoraron: 1, empeoraron: 0, parecidos: 0, midiendo: 0, siguiendoElPlan: { n: 1, mejoraron: 1, empeoraron: 0 }, sinSeguirlo: { n: 0, mejoraron: 0, empeoraron: 0 } })
  // un cambio que solo mueve Mercado Libre por stock no entra a la cuenta
  assert.equal(notas([decision('2026-03-10', config(), config({ anuncios: [{ itemId: 'A', estado: 'hold' }] }))]).casos.length, 0)
})

test('los días con evento o sin stock no cuentan, y una nota espera sus días o se pierde si la campaña se cambia de nuevo', () => {
  const c = decision('2026-03-10', config(), config({ presupuestoDiario: 2000 }))
  // un día de evento y uno sin stock después del cambio: se saltan y se completan los siete con los días siguientes
  const conHuecos = notas([c], { dias: diasA({ '2026-03-12': { evento: true }, '2026-03-13': { stockFraccion: 0 } }) }).casos[0]
  assert.deepEqual([conHuecos.estado, conHuecos.despues.dias, conHuecos.despues.plataDia], ['con-nota', 7, 1500])
  // a los dos días todavía se está midiendo
  const reciente = notas([c], { hoy: '2026-03-13' }).casos[0]
  assert.deepEqual([reciente.estado, reciente.faltanDias], ['midiendo', 3])
  // si la campaña se cambia otra vez a los dos días, la primera queda sin nota y la segunda sin base
  const otra = decision('2026-03-12', config({ presupuestoDiario: 2000 }), config({ presupuestoDiario: 3000 }))
  const dos = notas([c, otra]).casos
  assert.deepEqual(dos.map((k) => [k.dia, k.estado]), [['2026-03-12', 'sin-base'], ['2026-03-10', 'cambiada-antes']])
  // sin economía del producto que vendió no se inventa la plata
  assert.equal(notasPorCambio([c], new Map([['A', diasA()]]), new Map(), { hoy: '2026-03-20' }).casos[0].estado, 'sin-base')
})

