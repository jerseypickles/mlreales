import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { Cargando, ScoreRing } from './ui.jsx'
import { Criterios } from './Criterios.jsx'
import { compararOportunidades } from '../lib/sidebar.js'
import { fmtNum, fmtPrecio, fmtFecha } from '../lib/formato.js'

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

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const fmtMes = (m) => (m ? MESES[Number(m.slice(5, 7)) - 1] + (m.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${m.slice(2, 4)}` : '') : '')

function chipVentana(v) {
  if (!v || v.estado === 'sin-temporada') return null
  const pico = v.pico ? ` · pico ${fmtMes(v.pico)}` : ''
  if (v.estado === 'ultimo-mes') {
    return { clase: 'ahora', icono: '🔥', texto: 'último mes para pedir', ayuda: `Pidiendo este mes el stock llega justo al arranque del pico${pico}` }
  }
  if (v.estado === 'ahora') {
    return { clase: 'ahora', icono: '🎯', texto: `pedir hasta ${fmtMes(v.hasta)}`, ayuda: `Ventana abierta ${fmtMes(v.desde)}–${fmtMes(v.hasta)}${pico}` }
  }
  if (v.estado === 'pronto') {
    return { clase: 'pronto', texto: `pedir ${fmtMes(v.desde)}`, ayuda: `La ventana abre en ${v.mesesAl} mes(es)${pico}` }
  }
  return {
    clase: 'futura',
    texto: `pedir ${fmtMes(v.desde)}`,
    ayuda: v.perdioLaTemporada
      ? `La temporada de este año ya no se alcanza. Próxima ventana ${fmtMes(v.desde)}–${fmtMes(v.hasta)}${pico}`
      : `Faltan ${v.mesesAl} mes(es)${pico}`,
  }
}

function Hecho({ etiqueta, children }) {
  if (children == null || children === '') return null
  return (
    <span className="op-hecho">
      <span className="op-hecho-etiqueta">{etiqueta}</span> {children}
    </span>
  )
}

const MESES_CORTOS = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

// LA FORMA DEL AÑO de un vistazo. Índice 0-100 de Google Trends relativo a la
// PROPIA keyword: sirve para comparar diciembre contra julio del mismo
// producto, jamás un producto contra otro. Por eso no lleva eje ni números.
function CurvaAno({ curva }) {
  if (!curva?.curva?.length) return null
  const max = Math.max(...curva.curva) || 1
  const mesHoy = new Date().getMonth()
  return (
    <div
      className="curva-ano"
      title={
        curva.fuente === 'google-ads'
          ? `${curva.busquedasMes?.toLocaleString('es-CL') ?? '?'} búsquedas al mes en Chile · pico en ${curva.nombreMesPico} (${curva.ratioPico}× el promedio). Volumen real de Google Ads, últimos 12 meses — comparable con otros nichos.`
          : `Pico en ${curva.nombreMesPico} · ${curva.ratioPico}× el promedio (Google Trends, índice 0-100 relativo a esta keyword: NO comparable con otros nichos)`
      }
    >
      <div className="curva-barras">
        {curva.curva.map((v, i) => (
          <span
            key={i}
            className={`curva-barra${i === mesHoy ? ' curva-hoy' : ''}`}
            style={{ height: `${Math.max(6, Math.round((100 * v) / max))}%` }}
            // el valor del mes al pasar el mouse: en google-ads son búsquedas
            // reales, en trends un índice 0-100 relativo a la propia keyword
            data-mes={`${MESES_LARGOS[i]}: ${
              curva.fuente === 'google-ads' ? `${fmtNum(v)} búsquedas` : `índice ${v}`
            }`}
          >
            <i>{MESES_CORTOS[i]}</i>
          </span>
        ))}
      </div>
      <span className="curva-pie">
        {curva.busquedasMes != null ? (
          <strong className="curva-volumen">{fmtNum(curva.busquedasMes)} búsquedas/mes</strong>
        ) : null}
        {/* la keyword del nicho nació comprimida y se mide en Google con la
            forma buena: se declara para que el número no parezca mágico */}
        {curva.keywordMedida && curva.keywordMedida !== curva.keyword ? (
          <em
            className="curva-corregida"
            title={`El nicho se llama «${curva.keyword}» y así se sigue midiendo en Mercado Libre. En Google se midió con «${curva.keywordMedida}», que es como la gente lo escribe${curva.correccionFactor ? ` — ${curva.correccionFactor}× más búsquedas` : ''}. El nicho no se renombra para no romper su serie.`}
          >
            {' '}como «{curva.keywordMedida}»
          </em>
        ) : null}
        {/* la etiqueta tiene que calzar con lo que muestra la barra: un ratio
            de 1,5 sobre una silueta plana no es "temporada", es un bulto */}
        {curva.clasificacion === 'estacional'
          ? ` temporada real · pico ${curva.nombreMesPico}, ${curva.ratioPico}× el promedio`
          : curva.clasificacion === 'alza-suave'
            ? ` se busca todo el año · leve alza en ${curva.nombreMesPico} (${curva.ratioPico}×)`
            : ' se busca parejo todo el año'}
      </span>
    </div>
  )
}

// FILA DENSA: lo que se lee de un vistazo, en 40px de alto.
//
// La tarjeta completa mide ~300px, y con 48 nichos eso son 14.000px de scroll
// para encontrar lo que se puede comprar hoy. Acá va solo lo que decide si
// vale la pena abrirla; el detalle se despliega con un clic.
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
  if (!v?.pisoUnidades) return <span className="op-fila-vend" />
  const pct = v.pctCobertura ?? null
  return (
    <span
      className="op-fila-vend"
      title={`El top vendió al menos ${fmtNum(v.pisoUnidades)} unidades EN TODA SU VIDA — acumulado desde que se publicó cada aviso, no por mes ni por año. Suma de los badges "+N vendidos" de ML.\n\nLa barra: ${pct}% del top (${v.itemsConDato} de ${v.itemsDelScan}) vendió 25 unidades o más alguna vez. ML no muestra badge bajo 25, así que el resto nunca despegó.`}
    >
      {/* el ≥ se queda: cada badge dice "al menos N", así que la suma es un piso.
          Ya no carga el peso de avisar "esto no es una tasa" —de eso se encargan
          el encabezado y la barra— pero sin él el número mentiría por exceso de
          precisión. */}
      <b><em>≥</em>{fmtPiso(v.pisoUnidades)}</b>
      {pct != null ? (
        <i className="op-vend-barra" aria-hidden="true">
          <i style={{ width: `${Math.max(3, pct)}%` }} className={pct < 50 ? 'flojo' : undefined} />
        </i>
      ) : null}
    </span>
  )
}

// "ACÁ YA VENDO YO". La mesa listaba los 45 nichos como si todos fueran
// territorio nuevo, pero en varios ya hay publicación propia. No es lo mismo
// evaluar un nicho a ciegas que uno del que tienes conversión, visitas y
// precio propio: ahí la decisión no es entrar, es reponer o ampliar surtido.
//
// Dos estados, porque tener publicación y vender no es lo mismo: bolsa llena y
// verde cuando hubo unidades en 30 días, bolsa apagada cuando el listing está
// pero no se mueve — ese segundo caso es el que más conviene ver, porque es un
// nicho donde ya apostaste y no está rindiendo.
function MioBadge({ mios }) {
  if (!mios?.publicaciones) return null
  const vende = mios.unidades30d > 0
  const plural = mios.publicaciones === 1 ? 'publicación' : 'publicaciones'
  return (
    <i
      className={`op-mio${vende ? ' vende' : ''}`}
      title={
        vende
          ? `Ya vendes acá: ${mios.publicaciones} ${plural} tuya(s), ${mios.unidades30d} unidad(es) en los últimos 30 días.`
          : `Tienes ${mios.publicaciones} ${plural} en este nicho, sin ventas en los últimos 30 días.`
      }
      aria-label={vende ? 'nicho propio con ventas' : 'nicho propio sin ventas recientes'}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
        <path d="M3.4 5.6h9.2l-.75 7.7a1.15 1.15 0 0 1-1.15 1.05H5.3a1.15 1.15 0 0 1-1.15-1.05z" fill="currentColor" />
        <path d="M5.9 5.6V4.4a2.1 2.1 0 0 1 4.2 0v1.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </i>
  )
}

// RECIÉN LLEGADO. Un nicho nuevo del radar cae en medio de 44 filas que ya
// estaban ahí ayer y se pierde. Se marca por una semana, que es más o menos lo
// que tarda en juntar su primera serie de scans y dejar de ser una promesa.
const DIAS_NUEVO = 7

function esNuevo(creadoEl) {
  if (!creadoEl) return false
  return (Date.now() - new Date(creadoEl).getTime()) / 86400e3 <= DIAS_NUEVO
}

function NuevoBadge({ creadoEl }) {
  if (!esNuevo(creadoEl)) return null
  const dias = Math.floor((Date.now() - new Date(creadoEl).getTime()) / 86400e3)
  return (
    <i
      className="op-nuevo"
      title={
        dias < 1
          ? 'El radar lo descubrió hoy. Todavía está midiendo: dale unos días de serie antes de decidir nada.'
          : `El radar lo descubrió hace ${dias} día${dias === 1 ? '' : 's'}.`
      }
    >
      nuevo
    </i>
  )
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

function FilaCompacta({ o, rank, abierta, onAlternar }) {
  const ven = chipVentana(o.ventana)
  const c = o.curvaAnual
  const max = c?.curva?.length ? Math.max(...c.curva) : 0
  const mesHoy = new Date().getMonth()
  return (
    <button
      type="button"
      className={`op-fila${abierta ? ' op-fila-abierta' : ''}`}
      onClick={onAlternar}
      aria-expanded={abierta}
    >
      <span className="op-fila-rank">{rank}</span>
      <span className="op-fila-kw">
        <MioBadge mios={o.mios} />
        {o.keyword}
        <NuevoBadge creadoEl={o.creadoEl} />
        {o.nivelBusqueda?.nivel === 'renombrar' ? <i className="op-fila-alerta" title="La gente escribe otra frase">keyword</i> : null}
      </span>
      {o.midiendo ? (
        <span
          className="op-fila-midiendo"
          title={`Recién descubierto: lleva ${o.scansConDemanda} de ${o.scansConDemanda + o.faltanScans} scans con demanda medida. No tiene score ni veredicto todavía, y no se van a inventar — el sistema lo escanea a diario hasta juntar la serie.`}
        >
          {o.scansConDemanda}/{o.scansConDemanda + o.faltanScans}
        </span>
      ) : (
        <span className={`op-fila-score s-${o.score >= 75 ? 'alto' : o.score >= 55 ? 'medio' : 'bajo'}`}>{o.score ?? '—'}</span>
      )}
      {/* ── GOOGLE: cuánta gente lo busca y cómo se reparte en el año ── */}
      <span className="op-fila-vol">
        {c?.busquedasMes ? `${fmtNum(c.busquedasMes)}/mes` : <em>sin medir</em>}
      </span>
      {max ? (
        <span
          className="op-fila-curva"
          title={`Forma del año según Google Trends (5 años). Pico ${c.nombreMesPico ?? '—'}, ${c.ratioPico}× sobre el promedio.`}
        >
          {c.curva.map((v, i) => (
            <i key={i} className={i === mesHoy ? 'hoy' : undefined} style={{ height: `${Math.max(8, Math.round((100 * v) / max))}%` }} />
          ))}
        </span>
      ) : (
        <span className="op-fila-curva" />
      )}
      {/* ── MERCADO LIBRE: qué pasó de verdad en el listado ── */}
      <Trayectoria v={o.vendidosHistoricos} />
      <span
        className="op-fila-full"
        title={
          o.pctFull != null
            ? `${Math.round(o.pctFull)}% del top vende por Full. Full es la puerta: en la cuenta propia son 105 visitas semanales dentro contra 2 fuera. Poco Full no es hueco libre — suele ser un nicho donde nadie logró vender lo suficiente para inmovilizar stock.`
            : 'sin medir'
        }
      >
        {o.pctFull != null ? `${Math.round(o.pctFull)}%` : '—'}
      </span>
      {/* ── EL CRUCE: ¿esa búsqueda de Google se convierte en venta acá? ── */}
      <Conversion c={o.conversion} />
      <span className="op-fila-ventana">
        {ven ? <em className={`chip-ventana v-${ven.clase}`}>{ven.texto}</em> : <em className="op-fila-plano">todo el año</em>}
      </span>
      {o.midiendo ? (
        <span className="op-fila-ver op-fila-faltan">
          faltan {o.faltanScans} {o.faltanScans === 1 ? 'scan' : 'scans'}
        </span>
      ) : (
        <span className={`op-fila-ver veredicto-${o.veredicto}`}>
          {o.veredicto === 'entrar' ? 'entrar' : 'condiciones'}
        </span>
      )}
      <span className="op-fila-flecha" aria-hidden="true">{abierta ? '▾' : '▸'}</span>
    </button>
  )
}

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
      className={`op-cotizacion op-cot-boton ${cot ? (cot.viable === false || cot.cierra === false ? 'mal' : 'bien') : 'pendiente'}`}
      title={
        cot?.costoPuestoClp
          ? `Te cuesta ${fmtPrecio(cot.costoPuestoClp)} por unidad ya puesto en Chile — clic para cambiarlo`
          : cot?.exwUsd
            ? `EXW histórico US$ ${cot.exwUsd}. Anota el costo puesto en Chile para calcular margen real — clic para escribirlo`
            : 'Anota lo que te cuesta cada unidad ya puesta en Chile (con flete e internación): con eso el sistema calcula el margen real'
      }
      onClick={(e) => {
        e.stopPropagation()
        setEditando(true)
      }}
    >
      {/* el importador retiró el flujo de EXW: el costo que lleva es el puesto
          en Chile, que es el que permite calcular margen sin estimar flete */}
      {!cot
        ? 'sin costo'
        : cot.costoPuestoClp == null
          ? `EXW US$ ${cot.exwUsd} · falta costo puesto`
          : cot.margenClp != null
            ? cot.margenClp > 0
              ? `✓ deja ${fmtPrecio(cot.margenClp)}/u (${Math.round(cot.margenPct)}%)`
              : `✗ pierde ${fmtPrecio(Math.abs(cot.margenClp))}/u a ese precio`
            : `✓ ${fmtPrecio(cot.costoPuestoClp)}/u puesto`}
    </button>
  )
}

function CartaOportunidad({ o, rank, onAbrir, mismaCompraQue, onRecargar }) {
  const flecha = o.tendenciaVentas ? FLECHA[o.tendenciaVentas] : null
  const nb = o.nivelBusqueda
  const nivel = nb?.nivel ? NIVELES[nb.nivel] : null
  const ven = chipVentana(o.ventana)
  const cot = o.cotizacion

  return (
    <article
      className={`op-carta${nb?.nivel === 'renombrar' || nb?.nivel === 'nulo' ? ' op-carta-tibia' : ''}`}
      onClick={() => onAbrir(o.nichoId)}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if (e.key === 'Enter') onAbrir(o.nichoId)
      }}
    >
      <div className="op-lateral">
        <span className="op-rank">#{rank}</span>
        {o.madurando ? (
          <span className="mini-madurando mini-madurando-carta" title="Midiendo entrabilidad: el veredicto firme llega al completar la serie">
            {o.scansConDemanda}/5
          </span>
        ) : o.score != null ? (
          <ScoreRing valor={o.score} size={44} grosor={4.5} />
        ) : null}
      </div>

      <div className="op-cuerpo">
        {/* fila 1: lo que decide si esto se mira o no */}
        <div className="op-encabezado">
          <h3 className="op-keyword">{o.keyword}</h3>
          {nivel ? (
            <span className={`chip-busqueda ${nivel.clase}`} title={nb.explicacion ?? ''}>
              {nivel.texto}
              {/* la posición a la vista: "búsqueda alta" no dice si es #1 o #9
                  de su lista, y esa diferencia es de volumen real */}
              {nb.posicion ? (
                <span className="chip-pos">
                  #{nb.posicion}/{nb.deCuantas} en “{nb.prefijo}”
                </span>
              ) : null}
            </span>
          ) : (
            <span className="chip-busqueda nb-medio" title="Todavía sin medir si la gente busca esta keyword">
              búsqueda sin medir
            </span>
          )}
          {ven ? (
            <span className={`chip-ventana v-${ven.clase}`} title={ven.ayuda}>
              {ven.icono ? `${ven.icono} ` : ''}
              {ven.texto}
            </span>
          ) : null}
          {o.tramites.map((t) => (
            <span key={t} className="op-tramite" title="Requiere trámite de importación">
              ⚠ {t}
            </span>
          ))}
        </div>

        {/* si la keyword está mal, eso manda sobre cualquier otra cosa */}
        {nb?.nivel === 'renombrar' && nb.keywordSugerida ? (
          <p className="op-aviso-kw">
            Esta búsqueda no existe en Mercado Libre. La gente escribe <strong>{nb.keywordSugerida}</strong> —
            cotizar sobre esta keyword es cotizar sobre un listado que nadie abre.
          </p>
        ) : null}

        {o.titular ? <p className="op-titular">{o.titular}</p> : null}

        {/* fila 2: los números de la compra */}
        <div className="op-hechos">
          <Hecho etiqueta="vender a">{o.precioVentaClp ? fmtPrecio(o.precioVentaClp) : null}</Hecho>
          <Hecho etiqueta="EXW máx">{o.exwMaximoUsd != null ? `US$ ${o.exwMaximoUsd}` : null}</Hecho>
          {/* LO CONTADO, no lo derivado: reseñas nuevas es un entero exacto que
              entrega ML. La estimación de ventas/día (delta × factor 25) va
              plegada al pie con su aritmética, porque el factor está sin
              calibrar y produjo saltos de 5x en 41 mediciones. */}
          <Hecho etiqueta="se mueve">
            {o.resenasNuevas != null && o.ventanaDias ? (
              <span
                title={`${o.resenasNuevas} reseñas nuevas en ${o.ventanaDias} días, contadas sobre ${o.canasta} productos del top${
                  o.saltosFiltrados ? ` · ${o.saltosFiltrados} saltos de catálogo descartados` : ''
                }`}
              >
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
              <span
                className="op-sucio"
                title={`Se midieron ${Math.round(o.saltoSospechoso.valorCrudo)} ventas/día contra ${Math.round(o.saltoSospechoso.contra)} del scan anterior (×${o.saltoSospechoso.salto}). ${o.saltoSospechoso.motivo}`}
              >
                ⚠ salto ×{o.saltoSospechoso.salto} no creíble
              </span>
            </Hecho>
          ) : null}
          {o.mios?.publicaciones ? (
            <Hecho etiqueta="ya vendo acá">
              {o.mios.publicaciones} public.
              {o.mios.unidades30d > 0 ? ` · ${o.mios.unidades30d} u. en 30 días` : ' · sin ventas en 30 días'}
            </Hecho>
          ) : null}
          {/* cuánto le queda a la competencia. Un pct alto no es un riesgo: es
              un nicho desabastecido, o sea una ventana para quien trae stock */}
          {o.profundidadStock?.itemsPorAgotarse ? (
            <Hecho etiqueta="por agotarse">
              <span title={`${o.profundidadStock.itemsPorAgotarse} de ${o.profundidadStock.itemsDelScan} publicaciones del top muestran "últimas unidades". ML solo pone ese aviso cuando quedan 5 o menos, así que el resto tiene más de 5.\n\nEntre las avisadas quedan ${o.profundidadStock.unidadesVisibles} unidades. Eso NO es el stock del nicho: de las demás no se sabe.`}>
                {o.profundidadStock.pctEnUltimas}% del top
                {o.profundidadStock.pctEnUltimas >= 40 ? ' · desabastecido' : ''}
              </span>
            </Hecho>
          ) : null}
          {o.pctCrossBorder ? (
            <Hecho etiqueta="importan directo">
              <span title={`${Math.round(o.pctCrossBorder)}% del top despacha desde el extranjero${o.origenesCrossBorder ? ` (${Object.entries(o.origenesCrossBorder).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}. Doble filo: prueba de que el producto se importa bien, y a la vez rival con tu misma estructura de costo.`}>
                {Math.round(o.pctCrossBorder)}%
                {o.origenesCrossBorder ? ` · ${Object.keys(o.origenesCrossBorder).join('/')}` : ''}
              </span>
            </Hecho>
          ) : null}
          <Hecho etiqueta="mediana">{o.mediana ? fmtPrecio(o.mediana) : null}</Hecho>
          <Hecho etiqueta="Full">{o.pctFull != null ? `${Math.round(o.pctFull)}%` : null}</Hecho>
          <Hecho etiqueta="sellers">{o.sellersUnicos != null ? fmtNum(o.sellersUnicos) : null}</Hecho>
          {/* acá sí va el número entero y dicho con todas sus letras: es donde
              el importador se detiene a decidir, no la vista de barrido */}
          {o.vendidosHistoricos?.pisoUnidades ? (
            <Hecho etiqueta="el top vendió">
              <span title={`Suma de los badges "+N vendidos" de ML en el top. ML redondea a baldes (25, 50, 100, 500, 1.000...) y el badge dice "al menos", así que la suma es un piso, no una estimación. Cada badge cuenta desde que ESE aviso se publicó, sea hace tres meses o hace cinco años: por eso mezcla edades y no se puede convertir en ritmo.`}>
                al menos {fmtNum(o.vendidosHistoricos.pisoUnidades)} en toda su vida
                {o.vendidosHistoricos.pctCobertura != null ? (
                  <i
                    className="op-vend-despegue"
                    title={`El balde más chico de ML es 25: por debajo no muestra badge. Así que este ${o.vendidosHistoricos.pctCobertura}% (${o.vendidosHistoricos.itemsConDato} de ${o.vendidosHistoricos.itemsDelScan}) es la parte del top que vendió 25 unidades o más alguna vez. El resto nunca despegó.`}
                  >
                    {' · '}{o.vendidosHistoricos.pctCobertura}% del top despegó
                  </i>
                ) : null}
              </span>
            </Hecho>
          ) : null}
        </div>

        <CurvaAno curva={o.curvaAnual} />

        {/* la estimación existe pero no manda: plegada y con su aritmética a la
            vista, para que nadie la confunda con una medición */}
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

        {/* fila 3: en qué estado está la decisión */}
        <div className="op-estado">
          <span className={`veredicto veredicto-${o.veredicto}`}>{o.veredicto.replace(/_/g, ' ')}</span>
          {o.confirmacion ? (
            <span
              className={`op-confianza ${o.confirmacion === 'confirmado' ? 'op-confianza-alta' : 'op-confianza-media'}`}
              title={
                o.confirmacion === 'confirmado'
                  ? `Demanda sostenida en ${o.scansConDemanda} scans`
                  : `Solo ${o.scansConDemanda} scan(s) con demanda${o.madurando ? ' · se escanea a diario solo' : ''}`
              }
            >
              {o.confirmacion === 'confirmado' ? `✓ confirmado · ${o.scansConDemanda} scans` : `preliminar · ${o.scansConDemanda} scans`}
            </span>
          ) : null}
          <Cotizacion o={o} onRecargar={onRecargar} />
          <select
            className="etapa-select"
            value={o.etapaCompra ?? 'evaluando'}
            title={o.notaEtapa ?? 'Etapa del embudo de compra'}
            onClick={(e) => e.stopPropagation()}
            onChange={async (e) => {
              e.stopPropagation()
              await api.ajustarNicho(o.nichoId, { etapaCompra: e.target.value })
              onRecargar()
            }}
          >
            {ETAPAS.map((et) => (
              <option key={et} value={et}>
                {et.replace(/-/g, ' ')}
              </option>
            ))}
          </select>
          {o.listingListo ? <span className="op-listing">listing ✓</span> : null}
          {mismaCompraQue ? (
            <span className="op-listing" title="Mismo producto de fábrica: un solo pedido cubre ambos nichos">
              🔁 misma compra que “{mismaCompraQue}”
            </span>
          ) : null}
          {Number.isFinite(o.shareJugadaPct) && o.shareJugadaPct < 50 ? (
            <span
              className="op-confianza op-confianza-media"
              title={`El top mezcla familias; la jugada recomendada concentra el ${o.shareJugadaPct}% de las reseñas${o.keywordJugada ? ` — se aísla con "${o.keywordJugada}"` : ''}`}
            >
              jugada {o.shareJugadaPct}% del top
            </span>
          ) : null}
        </div>

        {o.condiciones ? <p className="op-condicion">condición: {o.condiciones}</p> : null}

        <div className="op-pie">
          {o.primeraCompra ? (
            <span>
              1ª compra: {o.primeraCompra}
              {o.inversionEstimadaUsd != null ? ` (~US$ ${fmtNum(o.inversionEstimadaUsd)})` : ''}
            </span>
          ) : null}
          {o.fechaScan ? <span>scan {fmtFecha(o.fechaScan)}</span> : null}
        </div>
      </div>
    </article>
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

