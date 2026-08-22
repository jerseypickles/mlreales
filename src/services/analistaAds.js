import { config } from '../config/env.js'
import { pedirJSON, llmDisponible } from './llm.js'
import { AnalisisAds } from '../models/AnalisisAds.js'
import { resumenAds } from './ads.js'
import { registrarGasto } from './gastos.js'

// EL ANALISTA DE PUBLICIDAD.
//
// ML deja mover exactamente dos diales, y los dos son por campaña: el
// PRESUPUESTO diario y el OBJETIVO DE ROAS. No hay puja por producto. Hasta
// ahora esos dos números se movían a ojo — el 2,30x de la Campaña 1 no salió de
// ningún análisis, quedó puesto y nadie lo revisó.
//
// Este analista opina sobre esos dos diales y nada más, porque es lo único
// accionable. Corre en el modelo más capaz porque decide dónde va la plata.
//
// LO QUE LO HACE DISTINTO DEL PANEL DE ML: ML compara el gasto contra la VENTA
// y de ahí saca su recomendación —por eso propone subir el presupuesto a
// $18.297 para traer 28 ventas, que al ticket de $3.726 sale $7.026 por venta,
// ROAS marginal 0,53x—. Acá se compara contra la CONTRIBUCIÓN y contra el ROAS
// de equilibrio de cada anuncio, que es lo que decide si ganas.
//
// Y lo que lo hace mejorar: lee su propia recomendación anterior. Sin eso
// opinaría de nuevo desde cero cada semana y nunca sabría si acertó.

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titular', 'recomendaciones'],
  properties: {
    titular: {
      type: 'string',
      description: 'Una frase: qué está pasando con la publicidad ahora. Concreta y con el número que la sostiene.',
    },
    revisionAnterior: {
      type: 'string',
      description:
        'Si hay análisis previo: ¿se aplicó lo que recomendaste? ¿qué pasó con los números desde entonces? Si no hay previo, string vacío. Sé honesto si tu consejo anterior no funcionó.',
    },
    recomendaciones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['campanaId', 'accion', 'porque', 'confianza'],
        properties: {
          campanaId: { type: 'number' },
          nombre: { type: 'string' },
          accion: {
            type: 'string',
            enum: ['subir-presupuesto', 'bajar-presupuesto', 'subir-objetivo', 'bajar-objetivo', 'mantener', 'cerrar'],
          },
          presupuestoSugerido: { type: ['number', 'null'], description: 'CLP/día, o null si no cambia' },
          roasObjetivoSugerido: { type: ['number', 'null'], description: 'ej 2.3, o null si no cambia' },
          porque: { type: 'string', description: 'El razonamiento, citando los números que lo sostienen.' },
          queEsperar: {
            type: 'string',
            description: 'Qué número debería moverse y en qué dirección si el consejo es correcto. Es lo que se revisa la próxima vez.',
          },
          confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
        },
      },
    },
    preguntas: {
      type: 'array',
      items: { type: 'string' },
      description: 'Lo que no puedes decidir con los datos y necesitas del importador. Vacío si no hay.',
    },
  },
}

