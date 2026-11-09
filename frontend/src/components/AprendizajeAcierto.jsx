import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, PackageX, ShoppingBag, Target, XCircle } from 'lucide-react'
import { api } from '../api.js'
import { Cargando, Miniatura } from './ui.jsx'
import { fmtNum, fmtPrecio } from '../lib/formato.js'

// LO RECOMENDADO CONTRA LO VENDIDO. El importador (9-nov-2026): "¿el learning
// machine comprendió que ciertos productos que dio están vendiendo?". Una
// tarjeta por producto traído: qué dijo el sistema al decidir la compra, cuánto
// debía vender una publicación típica de su gama y cuánto vende de verdad en
// los días con stock. La nota aparece recién con muestra.

const decimal = (v, d = 1) => (Number.isFinite(v) ? v.toLocaleString('es-CL', { maximumFractionDigits: d }) : '—')
const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' }) : '—')
const VEREDICTO = { entrar: ['Entrar', 'bien'], entrar_con_condiciones: ['Entrar con condiciones', 'aviso'], no_entrar: ['No entrar', 'mal'] }
const LECTURA = { 'sobre-lo-esperado': ['Vende más de lo esperado', 'bien'], 'en-linea': ['En línea con lo esperado', 'bien'], 'bajo-lo-esperado': ['Bajo lo esperado', 'aviso'] }

// Dos barras con la misma escala: lo esperado y lo real, en unidades por día.
function Barras({ esperado, real }) {
  const tope = Math.max(esperado ?? 0, real ?? 0, 0.01)
  const fila = (etiqueta, valor, clase) => (
    <div className="acr-barra-fila">
      <span>{etiqueta}</span>
      <div className="acr-barra" role="img" aria-label={`${etiqueta}: ${decimal(valor, 2)} unidades por día`}><i className={clase} style={{ width: `${Math.max(2, ((valor ?? 0) / tope) * 100)}%` }} /></div>
      <strong>{decimal(valor, 2)}<small> /día</small></strong>
    </div>
  )
  return <div className="acr-barras">{fila('Esperado', esperado, 'acr-esperado')}{fila('Real', real, 'acr-real')}</div>
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
  if (g.acierto === true) return <span className="apr-chip apr-chip-bien"><CheckCircle2 size={13} aria-hidden="true" />El veredicto acertó</span>
  if (g.acierto === false) return <span className="apr-chip apr-chip-mal"><XCircle size={13} aria-hidden="true" />El veredicto falló</span>
  return <span className="apr-chip"><Target size={13} aria-hidden="true" />Medido, sin nota</span>
}

function Tarjeta({ g }) {
  const principal = g.productos[0]
  const v = VEREDICTO[g.decision?.veredicto]
  const l = LECTURA[g.lectura]
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

      <Barras esperado={g.esperado.ventaDia} real={g.real.ventaDia} />
      {l && <p className={`acr-lectura acr-lectura-${l[1]}`}>{l[0]}{Number.isFinite(g.ratio) ? ` · ${decimal(g.ratio, 2)}× la referencia` : ''}</p>}

      <Serie serie={g.real.serie} titulo={principal?.titulo ?? g.keyword} />

      <dl className="acr-cifras">
        <div><dt>Vendidas con stock</dt><dd>{fmtNum(g.real.unidades)}<small> en {g.real.diasConStock} d</small></dd></div>
        <div><dt>Cada 100 visitas</dt><dd>{decimal(g.real.conversionPct)}</dd></div>
        <div><dt>Precio real</dt><dd>{fmtPrecio(c.precioReal)}</dd></div>
        <div><dt>Recomendado</dt><dd>{fmtPrecio(c.precioRecomendado)}</dd></div>
        <div><dt>Dejó antes de publicidad</dt><dd>{g.real.dejo != null ? fmtPrecio(g.real.dejo) : '—'}</dd></div>
      </dl>

      {!c.comparable && (
        <p className="acr-aviso"><AlertTriangle size={14} aria-hidden="true" />
          {c.mismaGama === false ? 'Se vende en otra gama de precio que la recomendada. ' : ''}
          {c.mismasUnidades === false ? `Se recomendó un pack de ${unidades} y se publicó uno de ${c.unidadesPropias}. ` : ''}
          Precio y costo no son comparables directo.
        </p>
      )}
      {!!g.falta.length && <p className="acr-falta">Falta: {g.falta.join(' · ')}</p>}
    </article>
  )
}

export function RecomendadoVsVendido() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { api.recomendadoVsVendido().then(setDatos).catch((e) => setError(e.message)) }, [])
  if (error) return <p className="error-bloque" role="alert">No se pudo leer el cruce: {error}</p>
  if (!datos) return <Cargando texto="Cruzando lo recomendado con lo vendido…" />
  const r = datos.resumen
  if (!datos.grupos.length) return <p className="apr-vacio">Todavía no hay productos propios vinculados a un nicho.</p>
  return (
    <section className="apr-seccion acr">
      <div className="apr-seccion-cabeza">
        <h3>Lo que recomendó contra lo que se vende</h3>
        <p>Por cada producto que trajiste: el veredicto que tenías a la vista al decidir, lo que vende al día una publicación típica de su gama de precio y lo que vendes tú en los días con stock. Corre en sombra: mide, no decide.</p>
      </div>
      <div className="acr-resumen">
        <div className="acr-dato"><span>Productos seguidos</span><strong>{r.grupos}</strong><small>{r.medidos} medidos · {r.madurando} madurando</small></div>
        <div className="acr-dato"><span>Veredictos con nota</span><strong>{r.conNota ? `${r.aciertos} de ${r.conNota}` : '—'}</strong><small>{r.conNota ? `${r.tasaAcierto}% de acierto` : `nota desde ${r.minimoDias} días con stock`}</small></div>
        <div className="acr-dato"><span>Un recién llegado vende</span><strong>{Number.isFinite(r.factorEntrante) ? `${decimal(r.factorEntrante, 2)}×` : '—'}</strong><small>la referencia de su gama (mediana)</small></div>
        <div className="acr-dato"><span>Muestra</span><strong>{r.medidos}<small> de {r.minimoCasos}</small></strong><small>{r.estado === 'con-muestra' ? 'suficiente para leerla' : 'todavía pocos casos: es una pista'}</small></div>
      </div>
      <div className="acr-grilla">{datos.grupos.map((g) => <Tarjeta key={g.clave} g={g} />)}</div>
      <p className="apr-leyenda">La referencia sale de las reseñas nuevas por día de la gama, sin sus 3 líderes cuando el dato existe, por las ventas por reseña medidas en tu cuenta. Es gruesa a propósito: lo que se aprende es cuánto se aleja de ella un producto que recién entra.</p>
    </section>
  )
}