// GRUPOS POR COMPORTAMIENTO DE TEMPORADA.
//
// Una lista única de 50 nichos es scroll infinito: obliga a leer todo para
// encontrar lo que se puede comprar hoy. Agrupando por CUÁNDO se compra, la
// pregunta se contesta sola — arriba lo que tiene la ventana abierta, después
// lo que se puede traer cualquier día, y al final lo que hay que esperar.
//
// El orden de los grupos ES la prioridad de compra.
// LA MESA SE ORDENA POR CONSTANCIA, NO POR LA VENTANA.
//
// Antes los grupos eran "comprar ahora / se venden todo el año / su ventana se
// acerca / temporada lejana" — o sea que mandaba CUÁNDO se compra. Eso ponía un
// árbol de navidad arriba de un producto que vende los 12 meses solo porque a
// uno se le abría la ventana.
//
// El importador lo dio vuelta: quiere trabajar nichos de todo el año AUNQUE
// ESTÉN SATURADOS. La razón es de caja, no de gusto: un estacional deja el
// capital dormido 10 meses y su stock sobrante paga bodega Full todo ese
// tiempo; un producto plano lo rota cuatro o cinco veces al año y mantiene la
// cuenta vendiendo siempre, que es lo que sostiene la posición en el buscador.
//
// La ventana no se pierde: sigue ordenando DENTRO de los estacionales y sigue
// mostrándose en cada fila.
const esPlano = (o) => ['todo-el-año', 'alza-suave'].includes(o.curvaAnual?.clasificacion)