const SISTEMA = `Eres el analista de publicidad de un importador chileno que vende en Mercado Libre con Full.

QUÉ PUEDES RECOMENDAR (y nada más):
- PRESUPUESTO diario por campaña, en CLP
- OBJETIVO DE ROAS por campaña (el panel lo pide como múltiplo: 2,3x)

ML no expone puja por producto. Por eso separar productos en campañas distintas
es la ÚNICA forma de tratarlos distinto, y por eso el objetivo de una campaña
sirve a todos los productos que tiene adentro.

CÓMO FUNCIONA EL DIAL, que es contraintuitivo:
- objetivo ALTO = más exigente = ML compra menos impresiones y gasta MENOS
- objetivo BAJO = más permisivo = ML puja más fuerte y gasta MÁS

QUÉ MIRAR, en orden:
1. El ROAS de EQUILIBRIO de cada anuncio: bajo ese número ese anuncio destruye
   margen. Sale del precio real menos comisión exacta menos envío Full. Un
   objetivo de campaña por debajo del equilibrio de sus productos es una orden
   de perder plata.
2. Si la campaña GASTA su presupuesto. Si no llega al tope, el limitante no es
   la plata sino el objetivo: subir el presupuesto no hará nada.
3. Si un producto rinde muy por encima del objetivo pero recibe poco gasto,
   está perdiendo subastas: candidato a campaña propia con objetivo más suelto.
4. El ROAS marginal, no el promedio. Las impresiones se compran de la mejor a
   la peor: que el promedio sea 4x no significa que la siguiente impresión lo
   sea. Por eso subir presupuesto rinde menos de lo que el promedio sugiere.

UNA CAMPAÑA NUEVA NO SE OPINA:
Cada campaña trae "diasConDatos" y "maduraParaOpinar". Si maduraParaOpinar es
false (menos de 7 días de vida), NO recomiendes cambiar sus diales: el gasto
responde en horas pero las conversiones tardan días, así que su ROAS todavía no
significa nada. Di "mantener" con confianza baja y explica cuántos días le
faltan para poder leerla. Mover un dial sobre una campaña de tres días es
decidir con ruido, y además borra el experimento que esa campaña estaba
corriendo.

LO QUE NO DEBES HACER:
- No recomiendes subir presupuesto solo porque el ROAS promedio es bueno.
- No uses el ACOS contra la venta como si fuera margen: la venta no es ganancia.
- No inventes que sabes la ganancia real: los costos de mercadería NO están
  cargados, así que todo lo que ves es CONTRIBUCIÓN, un techo.
- Si los datos no alcanzan para opinar de una campaña, di "mantener" con
  confianza baja y explica qué falta. Es mejor que inventar una recomendación.

Sé breve y concreto. Cada afirmación tuya debe apoyarse en un número del
contexto. Escribe en español de Chile, directo, sin adornos.`

// Arma el contexto: lo medido, no lo interpretado.
async function contexto({ dias = 7 } = {}) {
  const r = await resumenAds({ dias, forzar: true })
  if (!r) return null
  const economia = Object.entries(r.economia ?? {}).map(([id, e]) => ({
    itemId: id,
    titulo: e.titulo,
    campanaId: e.campanaId,
    precio: e.precio,
    gasto: e.gasto,
    venta: e.venta,
    unidades: e.unidades,
    impresiones: e.impresiones,
    clicks: e.clicks,
    roasReal: e.roasReal,
    roasEquilibrio: e.roas,
    contribucionGenerada: e.contribucionGenerada,
    resultado: e.resultado,
    veredicto: e.veredicto?.estado ?? null,
  }))
  const campanas = (r.campanas ?? []).map((c) => {
    const m = c.metricas ?? {}
    // el divisor son los días que la campaña VIVIÓ, no los de la ventana
    const d = c.diasConDatos ?? dias
    const gastoDia = m.cost ? Math.round(m.cost / d) : 0
    return {
      id: c.id,
      nombre: c.nombre,
      estado: c.estado,
      creadaEl: c.creadaEl,
      diasConDatos: d,
      maduraParaOpinar: c.maduraParaOpinar,
      presupuestoDiario: c.presupuestoDiario,
      roasObjetivo: c.roasObjetivo,
      gastoDia,
      usoPresupuestoPct: c.presupuestoDiario ? Math.round((gastoDia / c.presupuestoDiario) * 100) : null,
      roasReal: m.cost > 0 ? Math.round((m.total_amount / m.cost) * 100) / 100 : null,
      impresiones: m.prints ?? 0,
      clicks: m.clicks ?? 0,
      unidades: m.units_quantity ?? 0,
    }
  })
  return { dias, rango: r.rango, totales: r.totales, campanas, economia }
}

