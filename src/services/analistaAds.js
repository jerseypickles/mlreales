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
            enum: ['subir-presupuesto', 'bajar-presupuesto', 'subir-objetivo', 'bajar-objetivo', 'mantener', 'cerrar', 'mover-productos', 'arreglar-listing'],
          },
          productosAMover: {
            type: 'array',
            description: 'Solo para mover-productos: qué anuncios traer o sacar de esta campaña, y por qué cada uno.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['itemId', 'direccion', 'motivo'],
              properties: {
                itemId: { type: 'string' },
                titulo: { type: 'string' },
                direccion: { type: 'string', enum: ['entra', 'sale'] },
                motivo: { type: 'string' },
              },
            },
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

UNA CAMPAÑA DE UN SOLO PRODUCTO ES EL PRODUCTO:
Cuando la campaña tiene un anuncio, su ROAS ES el del producto y el dial NO
puede arreglar lo que está roto en el listing. Recibes el embudo de cada uno
(impresiones → clics → ventas, con CTR y conversión) y su precio contra la
mediana de su nicho. Úsalo para distinguir:
- CTR bajo (bajo ~1%) con muchas impresiones = ML lo muestra y la gente NO
  hace clic. Es problema de OFERTA: foto, título, precio o el producto mismo.
  Ningún objetivo de ROAS lo arregla. Recomienda accion "arreglar-listing" y di
  qué mirar.
- CTR sano pero conversión baja = entran y no compran. Precio, reseñas, ficha
  incompleta o competencia mejor.
- CTR y conversión sanos pero poco gasto = ahí SÍ es puja, y el dial sirve.
Caso medido en esta cuenta: la lámpara UV recibió 26.238 impresiones y vendió 5
(CTR 0,48%, conv 3,9%) vendiéndose 21% BAJO la mediana de su nicho; el saca
puntos vendió 13 con 3.651 impresiones (CTR 2,47%, conv 14,4%) estando 54%
SOBRE la mediana de la suya. El precio no era el problema de la lámpara.

MOVER PRODUCTOS ENTRE CAMPAÑAS:
Es una acción disponible ("mover-productos") y a veces es lo correcto:
- Una campaña que quedó con un producto muerto no se recupera con diales: se
  le traen productos que sí rinden, o se cierra y el producto vuelve a la
  campaña general.
- Un producto que rinde muy por encima del objetivo pero recibe poco gasto está
  perdiendo subastas dentro de su campaña: sacarlo a una con objetivo más suelto
  le da aire.
- Junta en una misma campaña productos con ROAS de equilibrio PARECIDO: el
  objetivo es uno solo para todos los que estén adentro, así que mezclar
  economías distintas obliga a un número que le queda mal a alguno.
Cuando la uses, lista los itemId con direccion "entra" o "sale" y el motivo de
cada uno. Recuerda que el importador aplica esto a mano en el panel.

UN CONSEJO QUE DEPENDE DE LA VENTANA NO ES UN CONSEJO:
Recibes cada campaña medida en DOS ventanas y el campo estableEntreVentanas.
Antes de recomendar mover un dial, comprueba que tu razonamiento se sostenga en
las dos. Si el ROAS de la campaña cambia más de 25% entre una y otra
—estableEntreVentanas: false— tu recomendación NO es confiable: dilo, pon
confianza BAJA y recomienda "mantener" hasta que la señal se asiente, o propón
medir algo concreto que la desempate.
Caso real: Campaña 1 rinde 3,76x en 7 días y 2,71x en 14. Con el primero sobra
margen sobre el objetivo de 2,3x y no hay que tocar nada; con el segundo está al
filo y conviene exigir más. Recomendar "subir a 2,8x con confianza alta" mirando
solo una ventana es darle al importador una certeza que los datos no tienen.
NO uses confianza "alta" cuando estableEntreVentanas sea false. Nunca.

MIRA LA TRAYECTORIA, NO EL PROMEDIO:
Recibes la serie diaria. Un promedio de 7 días esconde lo que decide. Caso real
de esta cuenta: el CPC pasó de $94 el 16-ago a $203 el 22-ago —se duplicó en
seis días— y el promedio semanal lo mostraba como $126, "normal". Con ese número
se recomendó subir el presupuesto, que es lo contrario de lo que corresponde
cuando el clic se encarece. Si el CPC viene subiendo, subir presupuesto o
aflojar el objetivo compra caro; lo que corresponde es EXIGIR MÁS.