const GRUPOS_OP = [
  {
    id: 'todo-el-ano',
    titulo: 'Se venden todo el año',
    sub: 'la base del negocio: rotan el capital varias veces al año y mantienen la cuenta vendiendo siempre',
    abierto: true,
    test: esPlano,
  },
  {
    id: 'ahora',
    titulo: 'Estacionales con la ventana abierta',
    sub: 'apuestas que hay que decidir hoy: pidiendo ahora el stock llega para el pico',
    abierto: true,
    test: (o) => !esPlano(o) && ['ahora', 'ultimo-mes'].includes(o.ventana?.estado),
  },
  {
    id: 'pronto',
    titulo: 'Estacionales que se acercan',
    sub: 'todavía no toca pedir, pero falta poco',
    abierto: false,
    test: (o) => !esPlano(o) && o.ventana?.estado === 'pronto',
  },
  {
    id: 'espera',
    titulo: 'Estacionales lejanos',
    sub: 'el pico está a varios meses: no hay nada que hacer hoy',
    abierto: false,
    test: (o) => !esPlano(o),
  },
]

function GrupoOportunidades({ grupo, filas, children }) {
  const [abierto, setAbierto] = useState(grupo.abierto)
  if (!filas.length) return null
  return (
    <section className="op-grupo">
      <button type="button" className="op-grupo-cab" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
        <span className={`op-grupo-flecha${abierto ? ' abierto' : ''}`} aria-hidden="true">▸</span>
        <h3>{grupo.titulo}</h3>
        <span className="op-grupo-cuenta">{filas.length}</span>
        <span className="op-grupo-sub">{grupo.sub}</span>
      </button>
      {abierto ? (
        <div className="op-lista">
          {/* LAS DOS FUENTES, LADO A LADO Y ROTULADAS.
              Google dice cuánta gente lo busca y en qué mes del año; ML dice
              qué pasó de verdad en el listado. Antes las columnas venían
              intercaladas (búsqueda · vendidos · curva) y no se leía de dónde
              salía cada número. Ahora cada fuente es un bloque y el de ML va
              sombreado para distinguirse de un vistazo.
              El encabezado va por grupo y no una sola vez arriba porque los
              grupos se colapsan: uno que se fue del viewport no explica nada. */}
          <div className="op-fila op-fila-bandas" aria-hidden="true">
            <span /><span /><span />
            <span className="op-banda op-banda-google">Google</span>
            <span className="op-banda op-banda-ml">Mercado Libre</span>
            <span className="op-banda op-banda-cruce">cruce</span>
            <span /><span /><span />
          </div>
          <div className="op-fila op-fila-cab" aria-hidden="true">
            <span /><span>nicho</span><span>score</span>
            <span>búsq/mes</span><span>el año</span>
            <span className="op-fila-vend" title="Unidades que el top acumula desde que se publicó cada aviso. No es por mes ni por año.">vendido</span>
            <span>full</span>
            <span title="Ventas en ML por búsqueda en Google, contra lo normal de su tramo de precio">convierte</span>
            <span>ventana</span><span>veredicto</span><span />
          </div>
          {children}
        </div>
      ) : null}
    </section>
  )
}

