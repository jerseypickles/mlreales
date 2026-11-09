import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, CircleDashed, PackageX, RefreshCw, ShoppingBag, Target, XCircle } from 'lucide-react'
import { api } from '../api.js'
import { Cargando, Miniatura } from './ui.jsx'
import { fmtFecha, fmtNum, fmtPrecio } from '../lib/formato.js'

// LO RECOMENDADO CONTRA LO VENDIDO. El importador (9-nov-2026): "¿el learning
// machine comprendió que ciertos productos que dio están vendiendo?". Una
// tarjeta por producto traído: qué dijo el sistema al decidir la compra y qué
// pasó de verdad en los días con stock. La nota del veredicto sale de hechos
// (¿se vende y deja plata?) y aparece recién con muestra. La comparación con
// una publicación promedio del nicho va aparte: es la vara con que el sistema
// aprende cuánto vende quien recién entra, no una meta.

const decimal = (v, d = 1) => (Number.isFinite(v) ? v.toLocaleString('es-CL', { maximumFractionDigits: d }) : '—')
const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' }) : '—')
const VEREDICTO = { entrar: ['Entrar', 'bien'], entrar_con_condiciones: ['Entrar con condiciones', 'aviso'], no_entrar: ['No entrar', 'mal'] }
const LECTURA = {
  'sobre-el-promedio': 'Vende más que una publicación promedio del nicho',
  'cerca-del-promedio': 'Vende cerca de una publicación promedio del nicho',
  'bajo-el-promedio': 'Vende menos que una publicación promedio del nicho',
}

// Dos barras con la misma escala, en unidades por día: una publicación promedio
// del nicho y lo que vende este producto.
function Barras({ promedio, real }) {
  const tope = Math.max(promedio ?? 0, real ?? 0, 0.01)
  const fila = (etiqueta, valor, clase) => (
    <div className="acr-barra-fila">
      <span>{etiqueta}</span>
      <div className="acr-barra" role="img" aria-label={`${etiqueta}: ${decimal(valor, 2)} unidades por día`}><i className={clase} style={{ width: `${Math.max(2, ((valor ?? 0) / tope) * 100)}%` }} /></div>
      <strong>{decimal(valor, 2)}<small> /día</small></strong>
    </div>
  )
  return <div className="acr-barras">{fila('Promedio', promedio, 'acr-esperado')}{fila('Tú', real, 'acr-real')}</div>
}

// Unidades por día con stock: rectángulos, como el resto de la pestaña.
function Serie({ serie, titulo }) {
  if (!serie?.length) return <p className="acr-sin-serie">Todavía sin días con stock.</p>
  const max = Math.max(1, ...serie.map((d) => d.unidades))
  const ancho = 100 / serie.length
  return (
    <svg className="acr-serie" viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label={`Unidades por día con stock de ${titulo}`}>
      {serie.map((d, i) => {
        const alto = d.unidades ? Math.max(2, (d.unidades / max) * 30) : 1
        return <rect key={d.dia} x={i * ancho + ancho * 0.15} y={34 - alto} width={ancho * 0.7} height={alto} rx="0.6" className={d.unidades ? 'acr-dia' : 'acr-dia-cero'}><title>{`${fecha(`${d.dia}T12:00:00Z`)}: ${d.unidades} u`}</title></rect>
      })}
    </svg>
  )
}

function Nota({ g }) {
  if (g.estado !== 'medido') return <span className="apr-chip"><CircleDashed size={13} aria-hidden="true" />Madurando · {g.real.diasConStock} de 14 días con stock</span>
  if (g.acierto === true) return <span className="apr-chip apr-chip-bien"><CheckCircle2 size={13} aria-hidden="true" />Coincide con el veredicto</span>
  if (g.acierto === false) return <span className="apr-chip apr-chip-aviso"><XCircle size={13} aria-hidden="true" />No coincide con el veredicto</span>
  return <span className="apr-chip" title="El primer análisis del nicho es posterior a la compra: no cuenta como predicción"><Target size={13} aria-hidden="true" />Medido, sin nota</span>
}

