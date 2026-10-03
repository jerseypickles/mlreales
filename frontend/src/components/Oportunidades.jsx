import { Fragment, useCallback, useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, CalendarClock, Check, CircleDollarSign, FileText, ImageOff, Lightbulb, MousePointerClick, PencilLine, Search, ShieldAlert, ShoppingBag, Sparkles, Truck, TrendingDown, TrendingUp, Warehouse, X } from 'lucide-react'
import { api } from '../api.js'
import { Cargando, Miniatura, ScoreRing } from './ui.jsx'
import { Criterios } from './Criterios.jsx'
import { compararOportunidades } from '../lib/sidebar.js'
import { fmtNum, fmtPrecio, fmtFecha } from '../lib/formato.js'
import { GraficoTemporada, GraficoPrecio, GraficoPronostico } from './PanelOportunidad.jsx'
import { calzaConBusqueda } from '../lib/calzaConBusqueda.js'
import { tituloTrae } from '../lib/tituloTrae.js'
import { PlanPublicidad } from './PlanPublicidad.jsx'
import { momentoDeCompra, compararPorMomento } from '../lib/momentoCompra.js'

// LA MESA DE COMPRA. El orden es el mensaje: primero si la gente BUSCA eso
// (una keyword que nadie escribe mide un escaparate que no se abre), después
// CUÁNDO se compra (un nicho con la ventana cerrada no se puede traer por
// bueno que sea) y recién ahí el score.

const FLECHA = { sube: ['↑', 'delta-sube'], baja: ['↓', 'delta-baja'], estable: ['→', 'delta-neutra'] }

const NIVELES = {
  alto: { texto: 'búsqueda alta', clase: 'nb-alto' },
  medio: { texto: 'búsqueda media', clase: 'nb-medio' },
  bajo: { texto: 'cola larga', clase: 'nb-bajo' },
  renombrar: { texto: 'keyword mal escrita', clase: 'nb-renombrar' },
  nulo: { texto: 'nadie la busca', clase: 'nb-nulo' },
}

// ¿La keyword medida es la MISMA palabra mal escrita, o un mercado más amplio?
// "pestanas postizas" → "pestañas postizas" es grafía; "waflera electrica" →
// "waflera" es familia. Se ven iguales en el dato y significan cosas distintas:
// la grafía es un error nuestro que además viaja al scrapeo de ML.
const sinTildes = (t) =>
  String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
const esOrtografia = (keyword, medida) => Boolean(medida) && sinTildes(keyword) === sinTildes(medida)

// Mediana del CPC en la mesa: US$0,13. Se marca desde el triple, que es donde
// la publicidad empieza a pesar de verdad sobre el margen.
const CPC_CARO = 0.4


// La salud del mercado, año contra año. Solo devuelve algo cuando cambia una
// decisión: lo que se muere y lo que despega. `estable` y `subiendo` son el
// caso normal y llenar la carta con ellos es ruido.
function chipSalud(c) {
  if (!c?.salud || !Number.isFinite(c.variacionInteranualPct)) return null
  const bruto = c.variacionInteranualPct
  // contra el mercado cuando se pudo estimar; si no, la variación tal cual
  const relativo = Number.isFinite(c.variacionRelativaPct)
  const p = relativo ? c.variacionRelativaPct : bruto
  const signo = (n) => `${n > 0 ? '+' : ''}${n}%`
  const base = relativo
    ? `Google: ${signo(bruto)} de búsquedas en los últimos 12 meses contra los 12 anteriores, mientras la mediana de todas las keywords medidas hizo ${signo(c.variacionMercadoPct)}. Contra el mercado queda en ${signo(p)}: eso es lo que le pasa a ESTE producto y no la marea general. La estacionalidad no cuenta — cada mes se compara con el mismo mes del año pasado.`
    : `Google: ${signo(bruto)} de búsquedas en los últimos 12 meses contra los 12 anteriores. La estacionalidad no cuenta acá — cada mes se compara con el mismo mes del año pasado.`
  const contra = relativo ? ' vs mercado' : ' al año'
  // "muriendo" ya sale solo cuando el mercado además es CHICO: la caída por sí
  // sola no condena. Audífonos bluetooth cayó 34% y le quedan 27.100 búsquedas
  // al mes, más que a casi toda la mesa — ahí la caída es contexto, no veto.
  if (c.salud === 'muriendo') {
    return {
      clase: 'mal',
      texto: `chico y cayendo ${Math.abs(p)}%${relativo ? contra : ''}`,
      ayuda: `${base} Y con ${fmtNum(c.busquedasMes)} búsquedas al mes ya era chico: el stock que traigas llega a un mercado más chico todavía.`,
    }
  }
  if (c.salud === 'bajando') {
    return {
      clase: 'aviso',
      texto: `búsquedas −${Math.abs(p)}%${contra}`,
      ayuda: `${base} Sigue habiendo ${fmtNum(c.busquedasMes)} búsquedas al mes: la caída es contexto para negociar volumen, no un veto.`,
    }
  }
  if (c.salud === 'despegando') {
    return { clase: 'bien', texto: `creciendo ${p}%${relativo ? contra : ''}`, ayuda: base }
  }
  return null
}

// LOS PERÍODOS DEL AÑO, MEDIDOS (ver estacionalidad.periodosDelAnio): qué meses
// suben de verdad, cuánto, si se repite año a año y por qué. "Todo el año" no
// alcanza: la calculadora científica se busca todo el año, pero marzo-mayo se
// busca 4 veces más que el verano.
const PICO_QUE_SE_DICE = 1.5
function picosDe(curva) {
  return new Set((curva?.periodos?.picos ?? []).filter((p) => p.multiplicador >= PICO_QUE_SE_DICE).flatMap((p) => p.meses))
}

function Hecho({ etiqueta, children }) {
  if (children == null || children === '') return null
  return (
    <span className="op-hecho">
      <span className="op-hecho-etiqueta">{etiqueta}</span> {children}
    </span>
  )
}