const FILTROS = [
  ['comprables', 'Comprables ahora', (o) => ['ahora', 'ultimo-mes', 'pronto', 'sin-temporada'].includes(o.ventana?.estado ?? 'sin-temporada')],
  ['buscados', 'Solo búsqueda alta', (o) => o.nivelBusqueda?.nivel === 'alto'],
  ['confirmados', 'Confirmados', (o) => o.confirmacion === 'confirmado'],
  ['cotizados', 'Ya cotizados', (o) => Boolean(o.cotizacion)],
  ['arreglar', 'Keyword por arreglar', (o) => o.nivelBusqueda?.nivel === 'renombrar'],
]

export function Oportunidades({ onAbrirNicho, alCambiarNichos }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [activos, setActivos] = useState([])
  // una sola fila abierta a la vez: el detalle es para decidir, no para comparar
  const [expandido, setExpandido] = useState(null)
  const [busca, setBusca] = useState('')

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

  if (error) return <main><p className="error-bloque">Error: {error}</p></main>
  if (!datos) return <main><Cargando texto="Cargando oportunidades…" /></main>

  const todas = [...datos.oportunidades].sort(compararOportunidades)
  const filtrosActivos = FILTROS.filter(([id]) => activos.includes(id))
  const q = busca.trim().toLowerCase()
  const visibles = todas
    .filter((o) => filtrosActivos.every(([, , fn]) => fn(o)))
    .filter((o) => !q || o.keyword.toLowerCase().includes(q) || (o.titular ?? '').toLowerCase().includes(q))

  const cuenta = (fn) => todas.filter(fn).length
  const porArreglar = cuenta((o) => o.nivelBusqueda?.nivel === 'renombrar')
  const sinMedir = cuenta((o) => !o.nivelBusqueda?.nivel)

  return (
    <main>
      <div className="reporte-encabezado">
        <div>
          <h2>Oportunidades</h2>
          <p className="reporte-fecha">
            Ordenadas por lo que decide la compra: primero si <strong>la gente busca</strong> esa keyword,
            después <strong>cuándo hay que pedir</strong>, y al final el score.
          </p>
        </div>
      </div>

      <div className="op-resumen">
        <span><b>{cuenta((o) => o.nivelBusqueda?.nivel === 'alto')}</b> con búsqueda alta</span>
        <span><b>{cuenta((o) => ['ahora', 'ultimo-mes'].includes(o.ventana?.estado))}</b> con ventana abierta</span>
        <span><b>{cuenta((o) => o.confirmacion === 'confirmado')}</b> confirmados</span>
        <span><b>{cuenta((o) => Boolean(o.cotizacion))}</b> cotizados</span>
        {porArreglar ? <span className="op-resumen-aviso"><b>{porArreglar}</b> con la keyword por arreglar</span> : null}
        {sinMedir ? <span className="op-resumen-aviso"><b>{sinMedir}</b> sin medir la búsqueda</span> : null}
      </div>

      <div className="chips op-filtros">
        <div className="op-buscador">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nicho…"
            aria-label="Buscar entre las oportunidades"
          />
          {busca ? (
            <button type="button" className="op-buscador-x" onClick={() => setBusca('')} aria-label="Limpiar búsqueda">×</button>
          ) : null}
        </div>
        {FILTROS.map(([id, etiqueta, fn]) => (
          <button
            key={id}
            className={activos.includes(id) ? 'chip activo' : 'chip'}
            aria-pressed={activos.includes(id)}
            onClick={() => setActivos((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))}
          >
            {etiqueta} <span className="op-filtro-n">{cuenta(fn)}</span>
          </button>
        ))}
        {activos.length ? (
          <button className="enlace-boton" onClick={() => setActivos([])}>
            limpiar
          </button>
        ) : null}
      </div>

      {!todas.length ? (
        <p className="vacio">
          Todavía no hay nichos con veredicto de entrada. El radar y los análisis van llenando este panel solos.
        </p>
      ) : !visibles.length ? (
        <p className="vacio">Ninguna oportunidad pasa los filtros.</p>
      ) : (
        (() => {
          const dueno = new Map()
          const porKeyword = new Map(todas.map((o) => [o.keyword, o]))
          const sinLider = visibles.filter((o) => !o.familiaLider)
          let rank = 0
          const carta = (o) => {
            rank++
            let mismaCompraQue = null
            if (o.productoClave) {
              if (dueno.has(o.productoClave)) mismaCompraQue = dueno.get(o.productoClave)
              else dueno.set(o.productoClave, o.keyword)
            }
            const abierta = expandido === o.nichoId
            return (
              <div key={o.nichoId} className="op-item">
                <FilaCompacta
                  o={o}
                  rank={rank}
                  abierta={abierta}
                  onAlternar={() => setExpandido(abierta ? null : o.nichoId)}
                />
                {abierta ? (
                  <>
                    {/* sin análisis no hay tarjeta que mostrar: la carta vive de
                        recomendación, precios y riesgos que todavía no existen */}
                    {o.midiendo ? (
                      <div className="op-midiendo-carta">
                        <strong>Midiendo entrabilidad · {o.scansConDemanda} de {o.scansConDemanda + o.faltanScans} scans</strong>
                        <p>
                          El radar lo descubrió recién y el sistema lo escanea a diario. No hay score ni
                          veredicto porque todavía no hay serie que los sostenga, y no se van a estimar.
                          {o.curvaAnual?.busquedasMes
                            ? ` Lo que sí está medido: ${fmtNum(o.curvaAnual.busquedasMes)} búsquedas al mes en Chile.`
                            : ' Falta medirle el volumen de búsqueda.'}
                        </p>
                        <button type="button" className="boton-secundario" onClick={(e) => { e.stopPropagation(); onAbrirNicho(o.nichoId) }}>
                          Ver el nicho
                        </button>
                      </div>
                    ) : (
                      <CartaOportunidad o={o} rank={rank} onAbrir={onAbrirNicho} mismaCompraQue={mismaCompraQue} onRecargar={cargar} />
                    )}
                    {o.familiaMiembros?.length ? (
                      <FamiliaColapsada miembros={o.familiaMiembros} porKeyword={porKeyword} lider={o} onAbrir={onAbrirNicho} onRecargar={cargar} />
                    ) : null}
                  </>
                ) : null}
              </div>
            )
          }
          const usados = new Set()
          const secciones = GRUPOS_OP.map((g) => {
            const filas = sinLider.filter((o) => !usados.has(o.nichoId) && g.test(o))
            filas.forEach((o) => usados.add(o.nichoId))
            return { grupo: g, filas }
          })
          const resto = sinLider.filter((o) => !usados.has(o.nichoId))
          return (
            <>
              {secciones.map(({ grupo, filas }) => (
                <GrupoOportunidades key={grupo.id} grupo={grupo} filas={filas}>
                  {filas.map(carta)}
                </GrupoOportunidades>
              ))}
              {resto.length ? (
                <GrupoOportunidades
                  grupo={{ id: 'resto', titulo: 'Sin temporada medida', sub: 'todavía sin curva de búsqueda: el cron la mide en los próximos días', abierto: false }}
                  filas={resto}
                >
                  {resto.map(carta)}
                </GrupoOportunidades>
              ) : null}
            </>
          )
        })()
      )}

      <Criterios />

      <p className="nota">
        "EXW máx" es lo más que puedes pagar en China (precio ex-fábrica) para que el margen cierre al precio
        sugerido. La ventana sale del pico de temporada menos el lead time de importación (~2 meses desde que
        pagas hasta tener stock vendible en Full). Abre una carta para ver la familia de búsqueda, el análisis
        completo y el simulador.
      </p>
    </main>
  )
}