function Tarjeta({ g }) {
  const principal = g.productos[0]
  const v = VEREDICTO[g.decision?.veredicto]
  const c = g.comparacion
  const unidades = c.unidadesRecomendadas ? (c.unidadesRecomendadas.desde === c.unidadesRecomendadas.hasta ? `${c.unidadesRecomendadas.desde}` : `${c.unidadesRecomendadas.desde}-${c.unidadesRecomendadas.hasta}`) : null
  return (
    <article className="acr-tarjeta">
      <div className="acr-cabeza">
        {principal?.imagen ? <Miniatura src={principal.imagen} lado={64} /> : <span className="apr-foto-vacia acr-foto" aria-hidden="true"><ShoppingBag size={22} /></span>}
        <div className="acr-titulo">
          <h4>{principal?.titulo ?? g.keyword}</h4>
          <small>Nicho «{g.keyword}»{g.gamaNombre ? ` · gama ${g.gamaNombre.toLowerCase()}` : ''}{g.productos.length > 1 ? ` · ${g.productos.length} publicaciones` : ''}</small>
        </div>
      </div>

      <div className="acr-chips">
        {v ? <span className={`apr-chip apr-chip-${v[1]}`} title={g.decision.titular ?? ''}>Dijo: {v[0]} · {fecha(g.decision.fecha)}</span> : <span className="apr-chip">Sin análisis del nicho</span>}
        <Nota g={g} />
        {!g.real.conStockHoy && <span className="apr-chip apr-chip-mal"><PackageX size={13} aria-hidden="true" />Sin stock hoy</span>}
      </div>

      <dl className="acr-cifras">
        <div><dt>Vendidas con stock</dt><dd>{fmtNum(g.real.unidades)}<small> en {g.real.diasConStock} d</small></dd></div>
        <div><dt>Ritmo</dt><dd>{decimal(g.real.ventaSemana)}<small> /semana</small></dd></div>
        <div><dt>Dejó antes de publicidad</dt><dd>{g.real.dejo != null ? fmtPrecio(g.real.dejo) : '—'}</dd></div>
        <div><dt>Cada 100 visitas</dt><dd>{decimal(g.real.conversionPct)}</dd></div>
        <div><dt>Precio real</dt><dd>{fmtPrecio(c.precioReal)}</dd></div>
        <div><dt>Recomendado</dt><dd>{fmtPrecio(c.precioRecomendado)}</dd></div>
      </dl>

      <Serie serie={g.real.serie} titulo={principal?.titulo ?? g.keyword} />

      {g.referencia?.ventaDia != null && (
        <div className="acr-vara">
          <Barras promedio={g.referencia.ventaDia} real={g.real.ventaDia} />
          {LECTURA[g.lectura] && <p className="acr-lectura">{LECTURA[g.lectura]}{Number.isFinite(g.ratio) ? ` · ${decimal(g.ratio, 2)}×` : ''}</p>}
        </div>
      )}

      {!c.comparable && (
        <p className="acr-aviso"><AlertTriangle size={14} aria-hidden="true" />
          <span>
            {c.mismaGama === false ? 'Se vende en otra gama de precio que la recomendada. ' : ''}
            {c.mismasUnidades === false ? `Se recomendó un pack de ${unidades} y se publicó uno de ${c.unidadesPropias}. ` : ''}
            Precio y costo no son comparables directo.
          </span>
        </p>
      )}
      {!!g.falta.length && <p className="acr-falta">Falta: {g.falta.join(' · ')}</p>}
    </article>
  )
}

// EL PUNTAJE ALTERNO, EN SOMBRA: el mismo puntaje de la mesa, pero con la
// demanda tomada sobre todo de la venta medida en Mercado Libre. No cambia nada
// de lo que se ve en Oportunidades: acá se compara contra las ventas reales.
const ESTADO_PUNTAJE = {
  'pocos-casos': 'Todavía pocos productos medidos: no hay ganador',
  'gana-alterno': 'El alterno ordena mejor lo que vendiste',
  'gana-actual': 'El puntaje actual ordena mejor lo que vendiste',
  empate: 'Los dos ordenan parecido',
}

function Movimiento({ m, sube }) {
  const Icono = sube ? ArrowUp : ArrowDown
  return (
    <li className="acr-mov">
      {m.imagen ? <Miniatura src={m.imagen} lado={44} /> : <span className="apr-foto-vacia acr-mov-foto" aria-hidden="true"><ShoppingBag size={16} /></span>}
      <div className="acr-mov-cuerpo">
        <strong>{m.keyword}</strong>
        <div className="acr-mov-barras" role="img" aria-label={`Puntaje actual ${m.actual}, alterno ${m.alterno}`}>
          <i className="acr-esperado" style={{ width: `${m.actual}%` }} /><i className="acr-real" style={{ width: `${m.alterno}%` }} />
        </div>
        <small>{m.actual} → {m.alterno} puntos · {decimal(m.reseniasDia)} reseñas nuevas al día</small>
      </div>
      <span className={`apr-chip apr-chip-${sube ? 'bien' : 'aviso'}`} title="Puesto al ordenar los nichos solo por puntaje (la mesa además ordena por urgencia)"><Icono size={13} aria-hidden="true" />puesto {m.lugarActual} → {m.lugarAlterno}</span>
    </li>
  )
}