EL CALENDARIO CAMBIA LA SUBASTA:
Recibes los eventos próximos. Aflojar el objetivo justo antes de una semana de
alta competencia es comprar en el peor momento. Dilo cuando aplique.

EL PRECIO QUE MANDA ES EL EFECTIVO:
Si una promoción activa vende bajo el precio de lista, la contribución real es
sobre lo que se cobra, no sobre lo publicado. Un producto con 31% de descuento
activo tiene mucho menos colchón del que aparenta.

SUBIR EL PRECIO ENCARECE EL CLIC:
Medido en esta cuenta el 22-ago. Con estrategia de rentabilidad, ML calcula
cuánto puede pagar por conversión como precio ÷ objetivo de ROAS, así que subir
el precio le da permiso para pujar más. El saca puntos subió de $5.990 a $6.990
y su CPC pasó de $111 a $277 (+150%); la pistola de $3.990 a $4.500 y su CPC de
$96 a $209. Los productos que NO cambiaron de precio bajaron su CPC. Tenlo en
cuenta al evaluar un cambio de precio reciente: parte del deterioro del CPC es
consecuencia de eso y no del mercado.

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

// EL EMBUDO DEL PRODUCTO, Y CONTRA QUÉ COMPITE.
//
// Con una campaña de un solo producto, el ROAS de la campaña ES el del
// producto, y ahí el dial no puede arreglar lo que está roto en el listing.
// Caso medido el 22-ago: la lámpara UV recibió 26.238 impresiones y vendió 5;
// el saca puntos, 3.651 impresiones y vendió 13. La lámpara falla en los dos
// pasos —CTR 0,48% contra 2,47%, conversión 3,9% contra 14,4%— y encima se
// vende 21% BAJO la mediana de su nicho mientras el saca puntos se vende 54%
// SOBRE la suya. O sea el precio no es su problema y ningún objetivo de ROAS
// lo va a resolver.
//
// Sin estos datos el analista solo puede recomendar diales, que es como
// ajustar el volumen de una radio que no está sintonizada.
async function embudoPorProducto(economia) {
  const [{ ProductoPropio }, { Nicho }, { Reporte }] = await Promise.all([
    import('../models/ProductoPropio.js'),
    import('../models/Nicho.js'),
    import('../models/Reporte.js'),
  ])
  const propios = await ProductoPropio.find({ estado: 'activo' }).lean()
  const porId = new Map(propios.flatMap((p) => [[p.itemIdMl, p], [p.sku, p]].filter(([k]) => k)))
  const filas = []
  for (const [itemId, e] of Object.entries(economia ?? {})) {
    if (!(e.impresiones > 0)) continue
    const p = porId.get(itemId)
    const u = (p?.mediciones ?? []).at(-1) ?? {}
    let mercado = null
    if (p?.nichoId) {
      const n = await Nicho.findById(p.nichoId).select('keyword').lean()
      const r = n ? await Reporte.findOne({ nichoId: n._id }).sort({ fecha: -1 }).select('metricas').lean() : null
      const pr = r?.metricas?.precio
      if (pr) {
        mercado = {
          nicho: n.keyword,
          medianaNicho: Math.round(pr.mediana),
          p25Nicho: Math.round(pr.p25),
          pctFullNicho: Math.round(r.metricas.competencia?.pctFull ?? 0),
          miPrecioVsMediana: e.precio ? Math.round((e.precio / pr.mediana - 1) * 100) : null,
        }
      }
    }
    filas.push({
      itemId,
      titulo: e.titulo,
      campanaId: e.campanaId,
      impresiones: e.impresiones,
      clicks: e.clicks,
      unidades: e.unidades,
      ctrPct: e.impresiones ? Math.round((e.clicks / e.impresiones) * 10000) / 100 : null,
      conversionPct: e.clicks ? Math.round((e.unidades / e.clicks) * 1000) / 10 : null,
      resenas: u.numReviews ?? 0,
      rating: u.rating ?? null,
      stock: u.stock ?? null,
      mercado,
    })
  }
  return filas
}