export async function analizarAds({ dias = 7 } = {}) {
  if (!llmDisponible()) return { omitido: true, motivo: 'LLM no configurado' }
  const ctx = await contexto({ dias })
  if (!ctx) return { omitido: true, motivo: 'sin cuenta ML o sin advertiser de Product Ads' }

  // su propia recomendación anterior: es lo que convierte una opinión suelta en
  // una serie que aprende
  const previo = await AnalisisAds.findOne().sort({ fecha: -1 }).lean()
  const bloquePrevio = previo
    ? `\n\nTU ANÁLISIS ANTERIOR (${new Date(previo.fecha).toISOString().slice(0, 16).replace('T', ' ')}):\n` +
      `titular: ${previo.titular}\n` +
      previo.recomendaciones
        .map(
          (x) =>
            `  - ${x.nombre}: ${x.accion}` +
            (x.presupuestoSugerido ? ` a $${x.presupuestoSugerido}/día` : '') +
            (x.roasObjetivoSugerido ? ` objetivo ${x.roasObjetivoSugerido}x` : '') +
            ` — esperabas: ${x.queEsperar}`,
        )
        .join('\n') +
      `\n\nRevisa si eso se aplicó (compara con el presupuesto y objetivo actuales) y qué pasó con los números.`
    : '\n\n(No hay análisis anterior: este es el primero.)'

  const user =
    `DATOS MEDIDOS · ventana ${ctx.rango?.desde} a ${ctx.rango?.hasta} (${dias} días, hora de Chile)\n\n` +
    `TOTALES: gastó $${Math.round(ctx.totales.gasto)}, facturó $${Math.round(ctx.totales.venta)}, ` +
    `${ctx.totales.unidades} unidades, ROAS ${(ctx.totales.venta / ctx.totales.gasto).toFixed(2)}x, ` +
    `ticket medio $${ctx.totales.unidades ? Math.round(ctx.totales.venta / ctx.totales.unidades) : 0}\n\n` +
    `CAMPAÑAS (ojo diasConDatos y maduraParaOpinar):\n${JSON.stringify(ctx.campanas, null, 1)}\n\n` +
    `ANUNCIO POR ANUNCIO (roasEquilibrio = bajo ese ROAS ese anuncio destruye margen):\n` +
    `${JSON.stringify(ctx.economia, null, 1)}\n` +
    bloquePrevio

  const { datos, costoUsd, modelo } = await pedirJSON({
    system: SISTEMA,
    user,
    schema: ESQUEMA,
    maxTokens: 6000,
    modelo: config.llmModelAds,
  })

  const doc = await AnalisisAds.create({
    dias,
    foto: ctx,
    titular: datos.titular,
    revisionAnterior: datos.revisionAnterior || null,
    preguntas: datos.preguntas ?? [],
    recomendaciones: (datos.recomendaciones ?? []).map((x) => {
      const c = ctx.campanas.find((y) => y.id === x.campanaId)
      return {
        campanaId: x.campanaId,
        nombre: x.nombre ?? c?.nombre ?? null,
        presupuestoActual: c?.presupuestoDiario ?? null,
        roasObjetivoActual: c?.roasObjetivo ?? null,
        roasRealActual: c?.roasReal ?? null,
        presupuestoSugerido: x.presupuestoSugerido ?? null,
        roasObjetivoSugerido: x.roasObjetivoSugerido ?? null,
        accion: x.accion,
        porque: x.porque,
        queEsperar: x.queEsperar ?? null,
        confianza: x.confianza,
      }
    }),
    modelo,
    costoUsd,
  })
  await registrarGasto(null, costoUsd, 'ia').catch(() => {})
  console.log(`[analista-ads] ${modelo} · US$${costoUsd?.toFixed?.(4)} · ${doc.recomendaciones.length} recomendaciones`)
  return doc.toObject()
}

export async function ultimoAnalisisAds() {
  return AnalisisAds.findOne().sort({ fecha: -1 }).lean()
}

export async function historialAnalisisAds({ limite = 10 } = {}) {
  return AnalisisAds.find().sort({ fecha: -1 }).limit(limite).select('-foto').lean()
}