function PuntajeAlterno({ p }) {
  if (!p?.mesa) return null
  const v = p.contraVentas, m = p.mesa
  return (
    <section className="apr-seccion acr">
      <div className="apr-seccion-cabeza">
        <h3>Puntaje alterno, en prueba</h3>
        <p>El mismo puntaje de Oportunidades con un solo cambio: la demanda sale sobre todo de la venta medida en Mercado Libre y no de las búsquedas de Google. No toca la mesa; se compara contra lo que vendes para decidir después con datos.</p>
      </div>
      <div className="acr-resumen">
        <div className="acr-dato"><span>Contra tus ventas</span><strong>{v.casos}<small> de {v.minimoCasos} productos</small></strong><small>{ESTADO_PUNTAJE[v.estado]}</small></div>
        <div className="acr-dato"><span>Orden del puntaje actual</span><strong>{decimal(v.ordenActual, 2)}</strong><small>1 = ordena perfecto lo que vendiste</small></div>
        <div className="acr-dato"><span>Orden del alterno</span><strong>{decimal(v.ordenAlterno, 2)}</strong><small>misma medida, mismos productos</small></div>
        <div className="acr-dato"><span>Separa más los nichos</span><strong>{m.rangoAlterno[0]}–{m.rangoAlterno[1]}</strong><small>el actual va de {m.rangoActual[0]} a {m.rangoActual[1]} · {m.nichos} nichos</small></div>
      </div>
      <div className="acr-movs">
        <div><h4>Subirían por puntaje</h4><ul>{m.suben.map((x) => <Movimiento key={x.keyword} m={x} sube />)}</ul></div>
        <div><h4>Bajarían por puntaje</h4><ul>{m.bajan.map((x) => <Movimiento key={x.keyword} m={x} />)}</ul></div>
      </div>
      <p className="apr-leyenda"><span className="acr-leyenda acr-esperado" /> puntaje actual <span className="acr-leyenda acr-real" /> alterno · {m.sinVentaMedida} nichos quedan fuera porque aún no tienen venta medida.</p>
    </section>
  )
}

export function RecomendadoVsVendido() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(false)
  const cargar = useCallback((fresca = false) => {
    setCargando(true)
    api.recomendadoVsVendido(fresca).then((d) => { setDatos(d); setError(null) }).catch((e) => setError(e.message)).finally(() => setCargando(false))
  }, [])
  useEffect(() => { cargar() }, [cargar])
  if (error && !datos) return <p className="error-bloque" role="alert">No se pudo leer el cruce: {error}</p>
  if (!datos) return <Cargando texto="Cruzando lo recomendado con lo vendido…" />
  const r = datos.resumen
  if (!datos.grupos.length) return <p className="apr-vacio">Todavía no hay productos propios vinculados a un nicho.</p>
  return (
    <section className="apr-seccion acr">
      <div className="apr-seccion-cabeza acr-cabecera">
        <div>
          <h3>Lo que recomendó contra lo que se vende</h3>
          <p>Por cada producto que trajiste: el veredicto que tenías a la vista al decidir y lo que pasó en los días con stock. Con {r.minimoDias} días con stock se le pone nota al veredicto: coincide si el producto se vende (al menos {r.ventaMinimaSemana ?? 1} por semana) y deja plata. Corre en sombra: mide, no decide.</p>
        </div>
        <div className="apr-hero-accion">
          <button type="button" className="boton-secundario apr-refrescar" onClick={() => cargar(true)} disabled={cargando}>
            <RefreshCw size={15} aria-hidden="true" className={cargando ? 'apr-girando' : ''} />{cargando ? 'Recalculando…' : 'Recalcular'}
          </button>
          <small>Calculado {fmtFecha(datos.calculadoEl)}</small>
        </div>
      </div>
      {error ? <p className="error-bloque" role="alert">No se pudo recalcular: {error}. Se muestra el último cálculo.</p> : null}
      <div className="acr-resumen">
        <div className="acr-dato"><span>Productos seguidos</span><strong>{r.grupos}</strong><small>{r.medidos} medidos · {r.madurando} madurando</small></div>
        <div className="acr-dato"><span>Veredictos que coinciden</span><strong>{r.conNota ? `${r.aciertos} de ${r.conNota}` : '—'}</strong><small>{r.conNota ? `${r.tasaAcierto}% con lo que pasó` : `nota desde ${r.minimoDias} días con stock`}</small></div>
        <div className="acr-dato"><span>Un recién llegado vende</span><strong>{Number.isFinite(r.factorEntrante) ? `${decimal(r.factorEntrante, 2)}×` : '—'}</strong><small>una publicación promedio de su nicho{r.casosFactor ? ` (mediana de ${r.casosFactor})` : ''}</small></div>
        <div className="acr-dato"><span>Muestra</span><strong>{r.medidos}<small> de {r.minimoCasos}</small></strong><small>{r.estado === 'con-muestra' ? 'suficiente para leerla' : 'todavía pocos casos: es una pista'}</small></div>
      </div>
      <div className="acr-grilla">{datos.grupos.map((g) => <Tarjeta key={g.clave} g={g} />)}</div>
      <p className="apr-leyenda">«Promedio» es lo que vende al día una publicación promedio del nicho: sus reseñas nuevas por día, por las ventas por reseña medidas en tu cuenta, repartidas entre todas sus publicaciones. Incluye a los líderes, así que no es una meta: sirve para aprender cuánto vende quien recién entra.</p>
      <PuntajeAlterno p={datos.puntaje} />
    </section>
  )
}