// LA TRAYECTORIA DEL TOP, en el ancho de una columna.
//
// Suma de los badges "+N vendidos" que ML publica en el listado. Son baldes
// (25/50/100/500/1.000/5.000/10.000), acumulados de toda la vida de cada
// publicación — así que el número es un PISO y jamás un ritmo. Por eso se
// escribe con "≥" y nunca lleva "/mes" al lado.
//
// Compacto a propósito: entre nichos las diferencias son de órdenes de
// magnitud (toallitas ≥543.700 contra pastillas de freno ≥3.150) y ahí el
// redondeo grueso no confunde nada; los dígitos finos no aportarían.
function fmtPiso(n) {
  if (!Number.isFinite(n)) return null
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace('.', ',')}k`
  return fmtNum(n)
}

// EL NÚMERO SOLO NO SIRVE: SE LEÍA COMO TASA.
//
// Primera versión: "≥8,5k" en una columna llamada "vendidos", justo al lado de
// "74.000/mes". El importador lo dijo derecho —"siento que se ve como mes o
// anual"— y tenía razón: dos números seguidos en la misma fila se leen en la
// misma unidad, por mucho que uno lleve "≥".
//
// Se arregla en tres frentes a la vez, porque uno solo no alcanzaba:
//   · la columna se llama HISTÓRICO, que es la palabra que mata la lectura de ritmo
//   · el número dice "el top vendió", sujeto explícito: es de las publicaciones,
//     no del mes
//   · debajo va una BARRA de proporción — una barra no puede leerse como
//     unidades por tiempo, y encima muestra el dato que más vale: qué parte del
//     top despegó (ML no pone badge bajo 25 unidades, así que la barra vacía es
//     "casi nadie vendió nunca")
function Trayectoria({ v }) {
  if (!v?.pisoUnidades) return <em className="opt-nada">—</em>
  const pct = v.pctCobertura ?? null
  return (
    <span className="opt-vend">
      {/* el ≥ se queda: cada badge dice "al menos N", así que la suma es un piso.
          Sin él el número mentiría por exceso de precisión. */}
      <span><em>≥</em>{fmtPiso(v.pisoUnidades)}</span>
      {pct != null ? (
        <i className="op-vend-barra" aria-hidden="true">
          <i style={{ width: `${Math.max(3, pct)}%` }} className={pct < 50 ? 'flojo' : undefined} />
        </i>
      ) : null}
    </span>
  )
}
const ayudaTrayectoria = (v) =>
  v?.pisoUnidades
    ? `El top vendió al menos ${fmtNum(v.pisoUnidades)} unidades EN TODA SU VIDA — acumulado desde que se publicó cada aviso, no por mes ni por año. Suma de los badges "+N vendidos" de ML.${v.pctCobertura != null ? `\n\nLa barra: ${v.pctCobertura}% del top (${v.itemsConDato} de ${v.itemsDelScan}) vendió 25 unidades o más alguna vez. ML no muestra badge bajo 25, así que el resto nunca despegó.` : ''}`
    : 'Sin badges de vendidos en el top'


// RECIÉN LLEGADO. Un nicho nuevo del radar cae en medio de 44 filas que ya
// estaban ahí ayer y se pierde. Se marca por una semana, que es más o menos lo
// que tarda en juntar su primera serie de scans y dejar de ser una promesa.
const DIAS_NUEVO = 7

function esNuevo(creadoEl) {
  if (!creadoEl) return false
  return (Date.now() - new Date(creadoEl).getTime()) / 86400e3 <= DIAS_NUEVO
}


// ¿LA BÚSQUEDA SE CONVIERTE EN VENTA ACÁ? Es el cruce de las dos fuentes:
// unidades vendidas en ML por cada búsqueda en Google, comparado contra lo
// normal de su tramo de precio (el ratio crudo solo mide que lo barato vende
// más unidades — ver marcarConversion en tablero.js).
//
// Se lee como múltiplo: "8,7×" convierte casi nueve veces mejor de lo que se
// esperaría a ese precio; "÷14" convierte catorce veces peor. Es dato de
// lectura y NO entra al score, por decisión del importador: el numerador es
// acumulado de por vida y el denominador es de un mes, así que un top con
// publicaciones viejas se ve mejor de lo que es.
function Conversion({ c }) {
  if (!c?.factor) return <span className="op-fila-conv" />
  const bueno = c.factor >= 1
  const texto = bueno ? `${c.factor.toFixed(1).replace('.0', '').replace('.', ',')}×` : `÷${Math.round(1 / c.factor)}`
  return (
    <span
      className={`op-fila-conv${bueno ? ' bien' : ' mal'}`}
      title={`Por cada búsqueda en Google, el top de este nicho vendió ${c.ratio} unidades. Para su precio lo normal sería ${c.esperado}.\n\n${
        bueno
          ? 'Convierte MEJOR de lo esperado: la gente compra esto dentro de ML sin googlearlo antes, así que su volumen de búsqueda subestima el mercado.'
          : 'Convierte PEOR de lo esperado: se googlea bastante pero no se compra acá — puede irse a tienda física o quedarse en la investigación.'
      }\n\nDato de lectura, no entra al score: el acumulado de ventas es de toda la vida del aviso y las búsquedas son de un mes, así que un top con publicaciones antiguas se ve mejor de lo que es.`}
    >
      {texto}
    </span>
  )
}

// EL TRAMO DE PRECIO DONDE EL NEGOCIO EXISTE.
//
// Medido contra la API de envíos el 18-ago, con caja chica y comisión 17%,
// cuánto queda de cada venta después de que ML cobra lo suyo:
//
//    $5.990 → 69,2%      $12.990 → 75,0%      $19.990 → 66,7%  ← precipicio
//    $9.989 → 74,7%      $17.990 → 77,2%      $24.990 → 70,0%
//    $9.990 → 72,6%      $19.989 → 77,8% ←    $49.990 → 76,5%
//
// El envío de Full es FIJO y salta en $9.990 y otra vez en $19.990, así que la
// curva sube parejo dentro de cada tramo y se desploma al cruzarlo: un peso más
// caro que $19.989 cuesta $2.209 de contribución.
//
// De ahí la banda: entre $10.000 y $19.989 se queda entre 72,6% y 77,8%, el
// mejor rendimiento de toda la escala — mejor incluso que un producto de
// $40.000. Bajo $10.000 el envío fijo se come el margen y la publicidad no se
// puede pagar (CAC medido $1.717); pasando $19.990 hay que llegar a ~$50.000
// para volver a rendir igual.
const TRAMO = { desde: 10_000, hasta: 19_989 }

function claseTramo(mediana) {
  if (!Number.isFinite(mediana)) return ''
  if (mediana >= TRAMO.desde && mediana <= TRAMO.hasta) return 'op-tramo-bueno'
  if (mediana < TRAMO.desde) return 'op-tramo-bajo'
  return 'op-tramo-alto'
}


// MARCA DE COTIZACIÓN, EN LA FILA Y DE UN CLIC.
//
// La etapa del embudo ya existía, pero vivía DENTRO de la tarjeta desplegada:
// para marcar que estás cotizando un nicho había que abrirlo, y desde la lista
// no se veía cuál estaba en cuál. Con 69 filas eso es justo lo que confunde —
// "no sé cuáles estoy cotizando" fue el pedido textual del importador.
//
// El marcador escribe la MISMA etapaCompra de siempre, así que el sidebar de
// Nichos, el estratega y el cupo del radar lo ven igual. Solo cambia dónde se
// toca.
function MarcaCotizando({ o, onRecargar }) {
  const activo = o.etapaCompra === 'cotizando'
  return (
    <button
      type="button"
      className={`opt-marca${activo ? ' activa' : ''}`}
      title={activo ? 'Lo estás cotizando — clic para desmarcar' : 'Marcar que estás cotizando este nicho'}
      aria-pressed={activo}
      onClick={async (e) => {
        e.stopPropagation()
        await api.ajustarNicho(o.nichoId, { etapaCompra: activo ? 'evaluando' : 'cotizando' })
        onRecargar()
      }}
    >
      {activo ? <><Check size={12} aria-hidden="true" />Cotizando</> : '+ cotizar'}
    </button>
  )
}

// LAS ALERTAS, EN UN SOLO LUGAR (2-oct-2026).
//
// La fila llegó a cargar siete etiquetas de colores distintos —tramo, ticket,
// Full, tendencia, mejora, momento, cotizando— más fondos naranjos y bordes
// azules, y el importador lo dijo: "hay muchas etiquetas, falta mejorar la
// estructura". Cada alerta vive ahora acá con su texto corto y su porqué: la
// tarjeta las muestra como íconos chicos (el porqué al pasar el mouse) y el
// panel las lista enteras. `soloPanel` es contexto que no cambia la decisión de
// abrir la tarjeta (el tramo bueno, una medición más amplia).
const ORDEN_TONO = { mal: 0, aviso: 1, bien: 2, info: 3 }

// LA VARA DE BÚSQUEDA (2-oct-2026, decisión del importador): el radar ya no
// propone nichos nuevos bajo 5.000 búsquedas al mes. Los que ya existen no se
// borran —Google subestima lo que se compra dentro de ML: la pistola de juguete
// mide 1.600 y vendía 22 u en 30 días—, llevan esta alerta y él decide.
const VARA_BUSQUEDAS = 5000
// umbral INICIAL de clic disputado: falta calibrarlo contra el costo por venta
// real de las campañas propias (con los productos nuevos de octubre)
const TOP_PAGA_DISPUTADO = 50
function avisosDe(o, tendencia) {
  const a = []
  const c = o.curvaAnual
  if (o.ticket?.bajo) {
    a.push({
      id: 'ticket', Icono: CircleDollarSign, tono: 'mal',
      corto: `${o.ticket.enValle ? 'Salto de envío' : 'Ticket bajo'} · deja ${o.ticket.pctConAds}% con publicidad`,
      ayuda: `A ${fmtPrecio(o.ticket.precio)}, con publicidad queda ${fmtPrecio(o.ticket.quedaConAds)} (${o.ticket.pctConAds}%) para pagar el producto y ganar; sin publicidad ${fmtPrecio(o.ticket.quedaSinAds)} (${o.ticket.pctSinAds}%). Aprendido de tus ventas: bajo ${fmtPrecio(o.ticket.minimo40)} queda menos del 40%.${o.ticket.enValle ? ' A este precio el envío gratis obligatorio sube lo que pagas por envío: conviene quedar justo bajo el salto o bien por encima.' : ''}`,
    })
  } else if (claseTramo(o.mediana) === 'op-tramo-bajo') {
    a.push({ id: 'tramo', Icono: CircleDollarSign, tono: 'aviso', corto: `Precio bajo $10.000 (mediana ${fmtPrecio(o.mediana)})`,
      ayuda: 'Bajo $10.000 el envío fijo de Full se come una parte grande del precio, y comprar un cliente con publicidad cuesta $1.717 medidos: bajo ese piso la publicidad no puede ser rentable.' })
  }
  // el salto de envío ya es el aviso del precio alto: no se repite
  if (claseTramo(o.mediana) === 'op-tramo-alto' && !o.ticket?.bajo) {
    a.push({ id: 'tramo', Icono: CircleDollarSign, tono: 'aviso', corto: `Precio sobre $19.990 (mediana ${fmtPrecio(o.mediana)})`,
      ayuda: 'Pasando $19.990 la tarifa de Full salta de $1.040 a $3.250 y el rendimiento cae de 77,8% a 66,7%. No vuelve a rendir igual hasta cerca de $50.000. No descarta el nicho, pero el producto tiene que justificar el salto.' })
  } else if (claseTramo(o.mediana) === 'op-tramo-bueno') {
    a.push({ id: 'tramo', Icono: CircleDollarSign, tono: 'bien', soloPanel: true, corto: `Precio en el mejor tramo (mediana ${fmtPrecio(o.mediana)})`,
      ayuda: 'Entre $10.000 y $19.989 queda entre 72,6% y 77,8% de cada venta después de comisión y envío Full: el mejor rendimiento de toda la escala.' })
  }
  // la regla física (medidas/peso contra los límites de ML) manda sobre lo que
  // declaró la IA: silla gamer decía "full" con una caja de 19 kg
  const f = o.fueraDeFull
  if (f?.estado === 'no-cabe') a.push({ id: 'full', Icono: Warehouse, tono: 'mal', corto: 'No entra a Full', ayuda: f.motivos.join(' · ') })
  else if (o.logistica && o.logistica !== 'full') a.push({ id: 'full', Icono: Warehouse, tono: 'aviso', corto: o.logistica === 'flete_propio' ? 'Sin Full · flete propio' : 'Sin Full · desde bodega', ayuda: LOGISTICA_CHIP[o.logistica]?.title ?? '' })
  else if (f?.estado === 'al-limite') a.push({ id: 'full', Icono: Warehouse, tono: 'aviso', corto: 'Full al límite', ayuda: `Cabe en Full, pero al límite: ${f.motivos.join(' · ')}` })
  // EL APRENDIZAJE ORDENA NICHOS. No sabe cuánto se va a buscar, pero sí cuál
  // viene mejor que otro (probado en dos períodos: 3,9-4,4 de cada 10 del quinto
  // de arriba lo cumplen; al azar serían 2). Solo se marca el quinto de arriba y
  // el de abajo, y solo si el último entrenamiento volvió a pasar la prueba.
  if (tendencia && tendencia.grupo !== 'medio') {
    const arriba = tendencia.grupo === 'arriba'
    a.push({
      id: 'tendencia', Icono: arriba ? TrendingUp : TrendingDown, tono: arriba ? 'bien' : 'aviso',
      corto: arriba ? 'Viene mejor que el año pasado' : 'Viene peor que el año pasado',
      ayuda: `Aprendizaje: ${arriba ? 'entre el 20% que más crecerá' : 'entre el 20% que menos crecerá'} de ${tendencia.entre} nichos en los próximos 3-5 meses (${tendencia.vsAnioPasadoPct >= 0 ? '+' : ''}${tendencia.vsAnioPasadoPct}% contra el mismo mes del año pasado). El orden es confiable; el porcentaje exacto no.${arriba ? '' : ' En un producto de temporada significa un pico más bajo que el del año pasado, no que no haya temporada.'}`,
    })
  }
  // ¿El mercado está vivo? Solo lo que cambia una decisión: lo que se muere y
  // lo que despega. "Estable" es el caso normal y no informa.
  const salud = chipSalud(c)
  if (salud) a.push({ id: 'salud', Icono: salud.clase === 'bien' ? ArrowUpRight : ArrowDownRight, tono: salud.clase === 'bien' ? 'bien' : salud.clase, corto: `Google: ${salud.texto}`, ayuda: salud.ayuda })
  if (Number.isFinite(c?.busquedasMes) && c.busquedasMes < VARA_BUSQUEDAS) {
    a.push({ id: 'vara', Icono: Search, tono: 'aviso', corto: `Bajo la vara: ${fmtNum(c.busquedasMes)} búsquedas/mes (mínimo ${fmtNum(VARA_BUSQUEDAS)})`,
      ayuda: `Tu vara para nichos nuevos es ${fmtNum(VARA_BUSQUEDAS)} búsquedas al mes en Google Chile: bajo eso el mercado es chico para repartir y entrar sin historia depende de publicidad. No lo descarta solo: hay productos que se compran dentro de ML sin googlearlos (mira "convierte" en las cifras).` })
  }
  const pa = o.presionAds
  if (pa?.pctTopPaga >= TOP_PAGA_DISPUTADO) {
    a.push({ id: 'ads', Icono: MousePointerClick, tono: 'aviso', corto: `Clic disputado en ML: ${pa.pctTopPaga}% del top paga publicidad`,
      ayuda: `De las publicaciones que ya rankean arriba, ${pa.pctTopPaga}% además paga anuncios, y hay ${pa.anunciantes} vendedores anunciando${pa.anunciantesOficiales ? ` (${pa.anunciantesOficiales} tiendas oficiales)` : ''}. Entrar sin historia acá significa pujar contra ellos por cada clic. Umbral inicial (${TOP_PAGA_DISPUTADO}%): se calibra con el costo por venta real de tus campañas.` })
  }
  // el CPC solo se marca cuando es caro: la mediana de la mesa es US$0,13
  if (c?.cpcUsd >= CPC_CARO) a.push({ id: 'cpc', Icono: MousePointerClick, tono: 'aviso', corto: `Clic caro en Google · US$${c.cpcUsd}`, ayuda: `Un clic en Google cuesta US$${c.cpcUsd} en este nicho, contra US$0,13 de mediana. Entrar acá con publicidad sale caro.` })
  if (o.nivelBusqueda?.nivel === 'renombrar') {
    a.push({ id: 'keyword', Icono: PencilLine, tono: 'aviso', corto: 'La gente lo busca con otra frase', ayuda: o.nivelBusqueda.keywordSugerida ? `En Mercado Libre se escribe «${o.nivelBusqueda.keywordSugerida}»: cotizar sobre esta keyword es cotizar sobre un listado que nadie abre.` : 'La keyword del nicho casi no se busca así.' })
  } else if (c?.keywordMedida) {
    // EL NÚMERO NO SIEMPRE ES DE ESTA KEYWORD: cuando la frase exacta no tiene
    // volumen se mide su forma más amplia ("waflera electrica" → "waflera").
    const typo = esOrtografia(o.keyword, c.keywordMedida)
    a.push(typo
      ? { id: 'keyword', Icono: PencilLine, tono: 'aviso', corto: `Keyword mal escrita: Google mide «${c.keywordMedida}»`, ayuda: `La keyword del nicho está mal escrita: Google mide "${c.keywordMedida}", no "${o.keyword}". El error también viaja al scrapeo de ML.` }
      : { id: 'keyword', Icono: Search, tono: 'info', soloPanel: true, corto: `Búsquedas medidas como «${c.keywordMedida}»`, ayuda: `Este volumen es de "${c.keywordMedida}", una búsqueda más amplia. La frase exacta del nicho tiene ${c.correccionFactor ? `${Math.round(c.correccionFactor)}× menos` : 'menos'}.` })
  }
  if (o.mejoras?.length) a.push({ id: 'mejora', Icono: Lightbulb, tono: 'aviso', corto: o.mejoras.length === 1 ? 'Mejora por revisar' : `${o.mejoras.length} mejoras por revisar`, ayuda: `${o.mejoras.map((m) => m.motivo).join(' · ')}. Se revisa en la pestaña Mejoras del panel.` })
  // criterio del importador: la certificación se informa, no veta (sabe
  // tramitarla), así que va al panel y no ensucia la tarjeta
  for (const t of o.tramites ?? []) a.push({ id: `tramite-${t}`, Icono: ShieldAlert, tono: 'info', soloPanel: true, corto: `Requiere ${t}`, ayuda: 'Trámite de importación: se informa como costo y plazo, la decisión es tuya.' })
  // "ACÁ YA VENDO YO": evaluar a ciegas no es lo mismo que un nicho del que ya
  // tienes conversión y precio propio; ahí la decisión es reponer o ampliar
  if (o.mios?.publicaciones) {
    const vende = o.mios.unidades30d > 0
    a.push({ id: 'mio', Icono: ShoppingBag, tono: vende ? 'bien' : 'aviso', corto: vende ? `Ya vendes acá · ${o.mios.unidades30d} u en 30 días` : 'Tienes publicación acá sin ventas en 30 días', ayuda: `${o.mios.publicaciones} publicación(es) tuya(s) en este nicho.` })
  }
  // recién llegado: se marca por la semana que tarda en juntar su serie
  if (esNuevo(o.creadoEl)) {
    const dias = Math.floor((Date.now() - new Date(o.creadoEl).getTime()) / 86400e3)
    a.push({ id: 'nuevo', Icono: Sparkles, tono: 'bien', corto: dias < 1 ? 'Nuevo: el radar lo descubrió hoy' : `Nuevo: descubierto hace ${dias} día${dias === 1 ? '' : 's'}`, ayuda: 'Todavía está juntando su serie de scans: dale unos días antes de decidir.' })
  }
  return a.sort((x, y) => ORDEN_TONO[x.tono] - ORDEN_TONO[y.tono])
}

function AvisosIconos({ lista }) {
  if (!lista.length) return null
  return (
    <span className="opt-avisos" aria-label={lista.map((x) => x.corto).join(' · ')}>
      {lista.map(({ id, Icono, tono, corto, ayuda }) => (
        <i key={id} className={`opt-aviso t-${tono}`} title={`${corto}\n\n${ayuda}`}><Icono size={13} aria-hidden="true" /></i>
      ))}
    </span>
  )
}

function AvisosLista({ lista }) {
  if (!lista.length) return null
  return (
    <ul className="opp-avisos">
      {lista.map(({ id, Icono, tono, corto, ayuda }) => (
        <li key={id} className={`t-${tono}`}>
          {/* el porqué plegado: abierto entero era un muro de texto */}
          <details>
            <summary>
              <i className={`opt-aviso t-${tono}`} aria-hidden="true"><Icono size={14} /></i>
              <b>{corto}</b>
            </summary>
            {ayuda ? <small>{ayuda}</small> : null}
          </details>
        </li>
      ))}
    </ul>
  )
}

const capital = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t)

// LO QUE CUESTA, EN UNA LÍNEA: el costo puesto que anotó el importador manda; si
// no hay, el EXW cotizado (un nicho puede traer varios productos: rango, nunca
// el promedio). El detalle editable vive en la pestaña Compra del panel.
function costoCorto(cot) {
  if (!cot) return null
  if (cot.costoPuestoClp != null) return `${fmtPrecio(cot.costoPuestoClp)}/u puesto`
  const exw = (cot.productos?.length > 1 ? cot.productos.map((p) => p.exwUsd) : [cot.exwUsd]).filter(Number.isFinite)
  if (!exw.length) return null
  const lo = Math.min(...exw), hi = Math.max(...exw)
  return `EXW US$ ${usd(lo)}${hi > lo ? `–${usd(hi)}` : ''}`
}

const ETAPA_TEXTO = { cotizando: 'Cotizando', pedido: 'Pedido', vendiendo: 'Vendiendo', 'en-espera': 'En espera', descartado: 'Descartado' }

// EL ESTADO DE LA COMPRA, A LA DERECHA Y SIEMPRE EN EL MISMO LUGAR: "no sé
// cuáles estoy cotizando" fue el pedido que lo trajo a la fila. Escribe la
// misma etapaCompra de siempre, así que Nichos y el radar lo ven igual.
const enCotizacion = (o) => ['cotizando', 'pedido'].includes(o.etapaCompra)

function EstadoCompra({ o, onRecargar }) {
  // lo que está en cotización lo dice la franja de arriba, con su costo
  if (enCotizacion(o)) return <span className="opt-compra" />
  const etapa = o.etapaCompra && o.etapaCompra !== 'evaluando' ? o.etapaCompra : null
  const costo = costoCorto(o.cotizacion)
  return (
    <span className="opt-compra">
      {etapa ? <b className={`opt-etapa e-${etapa}`}>{ETAPA_TEXTO[etapa] ?? etapa}</b> : <MarcaCotizando o={o} onRecargar={onRecargar} />}
      {costo ? <small className={o.cotizacion?.costoPuestoClp != null ? 'real' : undefined}>{costo}</small> : null}
    </span>
  )
}

// LO QUE SE ESTÁ COTIZANDO SE VE DESDE LEJOS (2-oct-2026). La pastilla
// "Cotizando" en la esquina se perdía: "que los identifique mejor el
// contenedor, se ve bien chiquito". Ahora la tarjeta entera lleva borde y
// franja azul con el costo, y desde la franja se quita la marca.
function BandaCotizando({ o, onRecargar }) {
  const pedido = o.etapaCompra === 'pedido'
  const costo = costoCorto(o.cotizacion)
  return (
    <span className="opt-banda">
      <FileText size={14} aria-hidden="true" />
      <b>{pedido ? 'Pedido hecho' : 'En cotización'}</b>
      {costo ? <span className={o.cotizacion?.costoPuestoClp != null ? 'real' : undefined}>{costo}</span> : <span className="falta">sin costo todavía</span>}
      {pedido ? null : (
        <button
          type="button"
          className="opt-banda-quitar"
          title="Quitar la marca de cotizando"
          onClick={async (e) => {
            e.stopPropagation()
            await api.ajustarNicho(o.nichoId, { etapaCompra: 'evaluando' })
            onRecargar()
          }}
        >
          quitar
        </button>
      )}
    </span>
  )
}

function Cifra({ etiqueta, title, children }) {
  return (
    <span className="opt-cifra" title={title}>
      <small>{etiqueta}</small>
      <span className="opt-cifra-v">{children}</span>
    </span>
  )
}

// La forma del año en miniatura: barras de la propia keyword (no se compara
// entre nichos), el mes de hoy en azul y los meses de pico medidos marcados.
function MiniCurva({ c }) {
  const max = c?.curva?.length ? Math.max(...c.curva) : 0
  if (!max) return <em className="opt-nada">—</em>
  const mesHoy = new Date().getMonth()
  const picos = picosDe(c)
  return (
    <span className="opt-curva" aria-hidden="true">
      {c.curva.map((v, i) => (
        <i key={i} className={[i === mesHoy ? 'hoy' : '', picos.has(i + 1) ? 'pico' : ''].join(' ').trim() || undefined} style={{ height: `${Math.max(10, Math.round((100 * v) / max))}%` }} />
      ))}
    </span>
  )
}

// LA TARJETA DEL NICHO (2-oct-2026): foto, nombre, UNA línea de por qué traerlo
// ahora, las alertas en íconos, el score y el estado de la compra, y abajo las
// cinco cifras que deciden si vale abrirla. Todo lo demás está en el panel.
function TarjetaNicho({ o, rank, abierta, onAlternar, onRecargar, tendencia }) {
  const m = momentoDeCompra(o)
  const c = o.curvaAnual
  const avisos = avisosDe(o, tendencia).filter((x) => !x.soloPanel)
  return (
    <div
      role="button"
      tabIndex={0}
      className={`opt m-${m.clase}${abierta ? ' abierta' : ''}${enCotizacion(o) ? ' cotizando' : ''}`}
      onClick={onAlternar}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAlternar() }
      }}
      aria-expanded={abierta}
    >
      {enCotizacion(o) ? <BandaCotizando o={o} onRecargar={onRecargar} /> : null}
      <span className="opt-foto">
        {o.imagen ? <Miniatura src={o.imagen} lado={72} /> : <ImageOff size={20} aria-hidden="true" />}
        <i className="opt-rank">{rank}</i>
      </span>
      <span className="opt-cab">
        <strong className="opt-nombre">{o.keyword}</strong>
        <span className="opt-momento" title={m.motivo}>
          <b>{capital(m.etiqueta)}</b>
          <span>{o.midiendo ? `faltan ${o.faltanScans} ${o.faltanScans === 1 ? 'scan' : 'scans'} para el veredicto` : m.motivo}</span>
        </span>
        <AvisosIconos lista={avisos} />
      </span>
      <span className="opt-score">
        {o.midiendo ? (
          <span className="opt-midiendo" title={`Recién descubierto: lleva ${o.scansConDemanda} de ${o.scansConDemanda + o.faltanScans} scans con demanda medida. No tiene score ni veredicto todavía, y no se van a inventar.`}>
            {o.scansConDemanda}/{o.scansConDemanda + o.faltanScans}<small>scans</small>
          </span>
        ) : Number.isFinite(o.score) ? (
          <span title={`Score ${o.score} de 100${o.dispersion != null ? ` · promedio de la serie de scans (se movió ${o.dispersion} puntos entre el más alto y el más bajo)` : ''}`}>
            <ScoreRing valor={o.score} size={46} grosor={4.5} />
          </span>
        ) : <em className="opt-nada">—</em>}
      </span>
      <EstadoCompra o={o} onRecargar={onRecargar} />
      <span className="opt-cifras">
        <Cifra
          etiqueta="Búsquedas"
          title={c?.busquedasMes ? `${fmtNum(c.busquedasMes)} búsquedas al mes en Chile (Google Ads, promedio de 12 meses)${c.keywordMedida ? `, medido sobre «${c.keywordMedida}»` : ''}.` : 'Todavía sin medir contra Google Ads'}
        >
          {c?.busquedasMes ? <>{fmtNum(c.busquedasMes)}<small>/mes</small></> : <em className="opt-nada">sin medir</em>}
        </Cifra>
        <Cifra etiqueta="El año" title={c?.curva?.length ? `Forma del año según Google: pico en ${c.nombreMesPico ?? '—'}, ${c.ratioPico}× el promedio. En azul, el mes de hoy.` : undefined}>
          <MiniCurva c={c} />
        </Cifra>
        <Cifra etiqueta="Histórico" title={ayudaTrayectoria(o.vendidosHistoricos)}>
          <Trayectoria v={o.vendidosHistoricos} />
        </Cifra>
        <Cifra etiqueta="Full" title={o.pctFull != null ? `${Math.round(o.pctFull)}% del top vende por Full. Poco Full no es hueco libre: suele ser un nicho donde nadie logró vender lo suficiente para inmovilizar stock.` : 'sin medir'}>
          {o.pctFull != null ? `${Math.round(o.pctFull)}%` : <em className="opt-nada">—</em>}
        </Cifra>
        <Cifra etiqueta="Precio" title="Mediana de precio del top del nicho">
          {o.mediana ? fmtPrecio(o.mediana) : <em className="opt-nada">—</em>}
        </Cifra>
      </span>
    </div>
  )
}

// Dólares con coma decimal. Un nicho puede traer VARIOS productos (manguera de
// 15 y 30 m, focos de 200 y 300 W): cada uno con su precio, nunca el promedio.
const usd = (v) => String(v).replace('.', ',')

// Etapas del embudo de compra (espejo de ETAPAS_COMPRA en el backend)
const ETAPAS = ['evaluando', 'cotizando', 'pedido', 'vendiendo', 'en-espera', 'descartado']

// LO QUE TE CUESTA LA UNIDAD PUESTA EN CHILE, editable acá.
//
// Antes esto pedía el EXW del proveedor en dólares, heredado de la planilla de
// cotización que ya se retiró. El importador lo dijo derecho: "eso de cotizar
// no sirve, llevamos los costos desde mis productos" — y en agosto ya había
// pedido el cambio ("solo pondremos el precio a que nos llegó el producto
// puesto en Chile, es más fácil de calcular"). El campo se creó entonces pero
// la tarjeta nunca se cambió, y por eso 24 nichos tenían EXW y solo 1 costo.
//
// El costo puesto en Chile permite margen REAL sin estimar flete ni cubicaje:
// precio − comisión ML − costo. Los EXW viejos quedan como histórico y se
// muestran solo para recordar que falta el dato bueno.
function Cotizacion({ o, onRecargar }) {
  const cot = o.cotizacion
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(cot?.costoPuestoClp ?? '')
  const [guardando, setGuardando] = useState(false)

  async function guardar(e) {
    e.preventDefault()
    e.stopPropagation()
    setGuardando(true)
    try {
      await api.ajustarNicho(o.nichoId, { costoPuestoClp: valor === '' ? null : Number(valor) })
      setEditando(false)
      onRecargar()
    } finally {
      setGuardando(false)
    }
  }

  if (editando) {
    return (
      <form className="op-cot-form" onSubmit={guardar} onClick={(e) => e.stopPropagation()}>
        <label>puesto en Chile $</label>
        <input
          type="number"
          min="0"
          step="1"
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="por unidad, ya en Chile"
        />
        <button type="submit" className="boton-secundario boton-chico" disabled={guardando}>
          {guardando ? '…' : 'ok'}
        </button>
        <button
          type="button"
          className="boton-plano boton-chico"
          onClick={(e) => {
            e.stopPropagation()
            setValor(cot?.costoPuestoClp ?? '')
            setEditando(false)
          }}
        >
          cancelar
        </button>
      </form>
    )
  }

  return (
    <button
      type="button"
      /* el semáforo solo aplica cuando el costo puesto es REAL: pintar de rojo
         una estimación contra un precio que no es el tuyo es peor que no pintar */
      className={`op-cotizacion op-cot-boton ${
        !cot ? 'pendiente' : cot.costoPuestoClp == null ? 'estimado' : cot.viable === false || cot.cierra === false ? 'mal' : 'bien'
      }${cot?.recargoTransportePct && cot.costoPuestoClp == null ? ' con-transporte' : ''}`}
      title={
        cot?.costoPuestoClp
          ? `Te cuesta ${fmtPrecio(cot.costoPuestoClp)} por unidad ya puesto en tu bodega, todo incluido — clic para cambiarlo`
          : cot?.exwUsd
            ? `EXW US$ ${cot.exwUsd}${cot.recargoTransportePct ? ` (fábrica US$ ${cot.exwFabricaUsd} + ${cot.recargoTransportePct}% del agente, que ya cubre el flete de China a Chile)` : ''}${cot.fleteIncluido ? '' : ` + flete ${cot.fleteClp != null ? fmtPrecio(cot.fleteClp) : '?'}`} + seguro, arancel y despacho = ${cot.landedClp != null ? fmtPrecio(cot.landedClp) : '?'} INTERNADO, o sea hasta salir de aduana. Todavía FALTAN el transporte del puerto a tu bodega, los gastos locales de la naviera y el envío a Full.${cot.volumenSupuesto ? ` Y el flete usa un volumen SUPUESTO de ${cot.volumenM3} m³ porque la cotización no trae cubicaje.` : ''} No dice cuánto deja porque el precio de venta lo pones tú. Clic para escribir el costo puesto real.`
            : 'Anota lo que te cuesta cada unidad ya puesta en Chile (con flete e internación): con eso el sistema calcula el margen real'
      }
      onClick={(e) => {
        e.stopPropagation()
        setEditando(true)
      }}
    >
      {/* INTERNADO ≠ PUESTO. El importador marcó la diferencia el 26-ago:
          "puesto es cuando llega a Chile, pero faltan costos". Lo calculado
          llega hasta SALIR DE ADUANA; el transporte a bodega, los gastos
          locales de naviera y el envío a Full no están. Por eso el estimado
          dice "internado" y solo el que él escribe a mano dice "puesto".

          LO QUE CUESTA, NO LO QUE DEJA.
          Hasta el 26-ago esto mostraba el margen estimado, calculado contra el
          precio de mercado del nicho. El importador lo paró en seco: "no
          podemos saber lo que va a dejar por un precio que va a competir solo;
          varios productos son de mejor calidad, son todo diferente".
          Y tiene razón — ese margen suponía DOS cosas: el cubicaje y el precio
          al que se va a vender un producto que todavía no existe en la vitrina.
          Así que la fila lleva solo el COSTO PUESTO. El margen vuelve cuando
          haya un precio de venta puesto por él, no inferido del mercado. */}
      {!cot
        ? 'sin costo'
        : cot.costoPuestoClp != null
          ? `✓ ${fmtPrecio(cot.costoPuestoClp)}/u puesto`
          : cot.productos?.length > 1 && cot.productos.every((p) => p.landedClp != null)
            ? `~ ${fmtPrecio(Math.min(...cot.productos.map((p) => p.landedClp)))} a ${fmtPrecio(Math.max(...cot.productos.map((p) => p.landedClp)))}/u internado`
          : cot.landedClp != null
            ? `~ ${fmtPrecio(cot.landedClp)}/u internado${cot.volumenSupuesto ? ' ◊' : ''}`
            : `EXW US$ ${cot.exwUsd} · falta costo puesto`}
      {/* DOS PRECIOS, SIN CONFUNDIRLOS (20-sep): el que se paga —con el transporte
          del agente— es el que calcula; el de fábrica queda a la vista, en chico. */}
      {cot?.recargoTransportePct && cot.costoPuestoClp == null
        ? cot.productos?.length > 1
          ? cot.productos.map((p) => <small key={p.nombre} className="op-cot-dos"><Truck size={11} aria-hidden="true" /> <b>{p.nombre}</b> · US$ {usd(p.exwUsd)} con flete (fábrica {usd(p.exwFabricaUsd)}) × {p.unidades} u{p.landedClp != null ? ` → ~${fmtPrecio(p.landedClp)} internado` : ''}</small>)
          : <small className="op-cot-dos"><Truck size={11} aria-hidden="true" /> US$ {usd(cot.exwUsd)} con flete a Chile · fábrica US$ {usd(cot.exwFabricaUsd)} +{cot.recargoTransportePct}%</small>
        : null}
    </button>
  )
}

// FLETE PROPIO POR BULTO. Mercado Envíos cobra lo mismo desde Full que desde
// la bodega (medido 2-sep-2026), así que un producto voluminoso solo cierra
// con courier propio o envío a convenir. El importador anota acá cuánto le
// cuesta despachar un bulto por su cuenta, y el analista compara las dos rutas
// en vez de vetar el nicho por "no entra a Full".
const LOGISTICA_CHIP = {
  full: { texto: 'Full', title: 'El analista propone vender por Full' },
  bodega_propia: { texto: 'bodega', title: 'El analista propone despachar desde tu bodega por Mercado Envíos (misma tarifa que Full, sin bodegaje ML)' },
  flete_propio: { texto: 'flete propio', title: 'El analista propone despachar desde tu bodega con courier propio: el volumétrico de Mercado Envíos no cierra' },
}


// LO QUE EL VIGÍA ENCONTRÓ (services/vigiaMejoras.js). Hoy: el nombre chileno
// de un nicho mal medido en Google. El sistema sugiere con el volumen medido;
// aplicar o descartar lo decide el importador, y queda como aprendizaje.
function MejorasNicho({ o, onRecargar }) {
  return (
    <>
      {o.mejoras.some((x) => x.tipo === 'competencia') ? <MejoraCompetencia o={o} m={o.mejoras.find((x) => x.tipo === 'competencia')} onRecargar={onRecargar} /> : null}
      {o.mejoras.some((x) => x.tipo === 'medicion') ? <MejoraMedicion o={o} m={o.mejoras.find((x) => x.tipo === 'medicion')} onRecargar={onRecargar} /> : null}
    </>
  )
}

// La búsqueda de ML mezcla otros productos: el vigía los agrupa, verifica la
// frase contra los títulos y pregunta. Aplicado, el reporte se recalcula.
function MejoraCompetencia({ o, m, onRecargar }) {
  const [elegidas, setElegidas] = useState(() => new Set(m.grupos.map((g) => g.frase)))
  const [ocupado, setOcupado] = useState(null)
  const [error, setError] = useState(null)
  const accion = async (fn, clave) => {
    setOcupado(clave); setError(null)
    try { await fn(); onRecargar() } catch (e) { setError(e.message) } finally { setOcupado(null) }
  }
  const alternar = (f) => setElegidas((prev) => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n })
  return (
    <div className="mejora" onClick={(e) => e.stopPropagation()}>
      <div className="mejora-cab"><Lightbulb size={16} aria-hidden="true" /><strong>Mejora detectada: el nicho mide productos que no son</strong></div>
      <p className="mejora-motivo">{m.motivo}. Marcados, salen del precio, las ventas y el score; los ves tachados en Competencia y se pueden devolver.</p>
      <ul className="mejora-lista mejora-grupos">
        {m.grupos.map((g) => (
          <li key={g.frase}>
            <label className="mejora-grupo">
              <input type="checkbox" checked={elegidas.has(g.frase)} onChange={() => alternar(g.frase)} disabled={!!ocupado} />
              <span>
                <span className="mejora-kw">{g.nombre}</span>
                <small className="mejora-ejemplos" title={g.ejemplos.join('\n')}>títulos con «{g.frase}» · ej: {g.ejemplos[0]}</small>
              </span>
            </label>
            <b className="mejora-vol">{g.productos} productos</b>
            <em className="mejora-rel amplia">{g.pctVendidos != null ? `${g.pctVendidos}% de lo vendido` : `${g.pctProductos}% del top`}</em>
          </li>
        ))}
      </ul>
      <div className="mejora-pie">
        <button type="button" className="boton-secundario" disabled={!!ocupado || !elegidas.size} onClick={() => accion(() => api.aplicarMejoraCompetencia(o.nichoId, [...elegidas]), 'aplicar')}>
          {ocupado === 'aplicar' ? 'recalculando…' : `Sacar ${elegidas.size === 1 ? 'este grupo' : `estos ${elegidas.size} grupos`} del nicho`}
        </button>
        <button type="button" className="enlace-boton" disabled={!!ocupado} onClick={() => accion(() => api.descartarMejora(o.nichoId, 'competencia'), 'descartar')}>Descartar: todos son del nicho</button>
        {error ? <span className="mejora-error">{error}</span> : null}
      </div>
    </div>
  )
}

function MejoraMedicion({ o, m, onRecargar }) {
  const [ocupado, setOcupado] = useState(null)
  const [error, setError] = useState(null)
  const accion = async (fn, clave) => {
    setOcupado(clave); setError(null)
    try { await fn(); onRecargar() } catch (e) { setError(e.message) } finally { setOcupado(null) }
  }
  return (
    <div className="mejora" onClick={(e) => e.stopPropagation()}>
      <div className="mejora-cab"><Lightbulb size={16} aria-hidden="true" /><strong>Mejora detectada: en Chile se busca con otro nombre</strong></div>
      <p className="mejora-motivo">{m.motivo}. Hoy se mide como «{m.medidaActual?.keyword}» ({fmtNum(m.medidaActual?.volumen ?? 0)}/mes).</p>
      <ul className="mejora-lista">
        {m.candidatas.map((c) => (
          <li key={c.keyword}>
            <span className="mejora-kw">«{c.keyword}»</span>
            <b className="mejora-vol">{fmtNum(c.volumen)}/mes</b>
            <em className={`mejora-rel ${c.relacion === 'mismo-producto' ? 'ok' : 'amplia'}`} title={c.nota}>{c.relacion === 'mismo-producto' ? 'mismo producto' : 'familia más amplia'}</em>
            <button type="button" className="boton-secundario" disabled={!!ocupado} onClick={() => accion(() => api.aplicarMejoraMedicion(o.nichoId, c.keyword), c.keyword)}>
              {ocupado === c.keyword ? 'aplicando…' : 'Usar esta'}
            </button>
          </li>
        ))}
      </ul>
      <div className="mejora-pie">
        <button type="button" className="enlace-boton" disabled={!!ocupado} onClick={() => accion(() => api.descartarMejora(o.nichoId, 'medicion'), 'descartar')}>Descartar: la medición actual está bien</button>
        {error ? <span className="mejora-error">{error}</span> : null}
      </div>
    </div>
  )
}

// ROPA: la tabla del proveedor llevada a talla chilena por cm (ver
// services/tallasChile.js). Se publica con la letra chilena, no con la suya.
function TallasChile({ t }) {
  const cm = (a, b) => (a != null && b != null ? `${a}-${b}` : a ?? b ?? '—')
  return (
    <div className="tallas" onClick={(e) => e.stopPropagation()}>
      <div className="tallas-cab">
        <strong>Tallas del proveedor en talla chilena</strong>
        <span className="tallas-avisos">
          {t.correChica ? <em className="tallas-aviso mal">viene una talla más chica: publicar con la chilena</em> : null}
          {t.faltanEnChile?.length ? <em className="tallas-aviso medio">faltan {t.faltanEnChile.join(', ')}: pedírselas</em> : null}
          {t.fueraDeDemanda?.length ? <em className="tallas-aviso">su {t.fueraDeDemanda.join(', ')} casi no se vende en Chile</em> : null}
        </span>
      </div>
      <table className="tallas-tabla">
        <thead><tr><th>Proveedor</th><th>Chile</th><th>Busto</th><th>Cintura</th><th>Cadera</th><th>Copa</th></tr></thead>
        <tbody>
          {t.filas.map((f) => (
            <tr key={f.talla} className={f.diferencia === 'chica' ? 'chica' : ''}>
              <td>{f.talla}</td>
              <td><b>{f.letraCl ?? '—'}</b>{f.numeroCl ? <small> ({f.numeroCl})</small> : null}</td>
              <td>{cm(f.bustoMin, f.bustoMax)}</td><td>{cm(f.cinturaMin, f.cinturaMax)}</td><td>{cm(f.caderaMin, f.caderaMax)}</td>
              <td>{f.copa ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tallas-nota">Por centímetros contra la numeración que usa el comercio en Chile (no hay tabla oficial). En traje de baño pesa más la cadera. Medidas en cm.</p>
    </div>
  )
}

// ¿El modelo y los años salen de una publicación real o los puso la IA? ML no
// entrega la compatibilidad oficial de publicaciones ajenas; lo verificable es
// lo que el vendedor escribió en su título, y eso se comprueba sin la IA.
const SELLOS = {
  verificada: { clase: 'ok', texto: '✓ en publicación', ayuda: 'El modelo y los años están escritos en el título de esta publicación del top. Es lo que declara el vendedor, no la tabla oficial de ML.' },
  parcial: { clase: 'medio', texto: '≈ años sin confirmar', ayuda: 'El modelo aparece en la publicación citada, pero los años no están escritos así en su título: pueden ser de la IA.' },
  'no-calza': { clase: 'mal', texto: '⚠ no calza', ayuda: 'La publicación citada es de otro auto: esta fila no tiene respaldo.' },
  'sin-fuente': { clase: 'mal', texto: '⚠ sin respaldo', ayuda: 'Ninguna publicación del top respalda estos modelos y años: vienen del conocimiento de la IA. Verificar con el proveedor antes de cotizar.' },
  'no-revisada': { clase: 'medio', texto: 'sin revisar', ayuda: 'Análisis anterior a la verificación: se revisa en el próximo análisis.' },
}
function SelloVerificacion({ f }) {
  const s = SELLOS[f.verificacion] ?? SELLOS['no-revisada']
  const titulo = `${s.ayuda}${f.fuente?.titulo ? `\nFuente: "${f.fuente.titulo}"` : ''}`
  return f.fuente?.url
    ? <a className={`op-plan-sello op-plan-sello-${s.clase}`} href={f.fuente.url} target="_blank" rel="noreferrer" title={titulo} onClick={(e) => e.stopPropagation()}>{s.texto}</a>
    : <span className={`op-plan-sello op-plan-sello-${s.clase}`} title={titulo}>{s.texto}</span>
}


function FletePropio({ o, onRecargar }) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(o.fletePropioClp ?? '')
  const [guardando, setGuardando] = useState(false)
  const chip = o.logistica ? LOGISTICA_CHIP[o.logistica] : null
  // solo aparece cuando la logística importa: el analista no propone Full, o
  // el importador ya anotó un flete
  if (!chip && o.fletePropioClp == null) return null
  if (o.logistica === 'full' && o.fletePropioClp == null) {
    return null
  }

  async function guardar(e) {
    e.preventDefault()
    e.stopPropagation()
    setGuardando(true)
    try {
      await api.ajustarNicho(o.nichoId, { fletePropioClp: valor === '' ? null : Number(valor) })
      setEditando(false)
      onRecargar()
    } finally {
      setGuardando(false)
    }
  }

  if (editando) {
    return (
      <form className="op-cot-form" onSubmit={guardar} onClick={(e) => e.stopPropagation()}>
        <label>flete propio $/bulto</label>
        <input type="number" min="0" step="1" autoFocus value={valor} onChange={(e) => setValor(e.target.value)} placeholder="lo que te cuesta despacharlo tú" />
        <button type="submit" className="boton-secundario boton-chico" disabled={guardando}>
          {guardando ? '…' : 'ok'}
        </button>
        <button
          type="button"
          className="boton-plano boton-chico"
          onClick={(e) => {
            e.stopPropagation()
            setValor(o.fletePropioClp ?? '')
            setEditando(false)
          }}
        >
          cancelar
        </button>
      </form>
    )
  }

  return (
    <button
      type="button"
      className={`op-cotizacion op-cot-boton ${o.fletePropioClp != null ? 'bien' : 'pendiente'}`}
      title={
        (chip ? `${chip.title}. ` : '') +
        (o.fletePropioClp != null
          ? `Despachar un bulto con tu courier te cuesta ${fmtPrecio(o.fletePropioClp)} — clic para cambiarlo`
          : 'Anota cuánto te cuesta despachar un bulto con courier propio: el analista lo compara contra la tarifa de Mercado Envíos, que es la misma desde Full que desde tu bodega')
      }
      onClick={(e) => {
        e.stopPropagation()
        setEditando(true)
      }}
    >
      {chip ? `${chip.texto} · ` : ''}
      {o.fletePropioClp != null ? `flete propio ${fmtPrecio(o.fletePropioClp)}` : 'flete propio ?'}
    </button>
  )
}


// Nichos que miden el MISMO mercado que la carta líder (solape de SKUs)
function FamiliaColapsada({ miembros, porKeyword, lider, onAbrir, onRecargar }) {
  const [abierta, setAbierta] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  async function absorber(m) {
    const o = porKeyword.get(m.keyword)
    if (!o) return
    setOcupado(true)
    try {
      await api.ajustarNicho(o.nichoId, { estado: 'pausado', notaEtapa: `familia de ${lider.keyword}` })
      onRecargar()
    } finally {
      setOcupado(false)
    }
  }

  async function mantenerAparte(m) {
    const o = porKeyword.get(m.keyword)
    if (!o) return
    setOcupado(true)
    try {
      await api.ajustarNicho(o.nichoId, { familiaAparte: lider.keyword })
      onRecargar()
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="familia">
      <button className="familia-toggle" onClick={() => setAbierta(!abierta)}>
        {abierta ? '▾' : '▸'} {miembros.length === 1 ? '1 nicho mide' : `${miembros.length} nichos miden`} este mismo
        mercado: {miembros.map((m) => m.keyword).join(' · ')}
      </button>
      {abierta ? (
        <ul className="familia-lista">
          {miembros.map((m) => {
            const o = porKeyword.get(m.keyword)
            const esJugada = o?.esJugadaDelLider
            const nv = o?.nivelBusqueda?.nivel
            return (
              <li key={m.keyword}>
                <button className="enlace-boton" onClick={() => o && onAbrir(o.nichoId)}>
                  {m.keyword}
                </button>{' '}
                {nv ? <span className={`chip-busqueda ${NIVELES[nv]?.clase ?? ''}`}>{NIVELES[nv]?.texto}</span> : null}{' '}
                <span className="plan-motivo">
                  {m.solapePct}% del top compartido · score {o?.score ?? '—'}
                  {esJugada ? ' · sub-nicho de jugada' : ''}
                </span>{' '}
                <button
                  className="boton-secundario boton-mini"
                  onClick={() => absorber(m)}
                  disabled={ocupado}
                  title="Pausa este nicho (reversible): deja de pagar scans duplicados"
                >
                  absorber
                </button>{' '}
                {!esJugada ? (
                  <button
                    className="enlace-boton"
                    onClick={() => mantenerAparte(m)}
                    disabled={ocupado}
                    title="Falso positivo: son mercados distintos"
                  >
                    mantener aparte
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

// LA MESA EN PESTAÑAS POR MOMENTO DE COMPRA (2-oct-2026).
//
// Historia del orden: primero mandaba la ventana; después la constancia (los de
// todo el año arriba, por caja: un plano rota el capital 4-5 veces al año); el
// 24-sep se mezcló todo lo que se puede traer hoy, porque con los planos arriba
// el importador terminó cotizando solo productos planos (ver lib/momentoCompra.js).
// Los grupos plegables y los cinco contadores de arriba repetían lo mismo que
// los filtros: ahora el momento es una pestaña y el conteo va en ella.
const GRUPOS_OP = [
  { id: 'ahora', titulo: 'Para traer ahora', sub: 'Temporadas con la ventana abierta y productos de todo el año, ordenados por puntaje + urgencia.' },
  { id: 'adelante', titulo: 'Más adelante', sub: 'Temporadas que todavía no toca pedir: pedir hoy es capital dormido.' },
  { id: 'sin-medir', titulo: 'Midiendo', sub: 'Recién descubiertos, sin curva de búsqueda o sin búsqueda en ML: todavía sin veredicto.' },
]

const FILTROS = [
  ['vara', `Sobre ${fmtNum(VARA_BUSQUEDAS)} búsquedas`, (o) => (o.curvaAnual?.busquedasMes ?? 0) >= VARA_BUSQUEDAS],
  ['buscados', 'Búsqueda alta', (o) => o.nivelBusqueda?.nivel === 'alto'],
  ['confirmados', 'Confirmados', (o) => o.confirmacion === 'confirmado'],
  ['cotizando', 'En cotización', (o) => ['cotizando', 'pedido'].includes(o.etapaCompra)],
  ['cotizados', 'Con costo', (o) => Boolean(o.cotizacion)],
  ['arreglar', 'Keyword por arreglar', (o) => o.nivelBusqueda?.nivel === 'renombrar'],
]

// LO QUE EL SCRAPER VIO, SIN INTERMEDIARIOS. El resto de la mesa son métricas
// derivadas (nivel, veredicto, ventana); esto es el listado crudo de ML tal
// como salió, en el orden en que ML lo ordena. Sirve para lo que ningún número
// resuelve: mirar los títulos, las fotos y los precios y decidir si ese
// producto se puede traer mejor.
//
// Se pide al abrir la fila, no con el tablero: son ~95 productos por nicho y
// cargarlos para las 69 filas de una sola vez es un payload que nadie mira.
// EL DETALLE DEL NICHO, fijo a la derecha con su propio scroll (2-oct-2026).
//
// Antes era la carta entera apilada: chips de búsqueda, ventana, salud y
// trámites arriba, la caja de mejoras, los gráficos, la competencia y el estado
// de la compra uno debajo del otro. Ahora una cabecera fija dice qué es y por
// qué, y el resto va en pestañas: lo que se lee para decidir (Resumen), cuándo
// y a qué precio, contra quién, y lo que se hace para comprarlo.
function PanelNicho({ o, rank, mismaCompraQue, porKeyword, onAbrir, onRecargar, onCerrar, pronostico, modeloGana, tendencia }) {
  const [pestana, setPestana] = useState('resumen')
  const m = momentoDeCompra(o)
  const pestanas = [
    ['resumen', 'Resumen'],
    ['temporada', 'Temporada · precio'],
    ['competencia', 'Competencia'],
    ['compra', 'Compra'],
    ...(o.mejoras?.length ? [['mejoras', `Mejoras (${o.mejoras.length})`]] : []),
  ]
  return (
    <div className="op-panel-dentro opp">
      <div className="op-panel-barra">
        <span className="opp-rank">#{rank}</span>
        <span className="op-panel-momento" />
        <button type="button" className="boton-secundario op-panel-ir" onClick={() => onAbrir(o.nichoId)}>Ver análisis completo →</button>
        <button type="button" className="op-panel-cerrar" onClick={onCerrar} aria-label="Cerrar el detalle (Esc)" title="Cerrar (Esc)">✕</button>
      </div>

      <div className="opp-cab">
        <span className="opp-foto">{o.imagen ? <Miniatura src={o.imagen} lado={88} /> : <ImageOff size={24} aria-hidden="true" />}</span>
        <div className="opp-cab-texto">
          <h3>{o.keyword}</h3>
          <p className={`opp-momento m-${m.clase}`}><b>{capital(m.etiqueta)}</b>{m.motivo ? <span>{m.motivo}</span> : null}</p>
          <div className="opp-sellos">
            {o.veredicto && !o.midiendo ? <span className={`op-pildora veredicto-${o.veredicto}`}>{o.veredicto.replace(/_/g, ' ')}</span> : null}
            {o.confirmacion && !o.midiendo ? (
              <span className="opp-sello" title={o.confirmacion === 'confirmado' ? `Demanda sostenida en ${o.scansConDemanda} scans` : `Solo ${o.scansConDemanda} scan(s) con demanda`}>
                {o.confirmacion === 'confirmado' ? `✓ confirmado · ${o.scansConDemanda} scans` : `preliminar · ${o.scansConDemanda} scans`}
              </span>
            ) : null}
            {o.etapaCompra && o.etapaCompra !== 'evaluando' ? <b className={`opt-etapa e-${o.etapaCompra}`}>{ETAPA_TEXTO[o.etapaCompra] ?? o.etapaCompra}</b> : null}
          </div>
        </div>
        <span className="opp-score">
          {o.midiendo
            ? <span className="opt-midiendo">{o.scansConDemanda}/{o.scansConDemanda + o.faltanScans}<small>scans</small></span>
            : Number.isFinite(o.score) ? <ScoreRing valor={o.score} size={58} grosor={5} /> : null}
        </span>
      </div>
      {o.titular ? <p className="opp-titular">{o.titular}</p> : null}

      {o.midiendo ? (
        <>
          <p className="opp-nota">
            El radar lo descubrió recién y el sistema lo escanea a diario. No hay score ni veredicto porque todavía no
            hay serie que los sostenga, y no se van a estimar.
            {o.curvaAnual?.busquedasMes ? ` Lo que sí está medido: ${fmtNum(o.curvaAnual.busquedasMes)} búsquedas al mes en Chile.` : ' Falta medirle el volumen de búsqueda.'}
          </p>
          <ProductosEscaneados nichoId={o.nichoId} />
        </>
      ) : (
        <>
          <div className="op-pestanas opp-pestanas" role="tablist">
            {pestanas.map(([id, nombre]) => (
              <button key={id} type="button" role="tab" aria-selected={pestana === id} className={`op-pestana${pestana === id ? ' activa' : ''}`} onClick={() => setPestana(id)}>{nombre}</button>
            ))}
          </div>
          {pestana === 'resumen' ? <ResumenNicho o={o} tendencia={tendencia} /> : null}
          {pestana === 'temporada' ? (
            <div className="op-graficos">
              <GraficoTemporada curva={o.curvaAnual} ventana={o.ventana} />
              <GraficoPrecio precios={o.precios} precioVenta={o.precioVentaClp} />
              <GraficoPronostico pronostico={pronostico} modeloGana={modeloGana} />
            </div>
          ) : null}
          {pestana === 'competencia' ? <CompetenciaNicho o={o} /> : null}
          {pestana === 'compra' ? <CompraNicho o={o} onRecargar={onRecargar} mismaCompraQue={mismaCompraQue} /> : null}
          {pestana === 'mejoras' && o.mejoras?.length ? <MejorasNicho o={o} onRecargar={onRecargar} /> : null}
        </>
      )}
      {o.familiaMiembros?.length ? (
        <FamiliaColapsada miembros={o.familiaMiembros} porKeyword={porKeyword} lider={o} onAbrir={onAbrir} onRecargar={onRecargar} />
      ) : null}
    </div>
  )
}

// LO QUE SE LEE PARA DECIDIR: las alertas enteras con su porqué, y las cifras.
function ResumenNicho({ o, tendencia }) {
  const nb = o.nivelBusqueda
  const nivel = nb?.nivel ? NIVELES[nb.nivel] : null
  const flecha = o.tendenciaVentas ? FLECHA[o.tendenciaVentas] : null
  const c = o.curvaAnual
  return (
    <div className="opp-resumen">
      <AvisosLista lista={avisosDe(o, tendencia)} />
      <h4 className="opp-sub">Las cifras</h4>
      <div className="op-hechos">
        <Hecho etiqueta="búsqueda">
          {nivel ? <span title={nb.explicacion ?? ''}>{nivel.texto}{nb.posicion ? <i> · #{nb.posicion}/{nb.deCuantas} en “{nb.prefijo}”</i> : null}</span> : 'sin medir'}
        </Hecho>
        <Hecho etiqueta="búsquedas/mes">{c?.busquedasMes ? fmtNum(c.busquedasMes) : null}</Hecho>
        <Hecho etiqueta="vender a">{o.precioVentaClp ? fmtPrecio(o.precioVentaClp) : null}</Hecho>
        <Hecho etiqueta="EXW máx">{o.exwMaximoUsd != null ? `US$ ${o.exwMaximoUsd}` : null}</Hecho>
        <Hecho etiqueta="mediana">{o.mediana ? fmtPrecio(o.mediana) : null}</Hecho>
        {/* LO CONTADO, no lo derivado: reseñas nuevas es un entero exacto que
            entrega ML; la estimación de ventas/día va plegada en Competencia */}
        <Hecho etiqueta="se mueve">
          {o.resenasNuevas != null && o.ventanaDias ? (
            <span title={`${o.resenasNuevas} reseñas nuevas en ${o.ventanaDias} días, contadas sobre ${o.canasta} productos ${o.fuenteResenas === 'api' ? 'de todo el listado (API oficial de ML)' : 'del top (ficha)'}${o.saltosFiltrados ? ` · ${o.saltosFiltrados} saltos de catálogo descartados` : ''}`}>
              +{fmtNum(o.resenasNuevas)} reseñas / {o.ventanaDias}d{' '}
              {flecha ? <span className={`delta ${flecha[1]}`}>{flecha[0]}</span> : null}
              {o.saltosFiltrados ? <span className="op-sucio" title="hubo saltos de catálogo filtrados">⚠</span> : null}
            </span>
          ) : null}
        </Hecho>
        {/* el dato que el juez descartó queda a la vista: si alguna vez un
            salto era real, se tiene que poder ver */}
        {o.saltoSospechoso ? (
          <Hecho etiqueta="descartado">
            <span className="op-sucio" title={`Se midieron ${Math.round(o.saltoSospechoso.valorCrudo)} ventas/día contra ${Math.round(o.saltoSospechoso.contra)} del scan anterior (×${o.saltoSospechoso.salto}). ${o.saltoSospechoso.motivo}`}>
              ⚠ salto ×{o.saltoSospechoso.salto} no creíble
            </span>
          </Hecho>
        ) : null}
        {o.vendidosHistoricos?.pisoUnidades ? (
          <Hecho etiqueta="el top vendió">
            <span title={ayudaTrayectoria(o.vendidosHistoricos)}>
              al menos {fmtNum(o.vendidosHistoricos.pisoUnidades)} en toda su vida
              {o.vendidosHistoricos.pctCobertura != null ? <i> · {o.vendidosHistoricos.pctCobertura}% del top despegó</i> : null}
            </span>
          </Hecho>
        ) : null}
        {o.conversion?.factor ? <Hecho etiqueta="convierte"><Conversion c={o.conversion} /></Hecho> : null}
        <Hecho etiqueta="Full">{o.pctFull != null ? `${Math.round(o.pctFull)}% del top` : null}</Hecho>
        <Hecho etiqueta="publicidad en ML">
          {o.presionAds ? (
            <span title={`Del top orgánico con dato (${o.presionAds.topConDato}), ${o.presionAds.pctTopPaga}% además paga anuncios. ${o.presionAds.anunciantes} vendedores distintos anuncian en el listado${o.presionAds.anunciantesOficiales ? `, ${o.presionAds.anunciantesOficiales} de ellos tiendas oficiales` : ''}; ${o.presionAds.anunciosPuros} anuncios pagan sin rankear.`}>
              {o.presionAds.pctTopPaga != null ? `${o.presionAds.pctTopPaga}% del top paga` : '—'}<i> · {o.presionAds.anunciantes} anunciantes</i>
            </span>
          ) : <i>se mide desde el próximo scan</i>}
        </Hecho>
        <Hecho etiqueta="sellers">{o.sellersUnicos != null ? fmtNum(o.sellersUnicos) : null}</Hecho>
        {/* un pct alto de "últimas unidades" no es riesgo: es un nicho
            desabastecido, o sea una ventana para quien trae stock */}
        {o.profundidadStock?.itemsPorAgotarse ? (
          <Hecho etiqueta="por agotarse">
            <span title={`${o.profundidadStock.itemsPorAgotarse} de ${o.profundidadStock.itemsDelScan} publicaciones del top muestran "últimas unidades" (5 o menos). Entre ellas quedan ${o.profundidadStock.unidadesVisibles} unidades; del resto no se sabe.`}>
              {o.profundidadStock.pctEnUltimas}% del top{o.profundidadStock.pctEnUltimas >= 40 ? ' · desabastecido' : ''}
            </span>
          </Hecho>
        ) : null}
        {o.pctCrossBorder ? (
          <Hecho etiqueta="importan directo">
            <span title={`${Math.round(o.pctCrossBorder)}% del top despacha desde el extranjero. Doble filo: prueba de que el producto se importa bien, y a la vez rival con tu misma estructura de costo.`}>
              {Math.round(o.pctCrossBorder)}%{o.origenesCrossBorder ? ` · ${Object.keys(o.origenesCrossBorder).join('/')}` : ''}
            </span>
          </Hecho>
        ) : null}
      </div>
      {o.condiciones ? <p className="op-condicion">Condición: {o.condiciones}</p> : null}
      {o.fechaScan ? <p className="opp-pie">Último scan {fmtFecha(o.fechaScan)}</p> : null}
    </div>
  )
}

// LO QUE SE HACE PARA COMPRARLO: etapa, costo, flete y el plan.
function CompraNicho({ o, onRecargar, mismaCompraQue }) {
  return (
    <div className="opp-compra">
      <div className="opp-campos">
        <label className="opp-campo">
          <span>Etapa</span>
          <select
            className="etapa-select"
            value={o.etapaCompra ?? 'evaluando'}
            title={o.notaEtapa ?? 'Etapa del embudo de compra'}
            onChange={async (e) => {
              await api.ajustarNicho(o.nichoId, { etapaCompra: e.target.value })
              onRecargar()
            }}
          >
            {ETAPAS.map((et) => <option key={et} value={et}>{et.replace(/-/g, ' ')}</option>)}
          </select>
        </label>
        <div className="opp-campo"><span>Costo</span><Cotizacion o={o} onRecargar={onRecargar} /></div>
        {o.logistica && o.logistica !== 'full' || o.fletePropioClp != null ? (
          <div className="opp-campo"><span>Despacho</span><FletePropio o={o} onRecargar={onRecargar} /></div>
        ) : null}
      </div>
      <div className="op-hechos">
        <Hecho etiqueta="1ª compra">{o.primeraCompra ? `${o.primeraCompra}${o.inversionEstimadaUsd != null ? ` (~US$ ${fmtNum(o.inversionEstimadaUsd)})` : ''}` : null}</Hecho>
        <Hecho etiqueta="vender a">{o.precioVentaClp ? fmtPrecio(o.precioVentaClp) : null}</Hecho>
        <Hecho etiqueta="EXW máx">{o.exwMaximoUsd != null ? `US$ ${o.exwMaximoUsd}` : null}</Hecho>
        <Hecho etiqueta="listing">{o.listingListo ? '✓ listo' : null}</Hecho>
        {mismaCompraQue ? <Hecho etiqueta="misma compra que"><span title="Mismo producto de fábrica: un solo pedido cubre ambos nichos">{mismaCompraQue}</span></Hecho> : null}
        {Number.isFinite(o.shareJugadaPct) && o.shareJugadaPct < 50 ? (
          <Hecho etiqueta="jugada">
            <span title={`El top mezcla familias; la jugada recomendada concentra el ${o.shareJugadaPct}% de las reseñas${o.keywordJugada ? ` — se aísla con "${o.keywordJugada}"` : ''}`}>{o.shareJugadaPct}% del top</span>
          </Hecho>
        ) : null}
      </div>
      {o.planPublicidad ? <PlanPublicidad plan={o.planPublicidad} /> : null}
      {o.tallas ? <TallasChile t={o.tallas} /> : null}
      {/* repuestos: la compra es por pieza y por auto — sin modelo y años no se cotiza */}
      {o.planRepuestos?.length ? (
        <ol className="op-plan-repuestos">
          {o.planRepuestos.map((f) => (
            <li key={`${f.prioridad}-${f.marca}-${f.pieza}`} className={`op-plan-${f.verificacion ?? 'no-revisada'}`}>
              <b className="op-plan-n">{f.prioridad}</b>
              <span className="op-plan-auto">
                <strong>{f.marca}</strong>{f.pieza ? <em> · {f.pieza}</em> : null}
                <span className="op-plan-modelos">{f.modelos}</span>
              </span>
              <SelloVerificacion f={f} />
              {f.referencia ? <code className="op-plan-ref" title="Código de la pieza, tal como aparece en el top de ML">{f.referencia}</code> : null}
              {f.precioVentaClp ? <span className="op-plan-precio">{fmtPrecio(f.precioVentaClp)}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

// ↑ ↓ recorren la lista con el panel a la vista (no cuando se escribe en un campo)
function NavegarConFlechas({ orden, actual, onElegir }) {
  useEffect(() => {
    const alTeclear = (e) => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key) || /input|select|textarea/i.test(e.target?.tagName ?? '')) return
      const i = orden.findIndex((o) => o.nichoId === actual?.nichoId)
      const siguiente = orden[Math.min(orden.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (siguiente && siguiente !== actual) { e.preventDefault(); onElegir(siguiente) }
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [orden, actual, onElegir])
  return null
}


// UNA lista de competencia: el scan (orden de ML) con lo que se sabe de cada
// producto pegado como sello —su lugar en los más vendidos de la categoría y
// lo que vendió medido por stock— en vez de tres listas que se repetían.
const idsDe = (p) => [p.sku, p.itemId, p.catalogId].filter(Boolean)
function CompetenciaNicho({ o }) {
  const [datos, setDatos] = useState(null)
  const [todos, setTodos] = useState(false)
  const [version, setVersion] = useState(0)
  const [marcando, setMarcando] = useState(null) // sku al que se le escribe la frase
  const [frase, setFrase] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  // sacar o devolver productos del nicho: recalcula el reporte en el servidor
  const ajustar = async (cambios) => {
    setOcupado(true); setError(null)
    try { await api.ajustarExcluidos(o.nichoId, cambios); setMarcando(null); setFrase(''); setVersion((v) => v + 1) }
    catch (e) { setError(e.message) } finally { setOcupado(false) }
  }
  useEffect(() => {
    let vivo = true
    Promise.all([
      api.productosNicho(o.nichoId, 20).catch(() => null),
      api.masVendidos(o.keyword).catch(() => null),
      api.seguimiento(o.keyword).catch(() => null),
    ]).then(([prod, mv, seg]) => vivo && setDatos({ prod, cat: mv?.categorias?.[0] ?? null, seguidos: seg?.nichos?.find((n) => n.keyword === o.keyword)?.publicaciones ?? [] }))
    return () => { vivo = false }
  }, [o.nichoId, o.keyword, version])
  if (!datos) return <Cargando texto="Juntando la competencia…" />
  const productos = datos.prod?.productos ?? []
  if (!productos.length) return <p className="prod-vacio">El scan no dejó productos.</p>
  const ranking = new Map((datos.cat?.items ?? []).map((i) => [i.id, i]))
  const seguido = new Map(datos.seguidos.filter((x) => x.activo !== false).map((x) => [x.sku, x]))
  const enScan = new Set(productos.flatMap(idsDe))
  const enRanking = productos.filter((p) => idsDe(p).some((id) => ranking.has(id))).length
  const conStock = productos.filter((p) => seguido.has(p.sku)).length
  // del ranking, solo lo que es de la búsqueda y no salió en el scan
  const fuera = (datos.cat?.items ?? []).filter((i) => !enScan.has(i.id) && i.titulo && calzaConBusqueda(i.titulo, o.keyword)).slice(0, 6)
  return (
    <div className="comp">
      <p className="comp-resumen">
        <strong>{productos.length}</strong> primeros de {fmtNum(datos.prod.total)} en el orden de ML · scan del {fmtFecha(datos.prod.fechaScan)}
        {datos.cat ? <> · <strong>{enRanking}</strong> están entre los más vendidos de «{datos.cat.categoriaNombre ?? 'la categoría'}»</> : null}
        {conStock ? <> · <strong>{conStock}</strong> con stock seguido</> : null}
      </p>
      {datos.prod.excluidas?.length ? (
        <p className="comp-excluidas">
          <span>No se miden (no son de este nicho):</span>
          {datos.prod.excluidas.map((f) => (
            <button key={f} type="button" className="comp-excluida" disabled={ocupado} title="Devolver al nicho" onClick={() => ajustar({ quitar: [f] })}>«{f}» <X size={11} aria-hidden="true" /></button>
          ))}
        </p>
      ) : null}
      {error ? <p className="mejora-error">{error}</p> : null}
      <ol className="prod-lista">
        {(todos ? productos : productos.slice(0, 10)).map((p) => {
          const r = idsDe(p).map((id) => ranking.get(id)).find(Boolean)
          const sg = seguido.get(p.sku)
          return (
            <Fragment key={p.sku}>
            <li className={`prod-fila${r ? ' prod-top' : ''}${p.fueraDelNicho ? ' prod-fuera' : ''}`}>
              <span className="prod-pos">{p.posicion ?? '·'}</span>
              {p.imagen ? <Miniatura className="prod-foto" src={p.imagen} lado={44} /> : <span className="prod-foto prod-foto-vacia" aria-hidden="true" />}
              <div className="prod-centro">
                {p.url ? <a className="prod-titulo" href={p.url} target="_blank" rel="noreferrer">{p.titulo ?? p.sku}</a> : <span className="prod-titulo">{p.titulo ?? p.sku}</span>}
                <div className="prod-sellos">
                  {p.vendedor ? <span className="prod-vendedor">{p.vendedor}</span> : null}
                  {r ? <span className="prod-chip chip-top" title={`Puesto ${r.posicion} en el ranking oficial de más vendidos de la categoría${r.subio ? `, subió ${r.subio} en la semana` : ''}`}>#{r.posicion} más vendido{r.subio >= 2 ? ` ▲${r.subio}` : ''}</span> : null}
                  {sg && (sg.unidadesPiso > 0 || ['ciclo', 'repone', 'vende'].includes(sg.fuerza)) ? (
                    <span className={`prod-chip chip-stock${['ciclo', 'repone'].includes(sg.fuerza) ? ' fuerte' : ''}`} title="Medido por baja de stock entre lecturas: venta real, como mínimo">
                      {['ciclo', 'repone'].includes(sg.fuerza) ? 'vende y repone' : `vendió ≥${fmtNum(sg.unidadesPiso)} u`}
                    </span>
                  ) : null}
                  {p.esTiendaOficial ? <span className="prod-chip chip-oficial">tienda oficial</span> : null}
                  {p.esFull ? <span className="prod-chip chip-full">Full</span> : null}
                  {p.origenCrossBorder ? <span className="prod-chip chip-cbt" title="Se despacha desde el exterior">del exterior</span> : null}
                  {p.tipoListing === 'catalogo' ? <span className="prod-chip chip-catalogo">catálogo</span> : null}
                  {p.esAnuncio ? <span className="prod-chip chip-anuncio" title="Posición pagada: no cuenta para el top del nicho">anuncio</span> : null}
                  {p.fueraDelNicho ? <span className="prod-chip chip-fuera" title="No cuenta para precio, ventas ni score">no es del nicho · «{p.fueraDelNicho}»</span> : (
                    <button type="button" className="prod-sacar" onClick={() => { setMarcando(marcando === p.sku ? null : p.sku); setFrase('') }}>no es de este nicho</button>
                  )}
                </div>
              </div>
              <div className="prod-numeros">
                <span className="prod-precio">{fmtPrecio(p.precio)}</span>
                <span className="prod-sub">
                  {Number.isFinite(p.vendidos) ? <b title="Badge acumulado de ML, en baldes">+{fmtNum(p.vendidos)} vend.</b> : null}
                  {Number.isFinite(p.numReviews) ? <span>{Number.isFinite(p.vendidos) ? ' · ' : ''}{fmtNum(p.numReviews)} reseñas</span> : null}
                </span>
                {Number.isFinite(p.resenasNuevasDia) && p.resenasNuevasDia > 0 ? <span className="prod-velocidad">{p.resenasNuevasDia} reseñas/día</span> : null}
              </div>
            </li>
            {marcando === p.sku ? (
              <li className="prod-marcar">
                <form onSubmit={(e) => { e.preventDefault(); if (frase.trim()) ajustar({ agregar: [frase.trim()] }) }}>
                  <label>
                    ¿Qué palabra lo delata? Todos los títulos que la traigan dejan de medirse
                    <input autoFocus value={frase} onChange={(e) => setFrase(e.target.value)} placeholder="ej: toldo" maxLength={60} />
                  </label>
                  {frase.trim() ? <small>{productos.filter((x) => !x.fueraDelNicho && tituloTrae(x.titulo, frase)).length} de estos {productos.length} salen</small> : null}
                  <button type="submit" className="boton-secundario" disabled={ocupado || !frase.trim()}>{ocupado ? 'recalculando…' : 'Sacar del nicho'}</button>
                </form>
              </li>
            ) : null}
            </Fragment>
          )
        })}
      </ol>
      {!todos && productos.length > 10 ? (
        <button type="button" className="boton-secundario comp-mas" onClick={() => setTodos(true)}>ver {productos.length - 10} más</button>
      ) : null}
      {fuera.length ? (
        <div className="comp-fuera">
          <strong>Más vendidos de la categoría que no salen en tu scan</strong>
          <div className="comp-fuera-lista">
            {fuera.map((i) => (
              <a key={i.id} className="comp-fuera-item" href={i.url} target="_blank" rel="noreferrer" title={i.titulo}>
                {i.imagen ? <Miniatura src={i.imagen} lado={36} /> : null}
                <span>#{i.posicion} · {i.titulo}</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
      {o.ventasDia != null && o.resenasNuevas != null ? (
        <details className="op-estimacion">
          <summary>estimación de ventas</summary>
          <span>
            {fmtNum(o.resenasNuevas)} reseñas ÷ {o.ventanaDias} días × factor {o.factorEstimacion ?? 25} ≈{' '}
            <strong>{fmtNum(Math.round(o.ventasDia))}/día</strong>. El factor no está calibrado — la medición
            propia (54 ventas reales → 3 reseñas) sugiere 18, no 25.
          </span>
        </details>
      ) : null}
    </div>
  )
}

function ProductosEscaneados({ nichoId }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vivo = true
    api
      .productosNicho(nichoId, 10)
      .then((d) => vivo && setDatos(d))
      .catch((err) => vivo && setError(err.message))
    return () => {
      vivo = false
    }
  }, [nichoId])

  if (error) return <div className="prod-escaneados"><p className="prod-vacio">No se pudo traer el listado: {error}</p></div>
  if (!datos) return <div className="prod-escaneados"><Cargando texto="Trayendo el listado de ML…" /></div>
  if (!datos.productos?.length) return <div className="prod-escaneados"><p className="prod-vacio">El scan no dejó productos.</p></div>

  return (
    <div className="prod-escaneados">
      <div className="prod-encabezado">
        <strong>Lo que se escaneó en Mercado Libre</strong>
        <span className="prod-meta">
          primeros {datos.productos.length} de {fmtNum(datos.total)} · orden de ML · scan del {fmtFecha(datos.fechaScan)}
        </span>
      </div>

      <ol className="prod-lista">
        {datos.productos.map((p) => (
          <li key={p.sku} className="prod-fila">
            <span className="prod-pos">{p.posicion ?? '·'}</span>

            {p.imagen ? (
              <Miniatura className="prod-foto" src={p.imagen} lado={44} />
            ) : (
              <span className="prod-foto prod-foto-vacia" aria-hidden="true" />
            )}

            <div className="prod-centro">
              {p.url ? (
                <a className="prod-titulo" href={p.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  {p.titulo ?? p.sku}
                </a>
              ) : (
                <span className="prod-titulo">{p.titulo ?? p.sku}</span>
              )}
              <div className="prod-sellos">
                {p.vendedor ? <span className="prod-vendedor" title="Vendedor">{p.vendedor}</span> : null}
                {p.esTiendaOficial ? <span className="prod-chip chip-oficial">tienda oficial</span> : null}
                {p.esFull ? <span className="prod-chip chip-full">Full</span> : null}
                {p.origenCrossBorder ? <span className="prod-chip chip-cbt" title="Se despacha desde el exterior">del exterior</span> : null}
                {p.tipoListing === 'catalogo' ? <span className="prod-chip chip-catalogo">catálogo</span> : null}
                {/* Posición comprada. Medido el 29-ago-2026 en seis nichos: las
                    cuatro primeras posiciones del listado son anuncios en todos.
                    Se marca solo el anuncio PURO —el que paga y además rankea
                    orgánico es un competidor de verdad y no lleva chip—, y ya
                    queda fuera del top de métricas. */}
                {p.esAnuncio ? (
                  <span className="prod-chip chip-anuncio" title="Posición pagada: este aviso aparece por publicidad, no por ranking. No cuenta para el top del nicho.">
                    anuncio
                  </span>
                ) : null}
              </div>
            </div>

            <div className="prod-numeros">
              <span className="prod-precio">{fmtPrecio(p.precio)}</span>
              <span className="prod-sub">
                {/* el badge de ML es acumulado y en baldes (25/50/100/500…): dice
                    trayectoria del listing, no ritmo. Por eso va como "+N" y no
                    como una tasa, y al lado se muestra la velocidad medida. */}
                {Number.isFinite(p.vendidos) ? <b title="Badge acumulado de ML, en baldes">+{fmtNum(p.vendidos)} vend.</b> : null}
                {Number.isFinite(p.numReviews) ? (
                  <span title="Reseñas acumuladas">
                    {Number.isFinite(p.vendidos) ? ' · ' : ''}
                    {fmtNum(p.numReviews)} reseñas
                  </span>
                ) : null}
              </span>
              {Number.isFinite(p.resenasNuevasDia) && p.resenasNuevasDia > 0 ? (
                <span className="prod-velocidad" title={`${p.reviewsDelta} reseñas nuevas en ${p.ventanaDias} días. Reseñas, no ventas: son lo contado, sin factor.`}>
                  {p.resenasNuevasDia} reseñas/día
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function Oportunidades({ onAbrirNicho, alCambiarNichos }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [activos, setActivos] = useState([])
  const [grupo, setGrupo] = useState('ahora')
  // LISTA + PANEL: la tarjeta elegida se ve entera a la derecha, sin acordeón
  // que empuje la lista. En pantalla chica el panel se abre encima.
  // null = panel cerrado y la lista a todo el ancho
  const [seleccion, setSeleccion] = useState(null)
  // se cierra con Esc o con un clic fuera del panel y de las tarjetas
  useEffect(() => {
    if (!seleccion) return
    const alTeclear = (e) => { if (e.key === 'Escape') setSeleccion(null) }
    const alClic = (e) => { if (!e.target.closest?.('.op-panel, .opt, .opx-barra')) setSeleccion(null) }
    window.addEventListener('keydown', alTeclear)
    document.addEventListener('mousedown', alClic)
    return () => { window.removeEventListener('keydown', alTeclear); document.removeEventListener('mousedown', alClic) }
  }, [seleccion])
  const [busca, setBusca] = useState('')
  // pronósticos del aprendizaje, por nicho: alimentan el gráfico y la alerta de tendencia
  const [pron, setPron] = useState({ porNicho: new Map(), modeloGana: false, ordena: false })
  useEffect(() => {
    Promise.all([api.aprendizajePronosticosNichos(), api.aprendizaje()])
      .then(([p, e]) => setPron({
        porNicho: new Map((p.nichos ?? []).map((n) => [String(n.nichoId), n])),
        modeloGana: Boolean(e.modelos?.find((m) => m.objetivo === 'busquedas-google')?.evaluacion?.superaReferencias),
        ordena: Boolean(e.modelos?.find((m) => m.objetivo === 'busquedas-google')?.evaluacion?.ranking?.ordenaMejor),
      }))
      .catch(() => {}) // sin pronósticos la mesa funciona igual
  }, [])

  const cargar = useCallback(() => {
    api
      .oportunidades()
      .then(setDatos)
      .catch((err) => setError(err.message))
    alCambiarNichos?.()
  }, [alCambiarNichos])

  useEffect(() => {
    cargar()
  }, [cargar])

  // AL VOLVER A LA PESTAÑA, LOS DATOS SE REFRESCAN. Una cotización cargada por
  // fuera (otra pestaña, la API) no se veía hasta recargar a mano.
  useEffect(() => {
    let ultima = Date.now()
    const alVolver = () => {
      if (document.visibilityState !== 'visible' || Date.now() - ultima < 60_000) return
      ultima = Date.now()
      api.oportunidades().then(setDatos).catch(() => {})
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => { document.removeEventListener('visibilitychange', alVolver); window.removeEventListener('focus', alVolver) }
  }, [])

  if (error) return <main><p className="error-bloque">Error: {error}</p></main>
  if (!datos) return <main><Cargando texto="Cargando oportunidades…" /></main>

  const todas = [...datos.oportunidades].sort(compararOportunidades)
  const filtrosActivos = FILTROS.filter(([id]) => activos.includes(id))
  const q = busca.trim().toLowerCase()
  const visibles = todas
    .filter((o) => filtrosActivos.every(([, , fn]) => fn(o)))
    .filter((o) => !q || o.keyword.toLowerCase().includes(q) || (o.titular ?? '').toLowerCase().includes(q))
  const cuenta = (fn) => todas.filter(fn).length
  const tendenciaDe = (o) => (pron.ordena ? pron.porNicho.get(String(o.nichoId))?.tendencia : null)

  // cada nicho en su pestaña; los miembros de una familia viven dentro del líder
  const porGrupo = new Map(GRUPOS_OP.map((g) => [g.id, []]))
  for (const o of visibles.filter((x) => !x.familiaLider)) porGrupo.get(momentoDeCompra(o).grupo)?.push(o)
  for (const filas of porGrupo.values()) filas.sort((a, b) => compararPorMomento(a, b))
  // "misma compra que" se resuelve en el orden de toda la mesa, no de la pestaña
  const dueno = new Map(), mismaDe = new Map()
  for (const o of [...porGrupo.values()].flat()) {
    if (!o.productoClave) continue
    if (dueno.has(o.productoClave)) mismaDe.set(o.nichoId, dueno.get(o.productoClave))
    else dueno.set(o.productoClave, o.keyword)
  }
  const grupoActual = GRUPOS_OP.find((g) => g.id === grupo) ?? GRUPOS_OP[0]
  const orden = porGrupo.get(grupoActual.id) ?? []
  const rankDe = new Map(orden.map((o, i) => [o.nichoId, i + 1]))
  const porKeyword = new Map(todas.map((o) => [o.keyword, o]))
  const elegido = orden.find((o) => o.nichoId === seleccion) ?? visibles.find((o) => o.nichoId === seleccion) ?? null
  // clic en la tarjeta abierta la cierra
  const elegir = (o) => setSeleccion((actual) => (actual === o.nichoId ? null : o.nichoId))

  // la temporada con la ventana abierta no puede depender de bajar con la rueda:
  // "se me ha ido traer lo que se viene ahora, verano" (17-sep)
  const ventanaAbierta = orden.filter((o) => ['ahora', 'ultimo-mes'].includes(o.ventana?.estado))
  const enCotizacion = orden.filter((o) => ['cotizando', 'pedido'].includes(o.etapaCompra)).length

  return (
    <main>
      <div className="reporte-encabezado">
        <div>
          <h2>Oportunidades</h2>
          <p className="reporte-fecha">
            Qué conviene traer, ordenado por puntaje y urgencia. Elige uno para ver el detalle; <kbd>↑</kbd> <kbd>↓</kbd> para recorrer y <kbd>Esc</kbd> para cerrar.
          </p>
        </div>
      </div>

      <div className="opx-barra">
        <div className="opx-tabs" role="tablist" aria-label="Momento de compra">
          {GRUPOS_OP.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={grupo === g.id} className={`opx-tab${grupo === g.id ? ' activa' : ''}`}
              onClick={() => { setGrupo(g.id); setSeleccion(null) }}>
              {g.titulo}<span className="opx-tab-n">{porGrupo.get(g.id).length}</span>
            </button>
          ))}
        </div>
        <div className="opx-filtros">
          <label className="op-buscador">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nicho…" aria-label="Buscar entre las oportunidades" />
            {busca ? <button type="button" className="op-buscador-x" onClick={() => setBusca('')} aria-label="Limpiar búsqueda">×</button> : null}
          </label>
          {FILTROS.map(([id, etiqueta, fn]) => {
            const n = cuenta(fn)
            if (!n && !activos.includes(id)) return null
            return (
              <button key={id} type="button" className={activos.includes(id) ? 'chip activo' : 'chip'} aria-pressed={activos.includes(id)}
                onClick={() => setActivos((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))}>
                {etiqueta} <span className="op-filtro-n">{n}</span>
              </button>
            )
          })}
          {activos.length ? <button type="button" className="enlace-boton" onClick={() => setActivos([])}>limpiar</button> : null}
        </div>
      </div>

      <p className="opx-sub">
        {grupoActual.sub}
        {grupoActual.id === 'ahora' && ventanaAbierta.length ? (
          <> <strong className={enCotizacion ? '' : 'opx-alerta'}><CalendarClock size={13} aria-hidden="true" /> {ventanaAbierta.length} con la ventana de temporada abierta · {enCotizacion ? `${enCotizacion} en cotización` : 'ninguno en cotización todavía'}</strong></>
        ) : null}
      </p>

      {!todas.length ? (
        <p className="vacio">Todavía no hay nichos con veredicto de entrada. El radar y los análisis van llenando este panel solos.</p>
      ) : !orden.length ? (
        <p className="vacio">{visibles.length ? 'Nada en esta pestaña con estos filtros: mira las otras.' : 'Ninguna oportunidad pasa los filtros.'}</p>
      ) : (
        <div className={`op-maestro${elegido ? ' con-panel' : ''}`}>
          <div className="op-maestro-lista opx-lista">
            {elegido ? <NavegarConFlechas orden={orden} actual={elegido} onElegir={(o) => { setSeleccion(o.nichoId); document.getElementById(`op-${o.nichoId}`)?.scrollIntoView({ block: 'nearest' }) }} /> : null}
            {orden.map((o) => (
              <div key={o.nichoId} id={`op-${o.nichoId}`}>
                <TarjetaNicho o={o} rank={rankDe.get(o.nichoId)} abierta={elegido?.nichoId === o.nichoId} onAlternar={() => elegir(o)} onRecargar={cargar} tendencia={tendenciaDe(o)} />
              </div>
            ))}
          </div>
          {elegido ? (
            <aside className="op-panel abierto" aria-label="Detalle del nicho elegido">
              <PanelNicho key={elegido.nichoId} o={elegido} rank={rankDe.get(elegido.nichoId) ?? '—'} mismaCompraQue={mismaDe.get(elegido.nichoId)}
                porKeyword={porKeyword} onAbrir={onAbrirNicho} onRecargar={cargar} onCerrar={() => setSeleccion(null)}
                pronostico={pron.porNicho.get(String(elegido.nichoId))} modeloGana={pron.modeloGana} tendencia={tendenciaDe(elegido)} />
            </aside>
          ) : null}
        </div>
      )}

      <Criterios />

      <p className="nota">
        "EXW máx" es lo más que puedes pagar en China (precio ex-fábrica) para que el margen cierre al precio
        sugerido. La ventana sale del pico de temporada menos el lead time de importación (~2 meses desde que
        pagas hasta tener stock vendible en Full).
      </p>
    </main>
  )
}