// LA TRAYECTORIA, NO EL PROMEDIO.
//
// El analista recibía un agregado de 7 días y con eso recomendaba mover diales.
// Pero un promedio esconde justo lo que decide: el CPC de esta cuenta pasó de
// $94 el 16-ago a $203 el 22-ago —se duplicó en seis días— y en el promedio
// semanal eso se ve como "$126, normal". Con ese número recomendó subir el
// presupuesto, que es exactamente lo contrario de lo que corresponde cuando el
// clic se está encareciendo.
async function serieDiaria({ dias = 10 } = {}) {
  const { meliGet } = await import('./meli.js')
  const adv = (await meliGet('/advertising/advertisers?product_id=PADS', { headers: { 'Api-Version': '1' } }))
    ?.advertisers?.[0]?.advertiser_id
  if (!adv) return []
  const M = 'clicks,prints,cost,units_quantity,total_amount'
  const hoy = new Date()
  const fechas = Array.from({ length: dias }, (_, i) => {
    const d = new Date(hoy.getTime() - (dias - 1 - i) * 86400e3)
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
  })
  const serie = []
  for (const f of fechas) {
    try {
      const r = await meliGet(
        `/marketplace/advertising/${SITE_ADS}/advertisers/${adv}/product_ads/campaigns/search?limit=50&date_from=${f}&date_to=${f}&metrics=${M}`,
        { headers: { 'Api-Version': '2' } },
      )
      let p = 0, c = 0, g = 0, u = 0, v = 0
      for (const x of r?.results ?? []) {
        const m = x.metrics ?? {}
        p += m.prints ?? 0; c += m.clicks ?? 0; g += m.cost ?? 0
        u += m.units_quantity ?? 0; v += m.total_amount ?? 0
      }
      serie.push({
        dia: f,
        impresiones: p,
        clicks: c,
        gasto: Math.round(g),
        unidades: u,
        cpc: c ? Math.round(g / c) : null,
        roas: g ? Math.round((v / g) * 100) / 100 : null,
      })
    } catch {
      /* un día que ML no devuelve no bota la serie */
    }
  }
  return serie
}

const SITE_ADS = 'MLC'

// EVENTOS DEL CALENDARIO que cambian la subasta. Un analista que no sabe que
// viene Black Week recomienda aflojar el objetivo justo la semana en que todos
// pujan más fuerte.
const CALENDARIO = [
  { desde: '2026-08-27', hasta: '2026-09-02', que: 'Black Week Agosto de ML: la competencia puja más fuerte y el CPC sube. ML propone descuentos agresivos (41% en el set 8, dejándolo en $2.679 contra su lista de $4.490).' },
  { desde: '2026-09-15', hasta: '2026-09-18', que: 'Fiestas Patrias: pico de consumo en Chile, sube la competencia en publicidad.' },
  { desde: '2026-11-01', hasta: '2026-11-30', que: 'Black Friday y Cyber Monday: el mes más caro del año en publicidad.' },
]

// PRECIOS QUE NO SON LOS DE LISTA. Una promo activa que vende bajo el precio
// publicado cambia la contribución real de cada venta, y el analista lo tiene
// que saber antes de opinar sobre cuánto se puede pagar por un clic.
async function preciosEfectivos() {
  try {
    const { ProductoPropio } = await import('../models/ProductoPropio.js')
    const { meliGet } = await import('./meli.js')
    const propios = await ProductoPropio.find({ estado: 'activo' }).select('itemIdMl sku titulo').lean()
    const filas = []
    for (const p of propios) {
      const id = p.itemIdMl ?? p.sku
      const it = await meliGet(`/items/${id}`).catch(() => null)
      if (!it) continue
      const pr = await meliGet(`/seller-promotions/items/${id}?app_version=v2`).catch(() => [])
      const activas = (pr ?? []).filter((x) => x.status === 'started' && x.price > 0 && x.price < it.price)
      if (!activas.length) continue
      const efectivo = Math.min(...activas.map((x) => x.price))
      filas.push({
        itemId: id,
        titulo: p.titulo,
        precioLista: it.price,
        precioEfectivo: efectivo,
        descuentoPct: Math.round((1 - efectivo / it.price) * 100),
        terminaEl: activas[0]?.finish_date?.slice(0, 10) ?? null,
      })
    }
    return filas
  } catch {
    return []
  }
}

