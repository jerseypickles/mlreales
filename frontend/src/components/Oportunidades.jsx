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
          <Hecho etiqueta="mediana">{o.mediana ? fmtPrecio(o.mediana) : null}</Hecho>
          <Hecho etiqueta="Full">{o.pctFull != null ? `${Math.round(o.pctFull)}%` : null}</Hecho>
          <Hecho etiqueta="sellers">{o.sellersUnicos != null ? fmtNum(o.sellersUnicos) : null}</Hecho>
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
  const visibles = todas.filter((o) => filtrosActivos.every(([, , fn]) => fn(o)))

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
        <div className="op-lista">
          {(() => {
            const dueno = new Map()
            const porKeyword = new Map(todas.map((o) => [o.keyword, o]))
            let rank = 0
            return visibles.map((o) => {
              if (o.familiaLider) return null // colapsado bajo su líder
              rank++
              let mismaCompraQue = null
              if (o.productoClave) {
                if (dueno.has(o.productoClave)) mismaCompraQue = dueno.get(o.productoClave)
                else dueno.set(o.productoClave, o.keyword)
              }
              return (
                <div key={o.nichoId}>
                  <CartaOportunidad
                    o={o}
                    rank={rank}
                    onAbrir={onAbrirNicho}
                    mismaCompraQue={mismaCompraQue}
                    onRecargar={cargar}
                  />
                  {o.familiaMiembros?.length ? (
                    <FamiliaColapsada
                      miembros={o.familiaMiembros}
                      porKeyword={porKeyword}
                      lider={o}
                      onAbrir={onAbrirNicho}
                      onRecargar={cargar}
                    />
                  ) : null}
                </div>
              )
            })
          })()}
        </div>
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