export async function analizarAds({ dias = 7 } = {}) {
  if (!llmDisponible()) return { omitido: true, motivo: 'LLM no configurado' }
  const ctx = await contexto({ dias })
  if (!ctx) return { omitido: true, motivo: 'sin cuenta ML o sin advertiser de Product Ads' }

  // TODO LO QUE EL SISTEMA YA SABE Y EL ANALISTA NO ESTABA VIENDO
  // LA MISMA CAMPAÑA EN DOS VENTANAS. Si el diagnóstico cambia según el corte,
  // no es un diagnóstico. Campaña 1 rinde 3,76x a 7 días y 2,71x a 14: con el
  // primero sobra margen sobre el objetivo de 2,3x y con el segundo está al
  // filo, y cada uno sugiere lo contrario. El analista tiene que ver los dos y
  // decir cuándo su consejo no se sostiene en ambos.
  const otraVentana = dias === 7 ? 14 : 7
  const ctxOtra = await contexto({ dias: otraVentana }).catch(() => null)
  const comparacion = (ctx.campanas ?? []).map((c) => {
    const o = (ctxOtra?.campanas ?? []).find((x) => x.id === c.id)
    const estable =
      c.roasReal != null && o?.roasReal != null
        ? Math.abs(c.roasReal - o.roasReal) / Math.max(c.roasReal, o.roasReal) < 0.25
        : null
    return {
      id: c.id,
      nombre: c.nombre,
      [`roas${dias}d`]: c.roasReal,
      [`roas${otraVentana}d`]: o?.roasReal ?? null,
      [`usoPresupuesto${dias}d`]: c.usoPresupuestoPct,
      [`usoPresupuesto${otraVentana}d`]: o?.usoPresupuestoPct ?? null,
      estableEntreVentanas: estable,
    }
  })

  const [serie, promos, lecciones, embudo] = await Promise.all([
    serieDiaria({ dias: 10 }).catch(() => []),
    preciosEfectivos().catch(() => []),
    import('./aprendizajes.js').then((m) => m.leccionesAprendidas()).catch(() => []),
    embudoPorProducto(ctx.economia).catch(() => []),
  ])
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
  const eventos = CALENDARIO.filter((e) => e.hasta >= hoy).slice(0, 3)

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
    `${JSON.stringify(ctx.economia, null, 1)}\n\n` +
    `LA MISMA CAMPAÑA EN DOS VENTANAS (si el ROAS cambia mucho entre ${dias}d y ${otraVentana}d, el diagnóstico NO es estable):\n` +
    `${JSON.stringify(comparacion, null, 1)}\n\n` +
    `EMBUDO POR PRODUCTO Y SU MERCADO (miPrecioVsMediana en %: negativo = vendo más barato que el nicho):\n` +
    `${JSON.stringify(embudo, null, 1)}\n\n` +
    `SERIE DIARIA (la trayectoria importa más que el promedio: mira si el CPC sube o baja):\n` +
    `${JSON.stringify(serie, null, 1)}\n\n` +
    (promos.length
      ? `PRECIOS PISADOS POR PROMOCIÓN (la contribución real es sobre el precio EFECTIVO, no el de lista):\n${JSON.stringify(promos, null, 1)}\n\n`
      : 'PRECIOS: ninguna promoción activa pisa el precio de lista.\n\n') +
    (eventos.length
      ? `CALENDARIO (hoy es ${hoy}):\n${eventos.map((e) => `  - ${e.desde} a ${e.hasta}: ${e.que}`).join('\n')}\n\n`
      : '') +
    (lecciones.length
      ? `LO QUE EL SISTEMA APRENDIÓ MIDIENDO (úsalo, no lo repitas):\n${lecciones.map((l) => `  - ${l}`).join('\n')}\n`
      : '') +
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
    // LA FOTO GUARDA TODO LO QUE SE LE MANDÓ, no solo parte.
    //
    // Antes solo se guardaba `ctx` (campañas y anuncios), así que la serie
    // diaria, el embudo, las promociones y las lecciones viajaban al prompt
    // pero no quedaban registradas. Cuando el importador preguntó "¿estás
    // seguro de que está viendo la campaña completa?" no se podía contestar
    // con el registro en la mano — que es justo para lo que existe la foto.
    foto: { ...ctx, serie, promos, lecciones, embudo, eventos, comparacion },
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
        productosAMover: x.productosAMover ?? [],
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
